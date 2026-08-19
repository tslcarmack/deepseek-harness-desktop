# Keep desktop IPC out of the Web client graph

English | [中文](2026-08-19-web-desktop-client-carrier-split-design.zh.md)

Status: proposed design. Implementation starts only after this file is reviewed. The shipped decision will live in an Agent Note in the same change that lands the code.

This design amends the client-carrier rule in [the desktop shell design](2026-08-18-desktop-shell-design.md). It does not change that spec's locked product decisions: Electron main is the harness, the renderer talks IPC, there is no TCP listen and no `dsh-host-webserver`, and version one stays source-launch `dsh desktop`.

## Problem

`dsh web` and `pnpm run dev:web` both paint a blank page. Both entries load the same `@deepseek-ai/dsh-client-connection` browser half. That half statically imports `IpcApiClient`, so Web boot evaluates desktop carrier code. Session-log blob download and other desktop branches also live in packages the Web graph mounts.

The success bar is Web behavior matching the pre-desktop client graph: desktop carrier code must not run on `dsh web` / `dev:web`, and must not sit on the Web connection client entry's static import graph. `dsh desktop` must keep opening. Desktop polish bugs are out of this change.

## Locked decisions

- Approach: Web's client graph contains no IPC implementation. Desktop IPC `provide('connection')` lives on a client half that only `dsh-desktop-app` mounts.
- Do not extract desktop into an out-of-tree `dsh plugin`. Do not revert shared Host dual-bind in a way that breaks `dsh desktop`.
- The connection browser `apply` constructs only `WebApiClient` and uses `window.fetch` for `rpc.call`. It must not import `IpcApiClient` or `ipcDoFetch`.
- Client bundle purity forbids a second plugin from value-importing `@deepseek-ai/dsh-client-connection/client`. `IpcApiClient` therefore moves into `dsh-desktop-app`'s own client half (relative imports plus inline-safe `@deepseek-ai/dsh-host-apiproxy/client`). `import type` of `ConnectionHandle` remains allowed.
- The connection browser `apply` may read `window.dshDesktop` (a tiny window check, not the IPC client). When the bridge exists it does not `provide('connection')`. The desktop-app client half, `immediately: true`, provides `IpcApiClient` and invoke-backed `rpc.call`.
- `dsh-session-log-export` browser `apply` is Web-only again: `HEAD` then hand the GET URL to the browser download manager. IPC GET, base64 body, and blob object-URL save live in the desktop-app client half (or a module only that half imports).
- Accidental desktop edits in `dsh-web-app`'s patch (including disabling HMR there) revert. If desktop keeps HMR disabled, that row stays only in `dsh-desktop-app`'s patch.
- Host `dsh-client-connection` keeps the dual bind: `webServer` → HTTP/WebSocket; `desktopRuntime` → `setApiFetch`. One process never mounts both carriers. `dsh web` does not provide `desktopRuntime`.

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

`client-modules` still scans every mounted host package that declares `dsh.client`. Web never mounts `dsh-desktop-app`, so Web never loads that client half. Desktop mounts both; provide-order is: connection skips, desktop-app provides.

## Data flow

Web unary RPC remains `POST /api/<method>` over `window.fetch`. Mux and host remain WebSocket `/api/events.mux` and `/api/events.host`. Session log remains `HEAD /api/session.export` then the browser download manager.

Desktop unary RPC remains `dshDesktop.invoke` through the existing preload bridge. Main still rewrites the request onto `http://127.0.0.1` with `Host: 127.0.0.1` and enters the shared `/api` handler (Typert interceptors, then ApiProxy). Non-textual IPC bodies keep `bodyEncoding: 'base64'`. Session log GETs the ZIP over invoke, decodes, and saves a blob object URL.

## Failures

Missing `ctx.connection` after boot is a loud startup failure on both surfaces, not a blank root. Two provides of `connection` is also a loud failure. Web Session-log errors stay HTTP/transport errors in the existing modal. Desktop Session-log errors from invoke, GET, or base64 decode use that same modal. Privileged RPCs stay loopback-on-Web and preload-bridge-on-desktop.

## Testing

Connection client tests: no `dshDesktop` → `WebApiClient` and `window.fetch`; with `dshDesktop` → no `provide`. A test (source import graph or built `lib/client.js`) proves the connection client entry has no static dependency on `IpcApiClient` / `ipc-api-client`.

Desktop-app client tests: with the bridge, provide `IpcApiClient` and send unary/RPC through invoke. Session-log-export tests cover HEAD + href only; blob-save tests move to the desktop-app client half. Host connection tests keep `webServer` vs `desktopRuntime` dual bind; Web composition tests never install `desktopRuntime`.

Assembled check: `dsh web` and `pnpm run dev:web` show the workspace/session shell. `dsh desktop` still opens and Session log still saves a ZIP over IPC. This change does not re-record model-conversation snapshots and does not include unrelated desktop polish.

Package READMEs (connection, desktop-app, session-log-export) and the [desktop IPC carrier Agent Note](../../../.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md) state that the Web client graph does not load the IPC client implementation.

## Out of scope

Out-of-tree `dsh plugin` packaging for desktop. Fixing remaining desktop UI/Host nits. New GUI. Electron `dialog`/`shell`. IPC client HMR. Page-level `fetch`/`WebSocket` polyfills.

## Alternatives considered

**Fix the blank page and leave `IpcApiClient` on the connection client entry behind `window.dshDesktop`.** Rejected: Web still evaluates desktop carrier modules at boot, which is the failure mode of the blank page.

**Revert every shared-package desktop diff.** Rejected: `dsh desktop` would stop booting.

**New npm package whose only job is the IPC client plugin.** Deferred: `dsh-desktop-app`'s client half already mounts only on desktop and avoids a third immediately-tier name.

## Success

1. `pnpm dsh web` and `pnpm run dev:web` show the pre-desktop Web shell (workspace picker / session list / chat), not a blank page.
2. The connection client entry does not statically import `IpcApiClient`.
3. `pnpm dsh desktop` still opens one window and Session log still saves over IPC.
4. Web Session log still uses HEAD + the browser download manager.
