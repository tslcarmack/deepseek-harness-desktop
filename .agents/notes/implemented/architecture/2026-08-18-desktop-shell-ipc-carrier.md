# Agent Note: Desktop shell IPC carrier — Electron main is the harness, client plugins reuse `IpcApiClient`

Status: implemented

English | [中文](2026-08-18-desktop-shell-ipc-carrier.zh.md)

## Problem

DeepSeek Harness already has two surfaces: `dsh web` (Host + HTTP/WebSocket + React client plugins) and `dsh --profile headless` (no Host, no ports). Contributors on Windows, and anyone who wants a native window, currently have to keep a browser tab on the local server. The [GUI layering note](2026-07-19-gui-layering-and-rpc-protocol.md) reserved an Electron application that reuses the same client plugins over an IPC fetch carrier and does not reuse `dsh-host-webserver`. WorkBuddy shows the Electron shell (main / preload / renderer, contextBridge, source-launch) but talks to a remote server and is not a harness plugin.

## Decision

Electron main **is** the harness process. The Node `dsh` CLI does not call `boot()` for a live desktop start; it spawns the Electron binary, and Electron main runs `runProfile({ profile: 'desktop' })`. The renderer talks IPC. There is no TCP listen and no `dsh-host-webserver`.

`PROFILE_TEMPLATES.desktop` is `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app']`. It does not stack `dsh-web-app`. Offline `dsh --profile desktop --dump-config` stays a Node CLI path and does not spawn Electron.

The window runs the existing React client plugins (`AppWebEntry` + the host-authored `dsh.client` graph). `apps/desktop` owns Electron main, preload, and a thin renderer entry that injects `BootSeams.loadBundle`. It is not a second product GUI.

`dsh-client-connection` stays one row. The node half binds `toFetchHandler(api)` to HTTP/WebSocket when `webServer` is present, or to `desktopRuntime` when that service is present, and fails loud when neither exists. The connection client half constructs `WebApiClient` (or the fixture client) and uses `window.fetch` for `rpc.call`. When the preload bridge exists and `?fixture` is absent, that half does not provide `connection`. `dsh-desktop-app`'s immediately client half provides `IpcApiClient` and invoke-backed `rpc.call`. Web never mounts `dsh-desktop-app`, so the Web client graph does not load the IPC implementation. Privileged RPCs that require loopback on Web require this preload bridge on desktop (`isLoopback: true` when the bridge exists). IPC-reconstructed Requests use URL `http://127.0.0.1/api/...` and stamp `Host: 127.0.0.1` (a Fetch Request has no Host header, unlike Node's IncomingMessage) so the existing loopback fence still passes; renderer `Origin` is dropped because the privilege is the preload bridge, not the `file:` page. The rewritten request then enters the same shared `/api` handler Web uses (Typert interceptors such as `pluginInventory/list`, then ApiProxy). Unary IPC replies keep textual bodies as UTF-8 strings and send ZIP and other non-textual bodies as base64 (`bodyEncoding: 'base64'`) so octets survive structured clone. Session-log blob save is adopted from that same desktop-app half: it GETs `/api/session.export` through invoke and saves a blob object URL. Only the `BrowserWindow` this process created may call invoke (`event.sender === window.webContents`).

`ClientModuleRegistry` composes the same boot graph and exposes `clientPath(id)` without requiring `webServer`. HTTP `/plugins` and the index tap run only when `webServer` is present. Graph row URLs stay `/plugins/<id>/client.js?rev=...`; desktop `loadBundle` reads that row's on-disk `lib/client.js` through the preload bridge. Preload writes `window.__DSH_BOOT__` before `AppWebEntry.run()`.

Version one is source-launch only: `dsh desktop` opens one plain window. Close window exits. Directory picking and path opening keep the current Host implementations. Client-plugin HMR over IPC is out of version one; the `client-hmr` row stays mounted and idle.

WorkBuddy is the shell reference (Electron process, preload bridge, `pnpm approve-builds` for the Electron binary). It is not the UI, protocol, or plugin model.

## Alternatives considered

**Native window around the existing HTTP server.** Rejected: the process would still listen on a port, and `dsh-host-webserver` is documented as browser-only.

**WorkBuddy-style thin client against a running `dsh web`.** Rejected: the desktop would not be a harness plugin, and the two processes can start and stop independently.

**Custom protocol or page-level `fetch`/`WebSocket` polyfill so `WebApiClient` is unchanged.** Rejected: WebSocket upgrade does not exist on a custom scheme, and replacing global network APIs hides carrier bugs. The layering note requires swapping only `doFetch`.

**New Vue/React desktop UI.** Rejected: duplicates the client plugin tree.

**electron-vite bundle of the whole harness as main.** Rejected: source-launch `dsh web` already boots the tree through tsx; duplicating that into a bundler fights workspace resolution.

## Consequences

Web keeps HTTP/WebSocket unchanged and does not load `IpcApiClient` on the Web client graph. Desktop reuses the same ApiProxy handler, four-quadrant envelopes, and client plugin graph, at the cost of a second physical carrier (`IpcApiClient` + `DesktopRuntime` on `dsh-desktop-app`) and a dual-bind in the connection node half. `ClientModuleRegistry` no longer injects `webServer`, so compositions without a listener can still compose `window.__DSH_BOOT__`. Version one has no installer, tray, menu, notifications, global shortcuts, auto-update, signing, IPC client HMR, Electron `dialog`/`shell` replacements, custom `dsh://` HTTP impersonation, or page-level `fetch`/`WebSocket` polyfills.
