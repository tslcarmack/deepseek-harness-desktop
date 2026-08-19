# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

dsh 的 Electron 表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠在 [`dsh-base`](../base/README.md) 之上：抄 Web 里 GUI 需要的 Host 行（API gateway、workspace、目录选择器、`dsh.client` 花名册），并挂载本包的粘合插件，由它提供 `desktopRuntime`。它不挂 `webserver`、`frontend-static` 或 LAN `trustedHosts`。Electron 主进程就是 harness 进程；渲染进程经 preload 桥走 IPC。本包声明 `dsh.client` 且 `immediately: true`。该客户端半边经 preload 桥提供 `IpcApiClient`，并把 Session 日志下载切到 blob GET。Web 从不挂载本包。[`dsh-web-app`](../web-app/README.md) 仍是同一 base 上的浏览器 HTTP 表层。

## 模型体验

无影响，因为 Electron 粘合只提供 IPC 运行时状态；提示词与工具由组成后的 base 和 desktop 组合包条目提供。

#### KV Cache 影响

无；粘合不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- **必须批准 Electron** — pnpm 10 会拦住 Electron 的 postinstall，直到 `pnpm approve-builds` 放行 `electron`。
- **frontend dist 和客户端 bundle 必须已经构建** — 首次启动需要与 `dsh web` 相同的前置构建，外加桌面 preload 和 renderer。
- **只做源码启动** — 第一版没有安装包、托盘、应用菜单、通知或打包可执行文件。
