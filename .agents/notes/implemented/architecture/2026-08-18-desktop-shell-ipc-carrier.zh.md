# Agent Note: 桌面壳 IPC 载体 — Electron 主进程就是 harness，客户端插件复用 `IpcApiClient`

Status: implemented

[English](2026-08-18-desktop-shell-ipc-carrier.md) | 中文

## Problem

DeepSeek Harness 已有两个界面：`dsh web`（Host + HTTP/WebSocket + React 客户端插件）和 `dsh --profile headless`（无 Host、无端口）。在 Windows 上开发的人，以及任何想要原生窗口的人，现在只能把浏览器标签页停在本地服务器上。[GUI 分层笔记](2026-07-19-gui-layering-and-rpc-protocol.md) 已经预留了一个 Electron 应用：复用同一套客户端插件、用 IPC fetch 载波，并且不复用 `dsh-host-webserver`。WorkBuddy 给出了 Electron 壳（main / preload / renderer、contextBridge、源码启动），但它连接的是远程服务器，也不是 harness 插件。

## Decision

Electron 主进程 **就是** harness 进程。实况桌面启动时，Node 上的 `dsh` CLI 不调用 `boot()`；它 spawn Electron 二进制，由 Electron 主进程运行 `runProfile({ profile: 'desktop' })`。渲染进程走 IPC。不监听 TCP，不挂 `dsh-host-webserver`。

`PROFILE_TEMPLATES.desktop` 为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app']`。它不叠 `dsh-web-app`。离线的 `dsh --profile desktop --dump-config` 仍走 Node CLI，不 spawn Electron。

窗口运行现有 React 客户端插件（`AppWebEntry` + 主机编写的 `dsh.client` 图）。`apps/desktop` 拥有 Electron main、preload，以及注入 `BootSeams.loadBundle` 的薄渲染入口。它不是第二套产品 GUI。

`dsh-client-connection` 仍是一行。节点半边在存在 `webServer` 时把 `toFetchHandler(api)` 绑到 HTTP/WebSocket，存在 `desktopRuntime` 时绑到该服务，两者都不存在则明确失败。客户端半边在存在 `window.dshDesktop` 时构造 `IpcApiClient`，否则保持 `WebApiClient`。Web 上要求 loopback 的特权 RPC，在桌面上改为要求这座 preload 桥（存在桥时 `isLoopback: true`）。经 IPC 重建的 `Request` URL 使用 `http://127.0.0.1/api/...`，让现有 loopback 围栏仍然通过。只有本进程创建的那个 `BrowserWindow` 可以调用 invoke（`event.sender === window.webContents`）。

`ClientModuleRegistry` 在不要求 `webServer` 的情况下组成同一份 boot 图，并暴露 `clientPath(id)`。HTTP `/plugins` 和 index tap 仅在存在 `webServer` 时运行。图行 URL 保持 `/plugins/<id>/client.js?rev=...`；桌面 `loadBundle` 经 preload 桥读取该行磁盘上的 `lib/client.js`。preload 在 `AppWebEntry.run()` 之前写入 `window.__DSH_BOOT__`。

第一版只做源码启动：`dsh desktop` 打开一个普通窗口。关闭窗口即退出。目录选择和路径打开继续用当前 Host 实现。第一版不做跨 IPC 的客户端插件 HMR（热模块替换）；`client-hmr` 行保持挂载且空闲。

WorkBuddy 是壳的参照（Electron 进程、preload 桥、用 `pnpm approve-builds` 放行 Electron 二进制）。它不是 UI、协议或插件模型。

## Alternatives considered

**在现有 HTTP 服务器外套一层原生窗口。** 否决：进程仍会监听端口，且 `dsh-host-webserver` 文档写明只给浏览器用。

**WorkBuddy 式瘦客户端，对接正在跑的 `dsh web`。** 否决：桌面将不是 harness 插件，两个进程可以各自启停。

**用自定义协议或页面级 `fetch`/`WebSocket` polyfill，让 `WebApiClient` 保持不变。** 否决：自定义 scheme 上没有 WebSocket upgrade，替换全局网络 API 会掩盖载波缺陷。分层笔记要求只替换 `doFetch`。

**新做一套 Vue/React 桌面 UI。** 否决：会复制客户端插件树。

**用 electron-vite 把整个 harness 打成 main chunk。** 否决：源码启动的 `dsh web` 已经经 tsx 启动插件树；再打进打包器会与 workspace 解析打架。

## Consequences

Web 的 HTTP/WebSocket 保持不变。桌面复用同一套 ApiProxy handler、四象限信封和客户端插件图，代价是第二条物理载波（`IpcApiClient` + `DesktopRuntime`）以及 connection 节点半边的双绑定。`ClientModuleRegistry` 不再 inject `webServer`，因此没有监听器的组合仍能组成 `window.__DSH_BOOT__`。第一版没有安装包、托盘、菜单、通知、全局快捷键、自动更新、代码签名、IPC 客户端 HMR、Electron `dialog`/`shell` 替换、自定义 `dsh://` HTTP 伪装，或页面级 `fetch`/`WebSocket` polyfill。
