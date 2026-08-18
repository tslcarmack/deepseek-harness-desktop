# Desktop shell (source-launch Electron)

English | [中文](2026-08-18-desktop-shell-design.zh.md)

Status: proposed design. Implementation starts only after this file is reviewed. The shipped decision will live in an Agent Note in the same change that lands the code.

## Problem

DeepSeek Harness already has two surfaces: `dsh web` (Host + HTTP/WebSocket + React client plugins) and `dsh --profile headless` (no Host, no ports). Contributors on Windows, and anyone who wants a native window, currently have to keep a browser tab on the local server. WorkBuddy's desktop app shows the Electron shell we want (main / preload / renderer, contextBridge, source-launch), but it talks to a remote server and is not a harness plugin.

The GUI layering note already reserved an Electron application that reuses the same client plugins over an IPC fetch carrier and does not reuse `dsh-host-webserver`. That application does not exist yet.

## Locked decisions

- Electron main **is** the harness process. The renderer talks IPC. No TCP listen, no `dsh-host-webserver`.
- The window runs the existing React client plugins (`AppWebEntry` + the host-authored `dsh.client` graph). No second GUI.
- Version one is source-launch only: `dsh desktop` opens a window. No installer, tray, app menu, notifications, global shortcuts, auto-update, or code signing.
- Close window exits the process. Directory picking and path opening keep the current Host implementations.
- Client-plugin HMR over IPC is out of version one. Rebuild client bundles and restart the window.
- WorkBuddy is the shell reference (Electron process, preload bridge, `pnpm approve-builds` for the Electron binary). It is not the UI, protocol, or plugin model.

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

`PROFILE_TEMPLATES.desktop` is `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app']`. It does not stack `dsh-web-app`. Offline `dsh --profile desktop --dump-config` stays a Node CLI path and does not spawn Electron.

### Where code lives

| Piece | Location | Responsibility |
|---|---|---|
| Electron assembly | `apps/desktop` | main entry, preload script, `loadFile` of the web frontend dist, spawn target |
| CLI alias | `apps/cli` | `dsh desktop` forwards launcher flags (`--patch`, …) and spawns Electron |
| Composition bundle | `packages/bundle/desktop-app` | patch list + glue plugin (`desktopRuntime`): window lifecycle, IPC server, dist resolve |
| IPC client | `packages/client/connection` | `IpcApiClient` extends `AbstractApiClient`; `doFetch` plus mux/host downlink over the preload bridge |
| Profile template | `packages/boot/app-boot` `PROFILE_TEMPLATES` | `desktop` auto-inits like `web` |

The bundle copies the web-app host rows the GUI needs (apiproxy, workspace, modules, directory picker, `dsh.client` roster, and the connection node half). It does **not** mount `webserver`, `frontend-static`, LAN `trustedHosts`, or the `dsh web: http://…` printer.

`apps/desktop` is not a second product GUI. The renderer shell is the already-built `@deepseek-ai/dsh-web-frontend` dist. `apps/desktop` only owns Electron main/preload and a small index load path.

### Connection dual bind

`dsh-client-connection` stays one row.

- Node half: if `webServer` exists, keep today's `/api` + WebSocket registration. If `desktopRuntime` exists, bind the same `toFetchHandler(api)` to `ipcMain` and push mux/host frames with `webContents.send`. If neither exists, fail loud at load.
- Client half: if `window.dshDesktop` exists, construct `IpcApiClient`; otherwise keep `WebApiClient`.

Web and desktop never mount both carriers in one process in version one.

## Data flow

The renderer never imports `ipcRenderer`. Preload uses `contextIsolation: true`, `nodeIntegration: false`, and `contextBridge.exposeInMainWorld` for a narrow `window.dshDesktop`: unary invoke, respond, mux/host subscribe, `loadBundle`.

| Quadrant | Web today | Desktop |
|---|---|---|
| ClientRequest → ServerResponse | `POST /api/<method>` | `dshDesktop.invoke` → main `toFetchHandler(api).fetch` |
| ServerRequest | WebSocket `/api/events.mux`, `/api/events.host` | `webContents.send` → preload → `IpcApiClient` |
| ClientResponse | `POST /api/respond` | the same invoke path, method `respond` |

Zod validation, rpcId echo, and `RpcResult` stay in ApiProxy. The handler is the same object `dsh web` uses.

Trust: only the `BrowserWindow` this process created may use the bridge. The window loads no remote URL. Privileged RPCs that today require loopback (`host.pickDirectory`, `host.openPath`, …) require this preload bridge instead.

### Plugin graph without HTTP

1. The `dsh-client-modules` node half scans the mounted roster and composes the same graph shape as Web.
2. Preload writes `window.__DSH_BOOT__` before `AppWebEntry.run()`. Index.html taps are not used.
3. Graph `url` values are not `http://127.0.0.1/plugins/…`. `AppWebEntry` receives `BootSeams.loadBundle`: the renderer asks the bridge, main reads that row's on-disk `lib/client.js`, the renderer registers the factory. This is the seam jsdom tests already override.
4. A missing client bundle or missing frontend dist fails boot with the same class of build hint Web already prints.

Version one does not stream client HMR over IPC. The `client-hmr` row stays mounted and idle, as on Web when `pnpm run dev:web` is not running.

## Launch

`dsh desktop` is a hardcoded CLI alias like `dsh web`, except the Node process does **not** call `boot()`. It spawns the Electron binary with `apps/desktop` main and the forwarded argv (`--patch` files stay paths the child re-reads). Electron main calls `runProfile({ profile: 'desktop', … })` with the same tsx/workspace source-launch as `dsh web`. The harness is not bundled into an electron-vite main chunk.

Preload is a built script Electron can load (`.js` / `.cjs`). Main stays source-launched.

Renderer: `BrowserWindow.loadFile` on the web frontend dist's `index.html`. Preload injects the boot graph first. First launch requires the same prior builds as `dsh web`: frontend dist and each `dsh.client` `lib/client.js`.

Version one has no desktop-only flags (`--host` / `--port` do not exist here). Electron is a workspace/devDependency. On Windows, pnpm 10 blocks the Electron postinstall until `pnpm approve-builds` allows it; the desktop README records that, following WorkBuddy.

SIGINT and window close: dispose the plugin tree, then `app.quit()`.

## Failures

| Case | Behavior |
|---|---|
| Plugin tree fails to load or apply | Existing labelled `boot()` error on stderr, `installFailLoud`, exit 1. Version one does not add an Electron error dialog. |
| Missing client bundle or frontend dist | Boot fails with a build hint, same class as Web. |
| Unary business error | `RpcResult` `{ ok: false }`; UI matches Web. |
| IPC after the window is gone | Main swallows; it does not throw. |
| Renderer crash | Version one does not recreate the window; the process exits. |

## Testing

Assembled GUI keyless snapshots stay on the existing `test:web` lane. The renderer is the same plugin graph; Electron is not a second snapshot host in version one.

Desktop-owned evidence:

- IPC carrier unit tests with a fake `ipcMain` / preload bridge: the handler still sees four-quadrant messages and echoes rpcId. No real Electron binary.
- Connection: `window.dshDesktop` present → `IpcApiClient`; absent → `WebApiClient`.
- `loadBundle`: source returned over the bridge registers the expected factory id.
- Composition: `dsh --profile desktop --dump-config` (Node, no Electron) has no `webserver` row and does include the desktop glue rows.
- Real Electron window smoke is optional and does not gate merge in version one. Packaged-exe smoke waits for the installer slice.

## Out of scope for version one

Installer / electron-builder, tray, application menu, notifications, global shortcuts, auto-update, signing, IPC client HMR, replacing `host.pickDirectory` / `host.openPath` with Electron `dialog`/`shell`, a custom `dsh://` protocol that impersonates HTTP `/api`, and polyfilling `fetch` / `WebSocket` in the page.

## Alternatives considered

**Native window around the existing HTTP server.** Rejected: the process would still listen on a port, and `dsh-host-webserver` is documented as browser-only.

**WorkBuddy-style thin client against a running `dsh web`.** Rejected: the desktop would not be a harness plugin, and the two processes can start and stop independently.

**Custom protocol or page-level `fetch`/`WebSocket` polyfill so `WebApiClient` is unchanged.** Rejected: WebSocket upgrade does not exist on a custom scheme, and replacing global network APIs hides carrier bugs. The layering note requires swapping only `doFetch`.

**New Vue/React desktop UI.** Rejected: duplicates the client plugin tree.

**electron-vite bundle of the whole harness as main.** Rejected: source-launch `dsh web` already boots the tree through tsx; duplicating that into a bundler fights workspace resolution.

## Success

On a machine that can already `pnpm dsh web`:

1. Electron is approved/installed.
2. Frontend dist and client bundles are built.
3. `pnpm dsh desktop` (optionally `--patch <overlay.yml>`) opens one window.
4. Session list, prompt, tools, and approvals work as in Web.
5. No process is listening on the Web port.
6. Closing the window exits.
