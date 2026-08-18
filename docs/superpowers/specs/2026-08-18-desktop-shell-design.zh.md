# Desktop shell (source-launch Electron)

[English](2026-08-18-desktop-shell-design.md) | 中文

Status: proposed design. Implementation starts only after this file is reviewed. The shipped decision will live in an Agent Note in the same change that lands the code.

## Problem

DeepSeek Harness 已有两个界面：`dsh web`（Host + HTTP/WebSocket + React 客户端插件）和 `dsh --profile headless`（无 Host、无端口）。在 Windows 上开发的人，以及任何想要原生窗口的人，现在只能把浏览器标签页停在本地服务器上。WorkBuddy 的桌面应用给出了我们要的 Electron 壳（main / preload / renderer、contextBridge、源码启动），但它连接的是远程服务器，也不是 harness 插件。

GUI 分层笔记已经预留了一个 Electron 应用：复用同一套客户端插件、用 IPC fetch 载波，并且不复用 `dsh-host-webserver`。那个应用还不存在。

## Locked decisions

- Electron 主进程 **就是** harness 进程。渲染进程走 IPC。不监听 TCP，不挂 `dsh-host-webserver`。
- 窗口运行现有 React 客户端插件（`AppWebEntry` + 主机编写的 `dsh.client` 图）。不做第二套 GUI。
- 第一版只做源码启动：`dsh desktop` 打开窗口。没有安装包、托盘、应用菜单、通知、全局快捷键、自动更新或代码签名。
- 关闭窗口即退出进程。目录选择和路径打开继续用当前 Host 实现。
- 第一版不做跨 IPC 的客户端插件 HMR（热模块替换）。重建客户端 bundle 并重启窗口。
- WorkBuddy 是壳的参照（Electron 进程、preload 桥、用 `pnpm approve-builds` 放行 Electron 二进制）。它不是 UI、协议或插件模型。

## Architecture

```
dsh desktop
  → spawn Electron (does not boot the tree in the Node CLI)
       Electron main
         → boot profile `desktop`
              dsh-base
              dsh-desktop-app     // new bundle: window + IPC, no webserver
         → one BrowserWindow
       renderer (file:// frontend dist)
         → preload injects window.__DSH_BOOT__ and window.dshDesktop
         → AppWebEntry + IpcApiClient
```

`PROFILE_TEMPLATES.desktop` 为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app']`。它不叠 `dsh-web-app`。离线的 `dsh --profile desktop --dump-config` 仍走 Node CLI，不 spawn Electron。

### Where code lives

| Piece | Location | Responsibility |
|---|---|---|
| Electron assembly | `apps/desktop` | main 入口、preload 脚本、对 web frontend dist 的 `loadFile`、spawn 目标 |
| CLI alias | `apps/cli` | `dsh desktop` 转发启动器 flag（`--patch` 等）并 spawn Electron |
| Composition bundle | `packages/bundle/desktop-app` | patch 列表 + 粘合插件（`desktopRuntime`）：窗口生命周期、IPC 服务、dist 解析 |
| IPC client | `packages/client/connection` | `IpcApiClient` 继承 `AbstractApiClient`；`doFetch` 以及经 preload 桥的 mux/host 下行 |
| Profile template | `packages/boot/app-boot` `PROFILE_TEMPLATES` | `desktop` 像 `web` 一样自动初始化 |

组合包抄 web-app 里 GUI 需要的 Host 行（apiproxy、workspace、modules、目录选择器、`dsh.client` 花名册，以及 connection 的节点半边）。它 **不** 挂 `webserver`、`frontend-static`、LAN `trustedHosts`，也不打印 `dsh web: http://…`。

`apps/desktop` 不是第二套产品 GUI。渲染壳是已经构建好的 `@deepseek-ai/dsh-web-frontend` dist。`apps/desktop` 只持有 Electron main/preload 以及一条很小的 index 加载路径。

### Connection dual bind

`dsh-client-connection` 仍是一行。

- 节点半边：若存在 `webServer`，保持今天的 `/api` + WebSocket 注册。若存在 `desktopRuntime`，把同一个 `toFetchHandler(api)` 接到 `ipcMain`，并用 `webContents.send` 推送 mux/host 帧。两者都不存在则在加载时明确失败。
- 客户端半边：若存在 `window.dshDesktop`，构造 `IpcApiClient`；否则保持 `WebApiClient`。

第一版里，Web 与桌面不会在同一进程中同时挂上两种载波。

## Data flow

渲染进程从不 import `ipcRenderer`。preload 使用 `contextIsolation: true`、`nodeIntegration: false`，以及 `contextBridge.exposeInMainWorld` 挂出窄的 `window.dshDesktop`：unary invoke、respond、mux/host 订阅、`loadBundle`。

| Quadrant | Web today | Desktop |
|---|---|---|
| ClientRequest → ServerResponse | `POST /api/<method>` | `dshDesktop.invoke` → 主进程 `toFetchHandler(api).fetch` |
| ServerRequest | WebSocket `/api/events.mux`、`/api/events.host` | `webContents.send` → preload → `IpcApiClient` |
| ClientResponse | `POST /api/respond` | 同一条 invoke 路径，方法为 `respond` |

Zod 校验、rpcId 回显和 `RpcResult` 留在 ApiProxy。handler 与 `dsh web` 使用的是同一个对象。

信任：只有本进程创建的那个 `BrowserWindow` 可以使用这座桥。窗口不 load 远程 URL。今天要求 loopback 的特权 RPC（`host.pickDirectory`、`host.openPath` 等）改为要求这座 preload 桥。

### Plugin graph without HTTP

1. `dsh-client-modules` 的节点半边扫描已挂载花名册，组成与 Web 相同的 graph 形态。
2. preload 在 `AppWebEntry.run()` 之前写入 `window.__DSH_BOOT__`。不使用 index.html 的 tap。
3. graph 的 `url` 值不是 `http://127.0.0.1/plugins/…`。`AppWebEntry` 接收 `BootSeams.loadBundle`：渲染进程向桥请求，主进程读取该行磁盘上的 `lib/client.js`，渲染进程注册 factory。这正是 jsdom 测试已经覆盖的那条缝。
4. 缺少客户端 bundle 或 frontend dist 时启动失败，构建提示与 Web 已打印的同类。

第一版不通过 IPC 推送客户端 HMR。`client-hmr` 行保持挂载并空转，与未运行 `pnpm run dev:web` 时的 Web 相同。

## Launch

`dsh desktop` 是与 `dsh web` 类似的硬编码 CLI 别名，但 Node 进程 **不** 调用 `boot()`。它 spawn Electron 二进制，指向 `apps/desktop` 的 main，并转发 argv（`--patch` 文件仍是子进程重新读取的路径）。Electron main 调用 `runProfile({ profile: 'desktop', … })`，源码启动方式（tsx / workspace）与 `dsh web` 相同。harness 不会被打进 electron-vite 的 main chunk。

preload 是 Electron 能加载的构建产物（`.js` / `.cjs`）。main 保持源码启动。

渲染进程：对 web frontend dist 的 `index.html` 做 `BrowserWindow.loadFile`。preload 先注入 boot graph。首次启动的前置构建与 `dsh web` 相同：frontend dist 以及每个 `dsh.client` 的 `lib/client.js`。

第一版没有桌面专用 flag（这里不存在 `--host` / `--port`）。Electron 是 workspace/devDependency。在 Windows 上，pnpm 10 会拦截 Electron 的 postinstall，直到 `pnpm approve-builds` 放行；桌面 README 记录这一点，做法跟随 WorkBuddy。

SIGINT 与关窗：先 dispose 插件树，再 `app.quit()`。

## Failures

| Case | Behavior |
|---|---|
| 插件树 load 或 apply 失败 | 现有带标签的 `boot()` 错误写到 stderr，`installFailLoud`，退出码 1。第一版不加 Electron 错误对话框。 |
| 缺少客户端 bundle 或 frontend dist | 启动失败并带构建提示，与 Web 同类。 |
| unary 业务错误 | `RpcResult` `{ ok: false }`；UI 与 Web 相同。 |
| 窗口消失后的 IPC | 主进程吞掉；不抛出。 |
| 渲染进程崩溃 | 第一版不重建窗口；进程退出。 |

## Testing

组装 GUI 的无密钥快照仍走现有 `test:web` 车道。渲染的是同一份插件图；第一版不把 Electron 当作第二个快照宿主。

桌面自己要钉的证据：

- IPC 载波单元测试，使用假的 `ipcMain` / preload 桥：handler 仍然看到四象限消息并回显 rpcId。不启动真正的 Electron 二进制。
- connection：存在 `window.dshDesktop` → `IpcApiClient`；不存在 → `WebApiClient`。
- `loadBundle`：经桥返回的源码注册预期的 factory id。
- 组合：`dsh --profile desktop --dump-config`（Node，无 Electron）没有 `webserver` 行，并包含桌面粘合行。
- 真 Electron 窗口 smoke 可选，第一版不作为合并门禁。打包 exe 的 smoke 等到安装包那一刀。

## Out of scope for version one

安装包 / electron-builder、托盘、应用菜单、通知、全局快捷键、自动更新、签名、IPC 客户端 HMR、用 Electron `dialog`/`shell` 替换 `host.pickDirectory` / `host.openPath`、用自定义 `dsh://` 协议冒充 HTTP `/api`，以及在页面里 polyfill `fetch` / `WebSocket`。

## Alternatives considered

**在现有 HTTP 服务器外包一层原生窗口。** 否决：进程仍会监听端口，且 `dsh-host-webserver` 已文档化为仅服务浏览器。

**WorkBuddy 式薄客户端，连接已在运行的 `dsh web`。** 否决：桌面端将不是 harness 插件，两个进程可以各自独立启停。

**自定义协议或页面级 `fetch`/`WebSocket` polyfill，使 `WebApiClient` 保持不变。** 否决：自定义 scheme 上不存在 WebSocket 升级，替换全局网络 API 会把载波缺陷藏起来。分层笔记要求只替换 `doFetch`。

**新的 Vue/React 桌面 UI。** 否决：会复制客户端插件树。

**把整个 harness 打进 electron-vite 作为 main bundle。** 否决：源码启动的 `dsh web` 已经通过 tsx 启动该树；再打进打包器会与 workspace 解析冲突。

## Success

在已经能运行 `pnpm dsh web` 的机器上：

1. Electron 已批准/安装。
2. Frontend dist 与客户端 bundle 已构建。
3. `pnpm dsh desktop`（可选 `--patch <overlay.yml>`）打开一个窗口。
4. 会话列表、提示词、工具和审批与 Web 一样可用。
5. 没有任何进程在监听 Web 端口。
6. 关闭窗口即退出。
