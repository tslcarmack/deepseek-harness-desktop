# 把桌面 IPC 从 Web 客户端图里拿出去

[English](2026-08-19-web-desktop-client-carrier-split-design.md) | 中文

Status: proposed design. Implementation starts only after this file is reviewed. The shipped decision will live in an Agent Note in the same change that lands the code.

本设计修正[桌面壳设计](2026-08-18-desktop-shell-design.md)里的客户端载波规则。不改那份 spec 已锁定的产品决策：Electron 主进程就是 harness，渲染进程走 IPC，不监听 TCP、不挂 `dsh-host-webserver`，第一版仍是源码启动的 `dsh desktop`。

## Problem

`dsh web` 和 `pnpm run dev:web` 都会白屏。两条入口加载同一份 `@deepseek-ai/dsh-client-connection` 浏览器半包。该半包静态 import 了 `IpcApiClient`，因此 Web 启动就会执行桌面载波代码。Session log 的 blob 下载和其他桌面分支也写在 Web 图会挂载的包里。

成功标准是 Web 行为对齐桌面前的客户端图：桌面载波代码不得在 `dsh web` / `dev:web` 上运行，也不得出现在 Web connection 客户端入口的静态 import 图上。`dsh desktop` 必须仍能打开。桌面打磨类问题不在本次改动内。

## Locked decisions

- 做法：Web 的客户端图不含 IPC 实现。桌面 IPC 的 `provide('connection')` 放在只由 `dsh-desktop-app` 挂载的客户端半包上。
- 不把桌面拆成树外 `dsh plugin`。不以弄坏 `dsh desktop` 的方式回退 Host 双绑定。
- connection 浏览器 `apply` 只构造 `WebApiClient`，`rpc.call` 使用 `window.fetch`。不得 import `IpcApiClient` 或 `ipcDoFetch`。
- 客户端打包纯度禁止第二个插件对 `@deepseek-ai/dsh-client-connection/client` 做值 import。因此 `IpcApiClient` 迁入 `dsh-desktop-app` 自己的客户端半包（相对 import，外加可内联的 `@deepseek-ai/dsh-host-apiproxy/client`）。`ConnectionHandle` 的 `import type` 仍允许。
- connection 浏览器 `apply` 可以读 `window.dshDesktop`（只做 window 检查，不是 IPC 客户端）。存在桥时不 `provide('connection')`。`dsh-desktop-app` 客户端半包（`immediately: true`）提供 `IpcApiClient` 和经 invoke 的 `rpc.call`。
- `dsh-session-log-export` 的浏览器 `apply` 再次仅为 Web：`HEAD` 后把 GET URL 交给浏览器下载管理器。IPC GET、base64 正文和 blob object URL 保存在 `dsh-desktop-app` 客户端半包（或仅该半包 import 的模块）里。
- 误写入 `dsh-web-app` patch 的桌面改动（包括在那里关掉 HMR）撤回。若桌面仍关掉 HMR，该行只留在 `dsh-desktop-app` 的 patch 里。
- Host 的 `dsh-client-connection` 保持双绑定：`webServer` → HTTP/WebSocket；`desktopRuntime` → `setApiFetch`。同一进程从不挂两个载波。`dsh web` 不提供 `desktopRuntime`。

## Architecture

```
dsh web / dev:web
  dsh-web-app
    dsh-client-connection/client  → WebApiClient, window.fetch
    (no dsh-desktop-app, no window.dshDesktop)

dsh desktop
  dsh-desktop-app (host + new immediately client)
    dsh-client-connection/client  → sees dshDesktop, does not provide
    dsh-desktop-app/client        → IpcApiClient, dshDesktop.invoke
```

`client-modules` 仍扫描每个声明了 `dsh.client` 的已挂载 Host 包。Web 从不挂 `dsh-desktop-app`，因此从不加载该客户端半包。桌面两边都挂；provide 顺序是：connection 跳过，desktop-app provide。

## Data flow

Web 一元 RPC 仍是经 `window.fetch` 的 `POST /api/<method>`。mux 和 host 仍是 WebSocket `/api/events.mux` 与 `/api/events.host`。Session log 仍是 `HEAD /api/session.export`，再交给浏览器下载管理器。

桌面一元 RPC 仍经现有 preload 桥走 `dshDesktop.invoke`。主进程仍把请求改写到 `http://127.0.0.1` 并盖上 `Host: 127.0.0.1`，再进入共享 `/api` handler（Typert 拦截器，然后 ApiProxy）。非文本 IPC 正文仍用 `bodyEncoding: 'base64'`。Session log 经 invoke GET ZIP，解码后保存 blob object URL。

## Failures

启动后缺少 `ctx.connection` 在两个表面上都是响亮的启动失败，不是空白根节点。两次 `provide('connection')` 同样响亮失败。Web Session log 错误仍是现有弹窗里的 HTTP/传输错误。桌面 Session log 的 invoke、GET 或 base64 解码失败使用同一弹窗。特权 RPC 在 Web 上仍要求 loopback，在桌面上仍要求 preload 桥。

## Testing

connection 客户端测试：无 `dshDesktop` → `WebApiClient` 和 `window.fetch`；有 `dshDesktop` → 不 `provide`。用测试（源码 import 图或构建出的 `lib/client.js`）证明 connection 客户端入口对 `IpcApiClient` / `ipc-api-client` 没有静态依赖。

desktop-app 客户端测试：有桥时 provide `IpcApiClient`，经 invoke 发送一元/RPC。session-log-export 测试只覆盖 HEAD + href；blob 保存测试迁到 desktop-app 客户端半包。Host connection 测试保持 `webServer` 与 `desktopRuntime` 双绑定；Web 组合测试从不安装 `desktopRuntime`。

组装验收：`dsh web` 和 `pnpm run dev:web` 显示工作区/会话壳。`dsh desktop` 仍能打开，Session log 仍能经 IPC 保存 ZIP。本次不重录模型对话 snapshot，也不包含无关的桌面打磨。

connection、desktop-app、session-log-export 的 README 以及[桌面 IPC 载波 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md) 写明：Web 客户端图不加载 IPC 客户端实现。

## Out of scope

把桌面做成树外 `dsh plugin`。修桌面其余 UI/Host 小问题。新 GUI。Electron `dialog`/`shell`。IPC 客户端 HMR。页面级 `fetch`/`WebSocket` polyfill。

## Alternatives considered

**只修白屏，把 `IpcApiClient` 留在 connection 客户端入口、靠 `window.dshDesktop` 分支。** 否决：Web 启动仍会执行桌面载波模块，这正是白屏的失败模式。

**回退共享包上每一处桌面 diff。** 否决：`dsh desktop` 将无法启动。

**新建一个只做 IPC 客户端插件的 npm 包。** 暂缓：`dsh-desktop-app` 的客户端半包已经只在桌面挂载，不必再增加第三个 immediately 名字。

## Success

1. `pnpm dsh web` 和 `pnpm run dev:web` 显示桌面前的 Web 壳（工作区选择 / 会话列表 / 对话），不是白屏。
2. connection 客户端入口不静态 import `IpcApiClient`。
3. `pnpm dsh desktop` 仍打开一个窗口，Session log 仍经 IPC 保存。
4. Web Session log 仍使用 HEAD + 浏览器下载管理器。
