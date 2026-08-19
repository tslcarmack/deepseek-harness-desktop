# Independent desktop Agent product over published Harness packages

English | [中文](2026-08-19-independent-desktop-agent-design.zh.md)

Status: proposed design. Implementation starts only after this file is reviewed. The shipped decision for work that lands in this repository will live in an Agent Note in the same change as that code.

This design is the product-home for the Electron desktop surface. It does not replace the client-carrier rules in [the Web/desktop client-carrier split](2026-08-19-web-desktop-client-carrier-split-design.md). It does change the earlier in-tree plan that desktop would ship as `dsh desktop` inside this monorepo: the window, desktop bundle, product CLI, and Agent plugins live in a separate git repository that consumes `@deepseek-ai/dsh-*` as npm packages.

## Problem

The `feat/desktop-shell` branch delivers the wanted window (Electron main is the harness, renderer IPC, no TCP), but the implementation edits Harness packages and the CLI. Tracking upstream then means merging a product shell through every Harness update.

The wanted outcome is a private Agent on top of the open-source kernel, with kernel updates coming from published packages rather than a git fork of this monorepo.

## Locked decisions

- Do not git-fork `deepseek-harness`. Consume `@deepseek-ai/dsh-*` from npm.
- Until those packages include the desktop Host and client hooks listed under Architecture, consume a private or local registry build produced from this branch (or an equivalent commit). Upstream those hooks later; do not block the product repo on that PR.
- The product repository is a Harness installation root, not a wrapper around `dsh web` and not a `dsh plugin` overlay on the official `dsh` binary.
- The product CLI (example name `my-agent`) owns `desktop`. Live start spawns Electron; Electron main boots the product profile. `--dump-config` stays in Node and does not spawn Electron. Do not call upstream `dsh desktop` or `PROFILE_TEMPLATES.desktop`.
- Profile example name `my-agent`. Bundles in order: `@deepseek-ai/dsh-base`, the product desktop bundle, the product Agent bundle. Do not stack `dsh-web-app`. No TCP listen and no `dsh-host-webserver`.
- Electron main **is** the harness process. The renderer talks IPC through the preload bridge. The window runs the published React client (`AppWebEntry` + the host-authored `dsh.client` graph). No second GUI.
- Version one is source-launch: one window, close window exits. No installer, tray, application menu, notifications, auto-update, or signing.
- Client-plugin HMR over IPC is out of version one.
- A full Harness upgrade runbook is out of version one. The product README states: bump the private-registry `@deepseek-ai/dsh-*` versions and restart the window.

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

`loadProfile` stays two-anchored: the product installation first, then `$DSH_HOME/profiles/my-agent`. First live `my-agent desktop` initializes that profile directory when missing. The user's `cordis.patch.yml` applies after the three bundle layers.

Required hooks in the consumed `@deepseek-ai/dsh-*` build (today on `feat/desktop-shell`):

- Host `dsh-client-connection`: bind `toFetchHandler` to HTTP/WebSocket when `webServer` is present, or to `desktopRuntime.setApiFetch` when that service is present; fail loud when neither exists. One process never mounts both carriers.
- Connection browser `apply` constructs `WebApiClient` (or the fixture client) and uses `window.fetch`. When `window.dshDesktop` is present and `?fixture` is absent, it does not `provide('connection')`.
- `dsh-session-log-export` browser `apply` is HEAD then the browser download manager. The controller exposes `adoptBlobTransport`.
- `dsh-client-modules` registers `/plugins` and the boot-manifest index tap when `webServer` appears, including if that service arrives after the modules row starts (Web). Desktop never mounts `webServer`.

Those hooks are not a capability seam. They are Host and client mounting rules the product bundle relies on.

## Components

Four packages in the product repository (one git repo, workspace ok):

| Package | Does | Does not |
|---|---|---|
| CLI / installation root | `my-agent desktop` spawns Electron; `--dump-config` uses `boot`; `INSTALL_ANCHOR` is this repo; forwards `--patch` | IPC implementation; Harness kernel edits |
| Electron shell | main, preload, `loadFile` of the published frontend dist; invoke only from this window's `webContents` | A second GUI; `import('electron')` from the renderer |
| Desktop bundle | `dsh.bundle.patch`: Host rows the GUI needs (API gateway, workspace, modules, connection, directory picker, `dsh.client` roster); provides `desktopRuntime`; `immediately: true` client half provides `IpcApiClient` and calls `adoptBlobTransport` | `webserver` / `frontend-static`; a value import of `@deepseek-ai/dsh-client-connection/client` (client-bundle purity: relative copies plus inline-safe `@deepseek-ai/dsh-host-apiproxy/client`; `import type` of `ConnectionHandle` is allowed) |
| Agent bundle | Product presets, tools, prompts, private plugins | Window or carrier |

This Harness checkout: move Electron, the in-tree desktop-app bundle, and `dsh desktop` off the upstream product tree. Keep (and later PR) only the hooks above.

## Data flow

1. `my-agent desktop` spawns Electron. This process does not `boot()`.
2. Electron main runs `healProfilesModuleFallback` then `runProfile({ profile: 'my-agent' })`. Missing `desktopRuntime` after boot is a loud failure.
3. One `BrowserWindow`. Preload injects `window.dshDesktop` (invoke, mux, host, loadBundle) and `window.__DSH_BOOT__` from `clientModules.graph()`.
4. The renderer runs published `AppWebEntry`. The connection client sees the bridge without `?fixture` and does not provide. The desktop bundle's immediately half provides `IpcApiClient`; `rpc.call` uses invoke, not `window.fetch`.
5. Host connection binds the same `/api` handler to `desktopRuntime.setApiFetch`. Main rewrites each invoke onto `http://127.0.0.1` with `Host: 127.0.0.1` (a Fetch Request has no Host). Renderer Origin is dropped because the privilege is the preload bridge. The rewritten request enters Typert interceptors, then ApiProxy. Mux/host are JSON subscriptions, not WebSockets. Non-textual IPC bodies use `bodyEncoding: 'base64'`.
6. Session-log: Web plugin stays HEAD + href. After `sessionLogDownload` exists, the desktop immediately half calls `adoptBlobTransport`.
7. Close window: `ctx.fiber.dispose()` then `app.quit()`.

## Failures

Installation-root resolution failure, a listed bundle without a `dsh.bundle` declaration, missing Electron or tsx, and missing preload or frontend dist throw at start with a recovery hint. IPC accepts only this window's `webContents`; any other sender is refused.

A consumed package build that lacks `desktopRuntime`, still statically includes `IpcApiClient` on the connection client entry, or never injects `/plugins` when `webServer` is present, is a configuration error. Do not fall back to HTTP. Missing `ctx.connection` and two `provide('connection')` calls stay loud Cordis failures. Do not add a blank-root placeholder.

## Testing

Product repo:

- CLI: `desktop` spawns Electron and does not boot in the CLI process; `--dump-config` prints `dsh-base` plus the two product bundles.
- Host: glue provides `desktopRuntime` and `setApiFetch`; composition has no `webServer`.
- Client: bridge present → provide `IpcApiClient`; `?fixture` skips provide.
- Session-log: after adopt, invoke GET and blob save.
- Assembled: one window opens; workspace picker / session list / chat shell paints.

Do not re-record Harness model-conversation snapshots in this change. Against the locked Harness build, assert `packages/client/connection/lib/client.js` (or the published equivalent) does not contain `IpcApiClient`.

## Out of scope

Installer, tray, menu, notifications, auto-update, signing. A native window around `dsh web` or a client against a running HTTP server. Page-level `fetch` / `WebSocket` polyfills. IPC client HMR. Merging Electron into upstream `dsh desktop`. A full upgrade runbook.

## Alternatives considered

**Official `dsh` CLI plus `dsh plugin` overlay.** Rejected: the product would still bind the upstream binary, profile names, and spawn path.

**Git submodule of this monorepo.** Rejected: that is a fork in practice; kernel updates would not come from published packages.

**Out-of-tree plugin that value-imports `@deepseek-ai/dsh-client-connection/client`.** Rejected: client-bundle purity forbids it; the desktop bundle keeps its own IPC client half.

## Success

1. From the product repository, `my-agent desktop` (or the chosen bin name) opens one window and the workspace/session shell paints.
2. `--dump-config` for the product profile lists `@deepseek-ai/dsh-base`, the desktop bundle, and the Agent bundle, and does not spawn Electron.
3. The product depends on `@deepseek-ai/dsh-*` as packages (private registry allowed). It does not vendor `packages/core`.
4. Close window exits. No TCP listen.
