# 基于已发布 Harness 包的独立桌面 Agent 产品

[English](2026-08-19-independent-desktop-agent-design.md) | 中文

Status: proposed design. Implementation starts only after this file is reviewed. The shipped decision for work that lands in this repository will live in an Agent Note in the same change as that code.

本设计是 Electron 桌面表层的产品归属。它不替换[Web/桌面客户端载波拆分](2026-08-19-web-desktop-client-carrier-split-design.md)里的客户端载波规则。它改变此前「桌面作为本 monorepo 内 `dsh desktop` 随发行」的计划：窗口、桌面组合包、产品 CLI（命令行界面）和 Agent 插件放在单独的 git 仓库，以 npm 包消费 `@deepseek-ai/dsh-*`。

## Problem

`feat/desktop-shell` 分支已经做出想要的窗口（Electron 主进程就是 harness，渲染进程走 IPC，无 TCP），但实现改了 Harness 包和 CLI。跟踪上游就意味着每次 Harness 更新都要合并一层产品壳。

想要的结果是：在开源内核上做私有 Agent，内核更新来自已发布的包，而不是对本 monorepo 做 git fork。

## Locked decisions

- 不对 `deepseek-harness` 做 git fork。从 npm 消费 `@deepseek-ai/dsh-*`。
- 在这些包包含 Architecture 所列桌面 Host 与客户端 hook 之前，消费从本分支（或等价 commit）打出的私有或本地 registry 构建。这些 hook 以后再上游化；产品仓库不为此 PR 阻塞。
- 产品仓库是一份 Harness 安装根，不是套在 `dsh web` 外的包装，也不是叠在官方 `dsh` 二进制上的 `dsh plugin` 覆盖层。
- 产品 CLI（示例名 `my-agent`）拥有 `desktop`。实况启动 spawn Electron；由 Electron 主进程 boot 产品 profile。`--dump-config` 留在 Node，不 spawn Electron。不调用上游 `dsh desktop` 或 `PROFILE_TEMPLATES.desktop`。
- Profile 示例名 `my-agent`。组合包顺序：`@deepseek-ai/dsh-base`、产品桌面组合包、产品 Agent 组合包。不叠 `dsh-web-app`。不监听 TCP，不挂 `dsh-host-webserver`。
- Electron 主进程 **就是** harness 进程。渲染进程经 preload 桥走 IPC。窗口运行已发布的 React 客户端（`AppWebEntry` + 主机编写的 `dsh.client` 图）。不是第二套 GUI。
- 第一版只做源码启动：一个窗口，关闭窗口即退出。没有安装包、托盘、应用菜单、通知、自动更新或签名。
- 第一版不做跨 IPC 的客户端插件 HMR（热模块替换）。
- 完整的 Harness 升级手册不在第一版。产品 README 写明：bump 私有 registry 上的 `@deepseek-ai/dsh-*` 版本并重启窗口。

## Architecture

```
my-agent desktop
  → spawn Electron (CLI process does not boot the tree)
       Electron main
         → boot profile `my-agent` (INSTALL_ANCHOR = this product repo)
              @deepseek-ai/dsh-base
              <desktop-bundle>     // no HTTP; provides desktopRuntime
              <agent-bundle>       // presets, tools, private plugins
         → one BrowserWindow
       renderer (file:// published @deepseek-ai/dsh-web-frontend dist)
         → preload: window.__DSH_BOOT__ + window.dshDesktop
         → AppWebEntry + <desktop-bundle>/client IpcApiClient
```

`loadProfile` 仍是双锚点：先产品安装根，再 `$DSH_HOME/profiles/my-agent`。首次实况 `my-agent desktop` 在目录缺失时初始化该 profile。用户的 `cordis.patch.yml` 叠在这三层组合包之上。

所消费的 `@deepseek-ai/dsh-*` 构建必须具备的 hook（今天在 `feat/desktop-shell` 上）：

- Host `dsh-client-connection`：存在 `webServer` 时把 `toFetchHandler` 绑到 HTTP/WebSocket，存在 `desktopRuntime` 时绑到 `desktopRuntime.setApiFetch`；两者都不存在则明确失败。同一进程从不挂两个载波。
- connection 浏览器 `apply` 构造 `WebApiClient`（或 fixture 客户端），并用 `window.fetch`。当存在 `window.dshDesktop` 且没有 `?fixture` 时，不 `provide('connection')`。
- `dsh-session-log-export` 的浏览器 `apply` 是 HEAD，再交给浏览器下载管理器。控制器暴露 `adoptBlobTransport`。
- `dsh-client-modules` 在 `webServer` 出现时注册 `/plugins` 和 boot manifest 的 index tap，包括该服务晚于 modules 行启动才出现的情况（Web）。桌面从不挂 `webServer`。

这些 hook 不是能力 seam。它们是产品组合包所依赖的 Host 与客户端挂载规则。

## Components

产品仓库内四个包（一个 git 仓库，可用 workspace）：

| Package | Does | Does not |
|---|---|---|
| CLI / installation root | `my-agent desktop` spawn Electron；`--dump-config` 使用 `boot`；`INSTALL_ANCHOR` 为本仓库；转发 `--patch` | IPC 实现；改 Harness 内核 |
| Electron shell | main、preload、对已发布 frontend dist 做 `loadFile`；只允许本窗口 `webContents` invoke | 第二套 GUI；渲染进程 `import('electron')` |
| Desktop bundle | `dsh.bundle.patch`：GUI 需要的 Host 行（API gateway、workspace、modules、connection、目录选择器、`dsh.client` 花名册）；提供 `desktopRuntime`；`immediately: true` 客户端半边提供 `IpcApiClient` 并调用 `adoptBlobTransport` | `webserver` / `frontend-static`；对 `@deepseek-ai/dsh-client-connection/client` 做值 import（客户端打包纯度：相对拷贝，外加可内联的 `@deepseek-ai/dsh-host-apiproxy/client`；`ConnectionHandle` 的 `import type` 允许） |
| Agent bundle | 产品 preset、工具、提示词、私有插件 | 窗口或载波 |

本 Harness checkout：把 Electron、树内 desktop-app 组合包和 `dsh desktop` 移出上游产品树。只保留（并稍后 PR）上面那些 hook。

## Data flow

1. `my-agent desktop` spawn Electron。本进程不 `boot()`。
2. Electron 主进程运行 `healProfilesModuleFallback`，然后 `runProfile({ profile: 'my-agent' })`。启动后缺少 `desktopRuntime` 是响亮失败。
3. 一个 `BrowserWindow`。preload 注入 `window.dshDesktop`（invoke、mux、host、loadBundle）以及来自 `clientModules.graph()` 的 `window.__DSH_BOOT__`。
4. 渲染进程运行已发布的 `AppWebEntry`。connection 客户端看到桥且无 `?fixture` 则不 provide。桌面组合包的 immediately 半边提供 `IpcApiClient`；`rpc.call` 走 invoke，不走 `window.fetch`。
5. Host connection 把同一套 `/api` handler 绑到 `desktopRuntime.setApiFetch`。主进程把每次 invoke 改写到 `http://127.0.0.1` 并盖上 `Host: 127.0.0.1`（Fetch Request 不带 Host）。丢掉渲染进程 Origin，因为特权来自 preload 桥。改写后的请求进入 Typert 拦截器，然后是 ApiProxy。mux/host 是 JSON 订阅，不是 WebSocket。非文本 IPC 正文使用 `bodyEncoding: 'base64'`。
6. Session-log：Web 插件保持 HEAD + href。`sessionLogDownload` 存在后，桌面 immediately 半边调用 `adoptBlobTransport`。
7. 关闭窗口：`ctx.fiber.dispose()`，然后 `app.quit()`。

## Failures

安装根解析失败、列出的组合包没有 `dsh.bundle` 声明、缺少 Electron 或 tsx、缺少 preload 或 frontend dist，都在启动时抛出带恢复提示的错误。IPC 只接受本窗口的 `webContents`；任何其他 sender 一律拒绝。

所消费的包构建若缺少 `desktopRuntime`、仍在 connection 客户端入口静态包含 `IpcApiClient`、或在存在 `webServer` 时从不注入 `/plugins`，视为配置错误。不回退到 HTTP。缺少 `ctx.connection` 与两次 `provide('connection')` 仍是响亮的 Cordis 失败。不加空白根占位。

## Testing

产品仓库：

- CLI：`desktop` spawn Electron，且不在 CLI 进程里 boot；`--dump-config` 打印 `dsh-base` 加上两个产品组合包。
- Host：粘合提供 `desktopRuntime` 并 `setApiFetch`；组合没有 `webServer`。
- Client：存在桥 → provide `IpcApiClient`；`?fixture` 跳过 provide。
- Session-log：adopt 之后，invoke GET 并 blob 保存。
- 组装：打开一个窗口；工作区选择 / 会话列表 / 对话壳能画出来。

本次不重录 Harness 模型对话 snapshot。对锁定的 Harness 构建，断言 `packages/client/connection/lib/client.js`（或已发布等价物）不含 `IpcApiClient`。

## Out of scope

安装包、托盘、菜单、通知、自动更新、签名。给 `dsh web` 套原生窗口，或对接正在跑的 HTTP 服务器的客户端。页面级 `fetch` / `WebSocket` polyfill。IPC 客户端 HMR。把 Electron 合进上游 `dsh desktop`。完整升级手册。

## Alternatives considered

**官方 `dsh` CLI 加 `dsh plugin` 覆盖层。** 否决：产品仍会绑上游二进制、profile 名和 spawn 路径。

**把本 monorepo 当 git submodule。** 否决：实质是 fork；内核更新不会来自已发布的包。

**树外插件对 `@deepseek-ai/dsh-client-connection/client` 做值 import。** 否决：客户端打包纯度禁止；桌面组合包继续自带 IPC 客户端半边。

## Success

1. 在产品仓库中，`my-agent desktop`（或选定的 bin 名）打开一个窗口，工作区/会话壳能画出来。
2. 产品 profile 的 `--dump-config` 列出 `@deepseek-ai/dsh-base`、桌面组合包和 Agent 组合包，且不 spawn Electron。
3. 产品把 `@deepseek-ai/dsh-*` 当包来依赖（允许私有 registry）。不 vendor `packages/core`。
4. 关闭窗口即退出。不监听 TCP。
