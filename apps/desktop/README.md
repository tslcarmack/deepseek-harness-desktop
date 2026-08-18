# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron main is the harness process: it boots the `desktop` profile through [`runProfile`](../cli/src/profile-boot.ts), opens one `BrowserWindow`, and talks to the renderer over the preload bridge (`window.dshDesktop` plus `window.__DSH_BOOT__`). There is no TCP listen and no `dsh-host-webserver`. The renderer reuses [`AppWebEntry`](../../packages/client/web/README.md) with a `loadBundle` seam that reads client `lib/client.js` files through IPC. Source-launch only: `dsh desktop` spawns this main with `tsx`.

## Model Experience

None, as this app provides the Electron window and IPC carrier; prompts and tools belong to the composed `desktop` profile.

#### KV Cache effect

None; the shell adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **Electron must be approved** — pnpm 10 blocks the Electron postinstall until `pnpm approve-builds` allows `electron`.
- **Preload, renderer, frontend dist, and client bundles must already be built** — first launch needs `pnpm run build` of client packages, then `pnpm --filter @deepseek-ai/dsh-desktop build` for `lib/preload.cjs` and `dist/`.
- **Source-launch only** — version one has no installer, tray, application menu, notifications, or packaged executable.
