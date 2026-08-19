# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The dsh Electron-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it copies the Web host rows the GUI needs (API gateway, workspace, directory picker, `dsh.client` roster) and mounts this package's glue plugin, which provides `desktopRuntime`. It does not mount `webserver`, `frontend-static`, or LAN `trustedHosts`. Electron main is the harness process; the renderer talks IPC through the preload bridge. This package declares `dsh.client` with `immediately: true`. That client half provides `IpcApiClient` over the preload bridge and switches Session-log download to blob GET. Web never mounts this package. [`dsh-web-app`](../web-app/README.md) remains the browser HTTP surface over the same base.

## Model Experience

None, as the Electron glue provides IPC runtime state; prompts and tools belong to the composed base and desktop bundle rows.

#### KV Cache effect

None; the glue adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **Electron must be approved** — pnpm 10 blocks the Electron postinstall until `pnpm approve-builds` allows `electron`.
- **Frontend dist and client bundles must already be built** — first launch needs the same prior builds as `dsh web`, plus the desktop preload and renderer.
- **Source-launch only** — version one has no installer, tray, application menu, notifications, or packaged executable.
