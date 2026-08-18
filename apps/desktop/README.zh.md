# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

Electron 主进程就是 harness 进程：它通过 [`runProfile`](../cli/src/profile-boot.ts) 启动 `desktop` profile，打开一个 `BrowserWindow`，并经 preload 桥与渲染进程通信（`window.dshDesktop` 加上 `window.__DSH_BOOT__`）。不监听 TCP，也不挂 `dsh-host-webserver`。渲染进程复用 [`AppWebEntry`](../../packages/client/web/README.md)，用 `loadBundle` 缝通过 IPC 读取客户端 `lib/client.js`。只做源码启动：`dsh desktop` 用 `tsx` spawn 本主进程。

## 模型体验

无影响，因为本应用只提供 Electron 窗口和 IPC 载体；提示词与工具由组成后的 `desktop` profile 提供。

#### KV Cache 影响

无；外壳不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- **必须批准 Electron** — pnpm 10 会拦住 Electron 的 postinstall，直到 `pnpm approve-builds` 放行 `electron`。
- **preload、renderer、frontend dist 和客户端 bundle 必须已经构建** — 首次启动需要先 `pnpm run build` 客户端包，再 `pnpm --filter @deepseek-ai/dsh-desktop build` 生成 `lib/preload.cjs` 和 `dist/`。
- **只做源码启动** — 第一版没有安装包、托盘、应用菜单、通知或打包可执行文件。
