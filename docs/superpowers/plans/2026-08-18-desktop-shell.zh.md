# 桌面壳实现计划

[English](2026-08-18-desktop-shell.md) | 中文

> **面向 agentic worker：** 必用子技能：用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步实现本计划。步骤用 checkbox（`- [ ]`）跟踪。

**目标：** 源码启动的 `dsh desktop` 打开一个 Electron 窗口，启动 `desktop` profile，经 IPC 复用现有 React 客户端插件，并且从不监听 TCP 端口。

**架构：** Electron 主进程就是 harness 进程（`runProfile({ profile: 'desktop' })`）。Node 上的 `dsh` CLI 只在实况启动时 spawn 该二进制。`dsh-desktop-app` 叠在 `dsh-base` 上，不叠 `dsh-web-app` / `webserver`。渲染进程加载已构建的 `dsh-web-frontend` dist；preload 注入 `__DSH_BOOT__` 和 `window.dshDesktop`；`IpcApiClient` 是 `AbstractApiClient` 的子类。

**技术栈：** Cordis 插件、现有 ApiProxy `toFetchHandler`、Electron 35（devDependency，主进程经 `tsx/esm` 源码启动）、现有客户端 `lib/client.js` bundle。

**规格：** [docs/superpowers/specs/2026-08-18-desktop-shell-design.md](../specs/2026-08-18-desktop-shell-design.md)

## 全局约束

- desktop profile 不监听 TCP，也不挂 `dsh-host-webserver`。
- 不做第二套 GUI；复用 `AppWebEntry` 和主机编写的 `dsh.client` 图。
- 第一版只做源码启动：没有安装包、托盘、菜单、通知、IPC 客户端 HMR（热模块替换）、Electron `dialog`/`shell` 替换、自定义 `dsh://` HTTP 伪装，或页面级 `fetch`/`WebSocket` polyfill。
- 关闭窗口即退出；启动失败走 stderr + `installFailLoud` + exit 1；没有 Electron 错误对话框。
- 组装 GUI 快照仍走 `test:web`。第一版没有真实 Electron 的 CI 门禁。
- 渲染进程从不 import `ipcRenderer`。特权 RPC 被允许，是因为 preload 桥存在（存在 `window.dshDesktop` 时 `isLoopback: true`）。把 IPC `Request` URL 重建为 `http://127.0.0.1/api/...`，让现有 loopback 围栏仍然通过。
- 图行 URL 保持 `/plugins/<id>/client.js?rev=...`；`BootSeams.loadBundle` 拦截它们。
- `dsh-desktop-app` 遵循 [docs/cookbook/adding-a-package.md](../../cookbook/adding-a-package.md)。非平凡提交包含任务 1 点名的 Agent Note。
- 每个任务的测试使用原生 `node:path` / `node:url`（不要只用 POSIX 字面量）。文件以恰好一个尾随换行结束。

## 文件结构

| 路径 | 职责 |
|---|---|
| `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md`（+ `.zh.md` + `.i18n.yaml`） | 已落地决策 |
| `packages/client/modules/src/index.ts` | `ClientModuleRegistry` 可选 `webServer`；仅在存在时注册 HTTP 路由 |
| `packages/client/connection/src/client/ipc-api-client.ts` | `IpcApiClient` |
| `packages/client/connection/src/client/index.ts` | 选择 fixture（测试前置数据）/ IPC / Web；桌面 `isLoopback` |
| `packages/client/connection/src/desktop-runtime.ts` | 节点半边消费的结构型 `DesktopRuntime` |
| `packages/client/connection/src/ipc-downlink.ts` | 把 `api.events.mux` / `host` 泵到 `DesktopRuntime.sendFrame` |
| `packages/client/connection/src/index.ts` | 双绑定：`webServer` 或 `desktopRuntime`，否则明确失败 |
| `packages/bundle/desktop-app/` | 新组合包：patch + 提供 `desktopRuntime` 的粘合插件 |
| `packages/boot/app-boot/src/profile.ts` | `PROFILE_TEMPLATES.desktop` |
| `apps/desktop/` | Electron main、preload、package.json |
| `apps/cli/src/args.ts`、`bin.ts` | `dsh desktop` 别名；仅在实况 profile 启动时 spawn Electron |
| `pnpm-workspace.yaml` | `allowBuilds.electron: true` |

不要把 `electron` 加到任何 `packages/*` 包的依赖里。只有 `apps/desktop` 依赖 `electron`。

---

### 任务 1：ClientModuleRegistry 上可选的 webServer + Agent Note

`ClientModuleRegistry` 目前 `static inject = ['webServer', 'loader']`，并且总是注册 `/plugins` 和 index tap。桌面没有 webserver。图的组合和 `clientPath(id)` 必须在没有它时也能工作。

**文件：**
- 新建：`.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md` 以及 `.zh.md` / `.i18n.yaml`（正文 = 规格的 Decision、Alternatives、Consequences；Status: implemented）
- 修改：`packages/client/modules/src/index.ts`（`static inject`、构造函数路由注册）
- 测试：`packages/client/modules/tests/node-half.client.spec.ts`

**接口：**
- 消费：现有 `graph(): WebBootGraph`、`clientPath(id: string): string | undefined`
- 产出：registry 只用 `loader` 即可构造；`webServer` 的 HTTP effect 仅当 `ctx.get('webServer')` 有定义时运行

- [ ] **步骤 1：编写会失败的测试**

加到 `packages/client/modules/tests/node-half.client.spec.ts`：

```ts
it('composes the boot graph without a webServer', async () => {
  const ctx = new Context()
  await ctx.plugin(Loader)
  // seed the same fixture entries the existing HTTP test uses, but do not provide webServer
  await ctx.plugin(ClientModuleRegistry)
  const modules = ctx.get('clientModules')
  expect(modules).toBeDefined()
  expect(modules.graph().entries.length).toBeGreaterThan(0)
})
```

从该文件现有的 `webServer` 测试改编 fixture 播种，让图非空。不要注册假的 HTTP 路由。

- [ ] **步骤 2：跑测试并确认它失败**

运行：`pnpm exec vitest run packages/client/modules/tests/node-half.client.spec.ts -t "without a webServer"`

预期：FAIL，因为 `inject` 仍要求 `webServer`（fiber pending 或构造函数抛错）。

- [ ] **步骤 3：最小实现**

在 `packages/client/modules/src/index.ts`：

```ts
static inject = ['loader']
```

在构造函数里，`this.composed = this.compose()` 和 activation flush 之后，把两处 `ctx.webServer` effect 包起来：

```ts
const webServer = ctx.get('webServer')
if (webServer !== undefined) {
  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: '/plugins', handler: this.serveBundle }),
    'client-modules: bundle route',
  )
  ctx.effect(
    () => webServer.tapIndex(html => injectBootManifest(html, this.composed)),
    'client-modules: boot manifest injection',
  )
}
```

现有 HTTP 测试全部保持不变。按规格写 Agent Note 三件套（现在时）。记录配对：`pnpm run verify-translation-pairing --write .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md`。

- [ ] **步骤 4：跑测试**

运行：`pnpm exec vitest run packages/client/modules/tests/node-half.client.spec.ts`

预期：全部 PASS，包括新用例和现有 HTTP 注册用例。

- [ ] **步骤 5：提交**

```bash
git add packages/client/modules/src/index.ts packages/client/modules/tests/node-half.client.spec.ts .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.zh.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.i18n.yaml
git commit -m "feat(modules): compose the client boot graph without webServer"
```

---

### 任务 2：IpcApiClient

**文件：**
- 新建：`packages/client/connection/src/client/ipc-api-client.ts`
- 新建：`packages/client/connection/src/client/dsh-desktop.ts`（桥类型 + `readDshDesktop()`）
- 测试：`packages/client/connection/tests/ipc-api-client.client.spec.ts`（第一行 `// @vitest-environment jsdom`）

**接口：**
- 消费：`AbstractApiClient`（`doFetch(input: URL, init?: RequestInit): Promise<Response>`、`openMux` / `openHost`）
- 产出：

```ts
export interface IpcFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}
export interface IpcFetchResponse {
  status: number
  headers: Record<string, string>
  body: string
}
export interface DshDesktopBridge {
  invoke(request: IpcFetchRequest): Promise<IpcFetchResponse>
  onMux(listener: (json: string) => void): () => void
  onHost(listener: (json: string) => void): () => void
  loadBundle(url: string): Promise<string>
}
export function readDshDesktop(): DshDesktopBridge | undefined
export class IpcApiClient extends AbstractApiClient
```

除非 `globalThis` 上有带 `invoke`、`onMux`、`onHost` 和 `loadBundle` 的 `dshDesktop` 对象，否则 `readDshDesktop` 返回 `undefined`。

- [ ] **步骤 1：编写会失败的测试**

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { IpcApiClient } from '../src/client/ipc-api-client.ts'
import { RpcId } from '../src/client/api.ts'

it('posts unary envelopes through the desktop invoke bridge and echoes rpcId', async () => {
  const invoke = vi.fn(async (request: { body: string | null }) => {
    const sent = JSON.parse(request.body ?? '{}') as { rpcId: string }
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'server-response',
        rpcId: sent.rpcId,
        result: { ok: true, value: { items: [] } },
      }),
    }
  })
  ;(globalThis as { dshDesktop?: unknown }).dshDesktop = {
    invoke,
    onMux: () => () => {},
    onHost: () => () => {},
    loadBundle: async () => '',
  }
  const client = new IpcApiClient()
  const result = await client.sessions.list({})
  expect(result.result.ok).toBe(true)
  expect(invoke).toHaveBeenCalled()
  const posted = invoke.mock.calls[0]?.[0] as { url: string; method: string }
  expect(posted.method).toBe('POST')
  expect(posted.url).toContain('/api/session.list')
})
```

若占位 `{ items: [] }` 在第二次 parse 失败，把 `sessions.list` 的值改成匹配 `UNARY_VALUE_SCHEMAS['session.list']` —— 从 `client-apply.client.spec.ts` 抄一个合法值。

- [ ] **步骤 2：跑测试并确认它失败**

运行：`pnpm exec vitest run packages/client/connection/tests/ipc-api-client.client.spec.ts`

预期：FAIL（模块找不到）。

- [ ] **步骤 3：实现 IpcApiClient**

`doFetch`：

```ts
protected async doFetch(input: URL, init?: RequestInit): Promise<Response> {
  const desktop = readDshDesktop()
  if (desktop === undefined) throw new Error('client-connection: IpcApiClient requires window.dshDesktop')
  const headers: Record<string, string> = {}
  const raw = init?.headers
  if (raw instanceof Headers) raw.forEach((value, key) => { headers[key] = value })
  else if (Array.isArray(raw)) for (const [key, value] of raw) headers[key] = value
  else if (raw !== undefined) for (const [key, value] of Object.entries(raw)) headers[key] = value
  const body = typeof init?.body === 'string' ? init.body : init?.body == null ? null : String(init.body)
  const reply = await desktop.invoke({ url: input.href, method: init?.method ?? 'GET', headers, body })
  return new Response(reply.body, { status: reply.status, headers: reply.headers })
}
```

像 `WebApiClient.readWebSocket` 那样覆盖 `openMux` / `openHost`，但用 `desktop.onMux` / `onHost` 订阅，先 parse `serverRequestSchema` 再 parse 帧 schema，调用 `this.onEnvelope(full)`，yield `{ rpcId, payload: frame }`，abort 时取消订阅。订阅后立刻调用 `onOpen`（IPC 没有握手）。畸形 JSON 像 WebSocket 路径一样用 `console.error` 丢掉。

- [ ] **步骤 4：跑测试**

运行：`pnpm exec vitest run packages/client/connection/tests/ipc-api-client.client.spec.ts packages/client/connection/tests/client-apply.client.spec.ts`

预期：PASS。现有 Web/fixture apply 测试仍然通过。

- [ ] **步骤 5：提交**

```bash
git add packages/client/connection/src/client/ipc-api-client.ts packages/client/connection/src/client/dsh-desktop.ts packages/client/connection/tests/ipc-api-client.client.spec.ts
git commit -m "feat(connection): add IpcApiClient over the desktop preload bridge"
```

---

### 任务 3：connection 客户端 apply 选用 IpcApiClient

**文件：**
- 修改：`packages/client/connection/src/client/index.ts`
- 测试：`packages/client/connection/tests/client-apply.client.spec.ts`

**接口：**
- 消费：`readDshDesktop()`、`IpcApiClient`、现有 `FixtureApiClient` / `WebApiClient`
- 产出：存在 `dshDesktop` 且没有 `?fixture` 时 `ctx.connection.api` 是 `IpcApiClient`；存在 `dshDesktop` 时 `isLoopback` 为 `true`

- [ ] **步骤 1：编写会失败的测试**

```ts
it('uses IpcApiClient and reports loopback when the desktop bridge is present', async () => {
  ;(globalThis as { dshDesktop?: unknown }).dshDesktop = {
    invoke: async () => ({ status: 200, headers: {}, body: '{}' }),
    onMux: () => () => {},
    onHost: () => () => {},
    loadBundle: async () => '',
  }
  vi.stubGlobal('location', { hostname: '', search: '', origin: 'null' })
  const handle = await mount() // existing helper in this file
  expect(handle.api).toBeInstanceOf(IpcApiClient)
  expect(handle.isLoopback).toBe(true)
})
```

保留现有 `WebApiClient` 测试。`?fixture` 仍然优先于 IPC。

- [ ] **步骤 2：跑测试并确认它失败**

运行：`pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts -t "desktop bridge"`

预期：FAIL（仍构造 `WebApiClient`；空 hostname 时 `isLoopback` 为 false）。

- [ ] **步骤 3：实现选择逻辑**

在 `apply` 里：

```ts
const desktop = readDshDesktop()
const api: IApiClient = fixtureClient ?? (desktop !== undefined ? new IpcApiClient() : new WebApiClient())
```

```ts
isLoopback: desktop !== undefined || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
```

- [ ] **步骤 4：跑测试**

运行：`pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/client/connection/src/client/index.ts packages/client/connection/tests/client-apply.client.spec.ts
git commit -m "feat(connection): select IpcApiClient when the desktop bridge is present"
```

---

### 任务 4：DesktopRuntime + connection 节点双绑定

**文件：**
- 新建：`packages/client/connection/src/desktop-runtime.ts`
- 新建：`packages/client/connection/src/ipc-downlink.ts`
- 修改：`packages/client/connection/src/index.ts`（`inject`、`apply`）
- 测试：`packages/client/connection/tests/node-half.host.spec.ts`

**接口：**
- 消费：`toFetchHandler(apiProxy).fetch`、`api.events.mux` / `host`（与 `WebSocketDownlinks` 相同）
- 产出：

```ts
export interface DesktopRuntime {
  setApiFetch(fetch: (request: Request) => Promise<Response>): () => void
  sendFrame(stream: 'mux' | 'host', json: string): void
}
```

Context 合并（在 `desktop-runtime.ts`）：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopRuntime: DesktopRuntime
  }
}
```

`export const inject = []`（替换 `['webServer']`）。`apply` 使用 `ctx.get('webServer')` 和 `ctx.get('desktopRuntime')`。

IPC `Request` 重建用 `new Request(url.replace(/^file:\/\/.*$/u, 'http://127.0.0.1') …)` 是错的。正确做法是：桌面粘合稍后转发 invoke 时传入类似 `http://dsh.internal/api/session.list` 的 URL（file:// 的 origin 是 `'null'`，所以 `AbstractApiClient.resolveBase()` 是 `http://dsh.internal`）。节点半边的 fetch handler 应在 `isTrustedApiRequest` / 特权检查之前把 hostname 改写成 `127.0.0.1`，或构造 `new Request('http://127.0.0.1' + pathname + search, init)`。

特权方法：改写之后，`isTrustedApiRequest(request, [])` 对 127.0.0.1 为 true，与 loopback 一致。不要为任意 IPC 发送方跳过 `PRIVILEGED_METHODS` —— 只有本进程的 preload 能调用 invoke（任务 6 用 `event.sender === window.webContents` 强制）。

- [ ] **步骤 1：编写会失败的测试**

在 `node-half.host.spec.ts`：

```ts
it('fails loud when neither webServer nor desktopRuntime is present', async () => {
  const ctx = new Context()
  await expect(ctx.plugin({ apply, inject: [] })).rejects.toThrow(/webServer or desktopRuntime/)
})

it('installs api fetch on desktopRuntime and does not register HTTP routes', async () => {
  const frames: { stream: string; json: string }[] = []
  let fetch: ((request: Request) => Promise<Response>) | undefined
  const ctx = new Context()
  ctx.provide('desktopRuntime', {
    setApiFetch(next) {
      fetch = next
      return () => { fetch = undefined }
    },
    sendFrame(stream, json) { frames.push({ stream, json }) },
  })
  ctx.provide('apiProxy', fakeApiProxy) // copy the existing test double
  await ctx.plugin({ name: 'client-connection', apply, inject: [] })
  expect(fetch).toBeTypeOf('function')
  const response = await fetch!(new Request('http://dsh.internal/api/session.list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc_test',
      method: 'session.list',
      payload: {},
    }),
  }))
  expect(response.ok).toBe(true)
})
```

若 schema 要求品牌格式，使用真实 `RpcId`。现有 HTTP 测试全部保留：它们仍 `provide('webServer', fakeHttpServer(...))`。

- [ ] **步骤 2：跑测试并确认它失败**

运行：`pnpm exec vitest run packages/client/connection/tests/node-half.host.spec.ts -t "desktopRuntime"`

预期：FAIL（`inject` 仍是 `['webServer']`，或 apply 总是注册 HTTP）。

- [ ] **步骤 3：实现双绑定**

把 `export const inject = ['webServer']` 换成 `export const inject: string[] = []`。

在 `apply` 开头：

```ts
const webServer = ctx.get('webServer')
const desktopRuntime = ctx.get('desktopRuntime')
if (webServer === undefined && desktopRuntime === undefined) {
  throw new Error('client-connection: needs webServer or desktopRuntime')
}
```

若 `webServer` 有定义，保持当前路由 + WebSocket 块不变（用那个 `webServer`，不要用 `ctx.webServer`）。

若 `desktopRuntime` 有定义：

```ts
ctx.effect(() => desktopRuntime.setApiFetch(async (request) => {
  const url = new URL(request.url)
  const local = new Request(`http://127.0.0.1${url.pathname}${url.search}`, request)
  const method = url.pathname.startsWith(`${API_PATH}/`)
    ? url.pathname.slice(API_PATH.length + 1)
    : undefined
  if (method !== undefined && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(local, [])) {
    return new Response('forbidden', { status: 403 })
  }
  const apiProxy = ctx.get('apiProxy')
  if (apiProxy === undefined) return new Response('not found', { status: 404 })
  return toFetchHandler(apiProxy).fetch(local)
}), 'client-connection: desktop ipc fetch')

ctx.inject(['apiProxy'], (apiCtx) => {
  const downlinks = new IpcDownlinks(apiCtx.apiProxy, desktopRuntime)
  apiCtx.effect(() => downlinks.start(), 'client-connection: ipc downlinks')
})
```

`IpcDownlinks.start()` 返回一个 abort 两条泵的 disposer。实现：从 `WebSocketDownlinks` 抄泵循环（for-await `api.events.mux` / `host`，`JSON.stringify` `{ type: 'server-request', rpcId, method: frame.payload.type, payload: frame.payload }`，`desktopRuntime.sendFrame`）。不要 import `ws`。窗口尚未挂上时吞掉 `sendFrame` 抛错（任务 6 在 boot 之后挂窗口）。

第一版不得在同一进程安装两种载波，但 `apply` 可能只看到两个服务中的一个。

- [ ] **步骤 4：跑测试**

运行：`pnpm exec vitest run packages/client/connection/tests/node-half.host.spec.ts packages/client/connection/tests/websocket-downlink.host.spec.ts packages/client/connection/tests/http-bridge.host.spec.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add packages/client/connection/src/index.ts packages/client/connection/src/desktop-runtime.ts packages/client/connection/src/ipc-downlink.ts packages/client/connection/tests/node-half.host.spec.ts
git commit -m "feat(connection): bind ApiProxy to desktopRuntime when webServer is absent"
```

---

### 任务 5：dsh-desktop-app 组合包 + desktop profile 模板

**文件：**
- 新建：`packages/bundle/desktop-app/`，照 `packages/bundle/web-app/`（package.json、tsconfig.json、src/index.ts、src/invariant.ts、cordis.patch.yml、README.md + README.zh.md + i18n.yaml）
- 修改：`packages/boot/app-boot/src/profile.ts`（`PROFILE_TEMPLATES.desktop`）
- 修改：`packages/boot/app-boot/tests/profile.spec.ts`
- 修改：`tsconfig.host.json`（加 `{ "path": "./packages/bundle/desktop-app" }`）
- 修改：`packages/bundle/README.md` 和 `README.zh.md`（表格行）
- 修改：`apps/cli/package.json`（依赖 `@deepseek-ai/dsh-desktop-app`）
- 测试：`packages/bundle/desktop-app/tests/composition.spec.ts`

**接口：**
- 消费：任务 4 的 `DesktopRuntime`
- 产出：粘合插件提供的 `ctx.desktopRuntime`；profile 模板 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app']`

粘合插件（`packages/bundle/desktop-app/src/index.ts`）：

```ts
export const name = 'desktop-app'
export const inject: string[] = []

export interface DesktopRuntimeImpl extends DesktopRuntime {
  readonly graph: () => WebBootGraph
  loadBundleSource(url: string): Promise<string>
}

export function apply(ctx: Context): void {
  const muxListeners = new Set<(json: string) => void>()
  const hostListeners = new Set<(json: string) => void>()
  let apiFetch: ((request: Request) => Promise<Response>) | undefined
  const runtime: DesktopRuntimeImpl = {
    setApiFetch(fetch) {
      apiFetch = fetch
      return () => { if (apiFetch === fetch) apiFetch = undefined }
    },
    sendFrame(stream, json) {
      const listeners = stream === 'mux' ? muxListeners : hostListeners
      for (const listener of listeners) listener(json)
    },
    graph: () => {
      const modules = ctx.get('clientModules')
      if (modules === undefined) throw new Error('desktop-app: clientModules is not mounted')
      return modules.graph()
    },
    async loadBundleSource(url) {
      const id = decodeURIComponent(new URL(url, 'http://dsh.internal').pathname.replace(/^\/plugins\//u, '').replace(/\/client\.js$/u, ''))
      const modules = ctx.get('clientModules')
      const path = modules?.clientPath(id)
      if (path === undefined) throw new Error(`desktop-app: no client bundle for ${id}`)
      return readFile(path, 'utf8')
    },
  }
  // Also expose mux/host subscribe for preload wiring in apps/desktop:
  // store muxListeners/hostListeners on the impl via extra methods subscribeMux/subscribeHost.
  ctx.provide('desktopRuntime', runtime)
}
```

在 impl 上加 `subscribeMux` / `subscribeHost`（不要加到 connection 面对的 `DesktopRuntime`），让 apps/desktop 在窗口存在后把 `sendFrame` 转到 `webContents.send`。connection 的 `IpcDownlinks` 调用 `sendFrame`；粘合向 apps/desktop 注册的订阅者扇出。

`cordis.patch.yml`：抄 `packages/bundle/web-app/cordis.patch.yml`，然后：

- 删除 `web-startup`、`webserver`、`web-runtime` 行（HTTP 打印机 / frontend-static / trustedHosts）。
- 在 `modules` 之前插入 `id: desktop-runtime`、`name: '@deepseek-ai/dsh-desktop-app'`。
- 保留 `modules`、`connection`、完整 `dsh.client` 花名册、`client-hmr`、workspace、apiproxy、directory-picker，以及 web-app 插入的其他 Host 行。
- 改 connection 配置：去掉 `trustedHosts: !!js ctx.webRuntime.trustedHosts`（没有 LAN）。用 `trustedHosts: []` 或省略（schema 默认 `[]`）。
- 从 connection 行去掉 `inject: [webRuntime]`。
- `client-hmr` 保持挂载（空闲）。

`package.json` 依赖：与 web-app 相同的客户端/Host 花名册，**减去** `dsh-host-webserver`、`dsh-host-frontend-static`；`dsh-web-frontend` 可以留下，因为粘合或 apps/desktop 经 `@deepseek-ai/dsh-web-frontend` 的 `createRequire` 解析 dist —— 加上该依赖，让 `require.resolve` 能工作。不要加 `electron`。

README Known Limitations：必须批准 Electron 二进制（`pnpm approve-builds`）；frontend dist 和客户端 bundle 必须已经构建；第一版没有安装包。

- [ ] **步骤 1：编写会失败的 profile + dump 测试**

在 `packages/boot/app-boot/tests/profile.spec.ts`，紧挨 web 模板断言：

```ts
expect(PROFILE_TEMPLATES.desktop).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app'])
```

在 `packages/bundle/desktop-app/tests/composition.spec.ts`：

```ts
it('dump of the desktop bundle has no webserver and includes desktop-runtime', () => {
  const text = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  expect(text).not.toMatch(/id: webserver/)
  expect(text).toMatch(/id: desktop-runtime/)
  expect(text).toMatch(/id: modules/)
  expect(text).toMatch(/id: connection/)
  expect(text).not.toMatch(/webRuntime/)
})
```

- [ ] **步骤 2：跑测试并确认它们失败**

运行：`pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts -t desktop`

预期：FAIL（`PROFILE_TEMPLATES.desktop` 未定义）。

- [ ] **步骤 3：创建包和模板**

从 web-app / headless 抄包脚手架。设置 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。加 `PROFILE_TEMPLATES.desktop`。登记 tsconfig.host.json。加 CLI 依赖。invariant 同伴：空安装器，理由是窗口/IPC effect 住在 `apps/desktop` 和 `connection`（或等任务 6 证明 `setApiFetch` 的 dispose 后再登记真实 invariant）。

文件存在后：`pnpm install`，让 workspace 链接。

- [ ] **步骤 4：跑测试**

运行：`pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts`

预期：PASS。

再跑：`pnpm exec tsx apps/cli/src/bin.ts --profile desktop --dump-default-config`（模板存在之后）。预期：YAML 含 `desktop-runtime`，不含 `webserver`。这只走 Node。

- [ ] **步骤 5：提交**

```bash
git add packages/bundle/desktop-app packages/boot/app-boot/src/profile.ts packages/boot/app-boot/tests/profile.spec.ts tsconfig.host.json packages/bundle/README.md packages/bundle/README.zh.md packages/bundle/README.i18n.yaml apps/cli/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add dsh-desktop-app bundle and desktop profile template"
```

若表格行改了两种语言，重新记录 `packages/bundle/README` 配对。

---

### 任务 6：apps/desktop Electron main + preload

**文件：**
- 新建：`apps/desktop/package.json`、`apps/desktop/src/main.ts`、`apps/desktop/src/preload.ts`、`apps/desktop/tsdown.config.ts`（仅 preload）、`apps/desktop/README.md` + `.zh.md` + `.i18n.yaml`
- 修改：`pnpm-workspace.yaml`（`allowBuilds.electron: true`）
- 修改：根 `package.json` 脚本 `"dsh:desktop": "pnpm dsh desktop"` 仅在需要时；优先用任务 7 的 CLI 别名
- 测试：`apps/desktop/tests/preload-bridge.spec.ts`（纯逻辑：序列化 invoke + boot 图；不 mock 真实 Electron）

**接口：**
- 消费：`apps/cli/src/profile-boot.ts` 的 `runProfile`（或重复 `profile-boot.ts` 使用的同一套 `@deepseek-ai/dsh-app-boot` + composeProfile 导入）。优先从 apps/desktop 能解析的路径导入 `runProfile`：若 `profile-boot.ts` 未导出则加具名导出。若 `apps/cli` 不导出 `runProfile`，把它抽到 `@deepseek-ai/dsh-app-boot`，或从 `apps/desktop` 相对导入 `apps/cli/src/profile-boot.ts` —— **不要** 复制 shutdown/signal 逻辑。本 monorepo 第一版可以接受从 `apps/desktop/src/main.ts` 相对导入 `../../cli/src/profile-boot.ts`。
- 产出：匹配 `DshDesktopBridge` 的窗口 + preload 桥

preload（构建到 `apps/desktop/lib/preload.cjs`，因为 Electron preload 必须是 CJS）：

```ts
import { contextBridge, ipcRenderer } from 'electron'

const graph = ipcRenderer.sendSync('dsh:boot-graph')
contextBridge.exposeInMainWorld('__DSH_BOOT__', graph)
contextBridge.exposeInMainWorld('dshDesktop', {
  invoke: (request: IpcFetchRequest) => ipcRenderer.invoke('dsh:invoke', request),
  onMux: (listener: (json: string) => void) => {
    const handler = (_event: unknown, json: string) => { listener(json) }
    ipcRenderer.on('dsh:mux', handler)
    return () => { ipcRenderer.off('dsh:mux', handler) }
  },
  onHost: (listener: (json: string) => void) => {
    const handler = (_event: unknown, json: string) => { listener(json) }
    ipcRenderer.on('dsh:host', handler)
    return () => { ipcRenderer.off('dsh:host', handler) }
  },
  loadBundle: (url: string) => ipcRenderer.invoke('dsh:load-bundle', url) as Promise<string>,
})
```

Main（源码启动，不打包）：

1. `app.whenReady()`
2. `runProfile({ profile: 'desktop', patchFiles, args, environment })`，CLI spawn 转发 `--` 之后的 argv
3. `const runtime = ctx.get('desktopRuntime')`（任务 5 的 impl）
4. 解析 frontend dist：`createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')`，或 `dsh-web-frontend` 已有的导出（从 `packages/bundle/web-app/src/index.ts` 抄解析）
5. `BrowserWindow` `{ webPreferences: { preload: pathToPreloadCjs, contextIsolation: true, nodeIntegration: false, sandbox: false } }` —— `sandbox: false` 匹配 WorkBuddy 对 contextBridge 的要求
6. `ipcMain.on('dsh:boot-graph', (event) => { event.returnValue = runtime.graph() })`，仅当 `event.sender === window.webContents`
7. `ipcMain.handle('dsh:invoke', async (event, request) => { if (event.sender !== window.webContents) throw new Error('desktop: foreign webContents'); const response = await runtime.fetchFromPreload(request); return response })`
8. 订阅 `runtime` 的 mux/host 监听器 → `window.webContents.send('dsh:mux', json)`（已销毁则吞掉）
9. `loadFile(indexHtml)`
10. `window.on('closed')` → dispose `ctx.fiber` 然后 `app.quit()`
11. `installFailLoud('dsh', process, () => ctx.fiber.dispose())`

给任务 5 的 impl 加上 `fetchFromPreload(request: IpcFetchRequest)`：构造 `new Request(request.url, { method, headers, body })` 并调用 `setApiFetch` handler。缺少 handler → 503，body 为 `desktop-app: api fetch not installed`。

AppWebEntry 里的渲染进程 `loadBundle`：`apps/desktop` 不能改 `apps/web/src/main.ts`。仅当 web dist 不能接 seam 时，才从很小的 `apps/desktop/src/renderer.ts` 注入。规格要求复用 web frontend dist。dist 的 `main.ts` 是 `new AppWebEntry(el).run()`，没有 seam。

因此 `loadBundle` 必须能配合默认 `<script src=url>` 工作。`/plugins/...` 在 `file://` 上会 404。规格允许的选项：`BootSeams.loadBundle` 需要自定义渲染入口。

**决议（锁定）：** 不要原样复用带 hash 的 web dist `main.ts`。`apps/desktop/src/renderer.ts`：

```ts
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

const el = document.getElementById('root')
if (el === null) throw new Error('desktop app: missing #root')
void new AppWebEntry(el, {
  loadBundle: async (url) => {
    const source = await globalThis.dshDesktop.loadBundle(url)
    const blob = new Blob([source], { type: 'text/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = blobUrl
      script.addEventListener('load', () => { script.remove(); URL.revokeObjectURL(blobUrl); resolve() }, { once: true })
      script.addEventListener('error', () => { script.remove(); URL.revokeObjectURL(blobUrl); reject(new Error(`desktop: bundle ${url} failed`)) }, { once: true })
      document.head.append(script)
    })
  },
}).run()
```

加 `apps/desktop/index.html`，含 `<div id="root"></div>` 和渲染 bundle 的 script 标签。用一份小的 Vite 配置构建 renderer，alias 与 `apps/web` 相同的 `PLATFORM_MODULES`（抄 `apps/web/vite.config.ts` 并改 root/entry）。这仍是「复用 AppWebEntry + 客户端插件」，不是第二套 GUI。

`apps/desktop` 的 `package.json`：`"private": true`，依赖 `electron`（与 WorkBuddy 同主版本：`^35`）、`tsx`、`@deepseek-ai/dsh-client-web`；若壳导入 CSS/资源则加 `@deepseek-ai/dsh-web-frontend`。tsdown 只打 preload。

- [ ] **步骤 1：写一个不依赖 Electron 的桥单元测试**

在 `packages/bundle/desktop-app/tests/runtime.spec.ts` 测试 `fetchFromPreload` 的 URL 改写和 `loadBundleSource` 的路径映射（纯 Node）。不要 import `electron`。

- [ ] **步骤 2：跑它并确认失败，然后实现粘合方法 + apps/desktop 文件**

运行：`pnpm exec vitest run packages/bundle/desktop-app/tests/runtime.spec.ts`

- [ ] **步骤 3：按上文实现 main/preload/renderer**

README 写明：`pnpm approve-builds` 必须允许 `electron`；首次启动需要像 Web 一样 `pnpm run build` 客户端 bundle，以及 `pnpm --filter @deepseek-ai/dsh-web-frontend...` / `apps/web` 已有的 dist 文档，再加上 `pnpm --filter @deepseek-ai/dsh-desktop build` 打 preload/renderer。

- [ ] **步骤 4：跑包测试**

运行：`pnpm exec vitest run packages/bundle/desktop-app/tests packages/client/connection/tests/node-half.host.spec.ts`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add apps/desktop packages/bundle/desktop-app pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(desktop): add Electron main, preload bridge, and renderer seam"
```

---

### 任务 7：CLI `dsh desktop` spawn + 文档

**文件：**
- 修改：`apps/cli/src/args.ts`（从 `web` 抄 desktop 别名）
- 修改：`apps/cli/src/bin.ts`（profile `desktop` + mode profile → spawn Electron）
- 修改：`apps/cli/tests/args.spec.ts`
- 新建：`apps/cli/src/spawn-desktop.ts`
- 修改：`apps/cli/README.md`、`README.zh.md`、`apps/cli/reference/README.md` + zh、`docs/architecture.md`（一句话说明 desktop 是第三个 profile）
- 测试：`apps/cli/tests/spawn-desktop.spec.ts`

**接口：**
- 消费：`parseDshArgs` 的 `mode: 'profile' | 'dump-config'`、来自 `apps/desktop` 的 Electron 二进制
- 产出：`dsh desktop` 实况启动 spawn Electron；`dsh desktop --dump-config` 和 `dsh --profile desktop --dump-config` 留在 Node

- [ ] **步骤 1：编写会失败的 CLI 测试**

在 `args.spec.ts` 里为 `desktop` 克隆 `web` 用例（`parse(['desktop'])` → `{ mode: 'profile', profile: 'desktop', patches: [], args: [] }`、dump-config、`--patch`）。

在 `spawn-desktop.spec.ts`：

```ts
it('builds the electron argv with tsx and forwarded patches', () => {
  const argv = electronArgv({
    patches: ['D:/overlay.yml'],
    args: [],
    main: 'D:/code/deepseek-harness/apps/desktop/src/main.ts',
    tsx: 'D:/code/deepseek-harness/node_modules/tsx/dist/esm/index.mjs',
  })
  expect(argv).toContain('--import')
  expect(argv.some(part => part.includes('main.ts'))).toBe(true)
  expect(argv).toContain('--patch')
  expect(argv).toContain('D:/overlay.yml')
})
```

若更干净，测试里用 `join` 而不是硬编码盘符；断言相对位置，不要只断言 Windows 路径。

- [ ] **步骤 2：跑测试，确认失败**

运行：`pnpm exec vitest run apps/cli/tests/args.spec.ts apps/cli/tests/spawn-desktop.spec.ts`

- [ ] **步骤 3：实现别名 + spawn**

`args.ts`：把 `web` 命令块复制为 `desktop`，描述为 `boot the desktop profile (alias of --profile desktop); spawns Electron`。dump flag 仍由启动器持有，这样 `--dump-config` 永远到不了 Electron。

`bin.ts`：

```ts
case 'profile': {
  if (invocation.profile === 'desktop') {
    const { spawnDesktop } = await import('./spawn-desktop.ts')
    await spawnDesktop(invocation)
    break
  }
  const { runProfile } = await import('./profile-boot.ts')
  await runProfile({ ... })
  break
}
```

`spawnDesktop`：`spawn(electronBinary, ['--import', tsxEsm, mainTs, ...forwarded], { stdio: 'inherit', windowsHide: false })`。转发 `--patch <abs>` 前用 `resolve(process.cwd(), path)` 解析路径，让子进程能再读它们。以子进程退出码退出。若解析不到 `electron`，抛带标签的错误，点名 `pnpm approve-builds` 和 `apps/desktop`。

不要在父 Node 进程里调用 `boot()`。

- [ ] **步骤 4：跑测试 + dump-config**

运行：`pnpm exec vitest run apps/cli/tests/args.spec.ts apps/cli/tests/spawn-desktop.spec.ts`

运行：`pnpm exec tsx apps/cli/src/bin.ts desktop --dump-default-config`

预期：打印 YAML，进程以 0 退出，没有 Electron。

更新双语 CLI + architecture 文档。记录配对。

- [ ] **步骤 5：提交**

```bash
git add apps/cli docs/architecture.md docs/architecture.zh.md docs/architecture.i18n.yaml
git commit -m "feat(cli): add dsh desktop alias that spawns Electron"
```

---

## 手工验证（不是 CI 门禁）

在已经能跑 `pnpm dsh web` 的机器上：

1. `pnpm approve-builds` → 允许 `electron`；`pnpm install`
2. 按 Web 同样方式构建 frontend dist 和客户端 `lib/client.js`
3. 构建 `apps/desktop` 的 preload + renderer
4. `pnpm dsh desktop` 打开一个窗口
5. 会话列表 / prompt / 工具 / 审批与 Web 一致
6. 3080 上没有监听者（`netstat` / Resource Monitor）
7. 关闭窗口 → 进程退出
8. `pnpm dsh desktop --patch ./path/to/overlay.yml` 仍能启动

---

## 规格覆盖

| 规格项 | 任务 |
|---|---|
| Electron 主进程就是 harness；CLI spawn | 6, 7 |
| 没有 webserver / 没有 TCP | 1, 4, 5, 7 dump |
| 复用客户端插件 + AppWebEntry | 6 renderer |
| IpcApiClient / 四个象限 | 2, 3, 4 |
| Preload 桥，渲染进程没有 ipcRenderer | 6 |
| `__DSH_BOOT__` + loadBundle | 1 `clientPath`、5 `loadBundleSource`、6 |
| 经桥的特权 RPC | 3 `isLoopback`、4 URL 改写、6 sender 检查 |
| Profile 模板 + dump-config 走 Node | 5, 7 |
| 失败 / 无对话框 | 6 `installFailLoud` |
| 测试不依赖真实 Electron | 1–5, 7 |
| 范围外清单 | 全局约束；没有任务加入那些功能 |
| Agent Note | 1 |

## 自检

- 没有 TBD / 没有不带代码的「handle edge cases」。
- 名称：`DshDesktopBridge`、`IpcFetchRequest`、`IpcFetchResponse`、`IpcApiClient`、`DesktopRuntime`、`IpcDownlinks`、`readDshDesktop` —— 用法一致。
- `ClientModuleRegistry.clientPath` 已经存在；任务 5 的 `loadBundleSource` 使用它。
- 渲染进程不能是未改的 web dist `main.ts`，因为需要 `BootSeams`；任务 6 锁定一个仍使用 `AppWebEntry` 的薄 `apps/desktop/src/renderer.ts`。
