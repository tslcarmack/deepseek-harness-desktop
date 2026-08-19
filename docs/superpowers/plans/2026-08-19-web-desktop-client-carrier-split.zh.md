# Web / 桌面客户端载波拆分实现计划

[English](2026-08-19-web-desktop-client-carrier-split.md) | 中文

> **面向 agentic worker：** 必用子技能：用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步实现本计划。步骤用 checkbox（`- [ ]`）跟踪。

**目标：** 把 `dsh web` / `dev:web` 恢复成桌面前的客户端图（该图上没有 IPC 实现），同时 `dsh desktop` 仍能打开，Session log 仍能经 IPC 保存 ZIP。

**架构：** connection 浏览器 `apply` 只构造 `WebApiClient`（或 fixture 客户端），并使用 `window.fetch`。当存在 `window.dshDesktop` 且没有 `?fixture` 时，它不 `provide('connection')`。`dsh-desktop-app` 增加 `immediately: true` 的客户端半边，提供 `IpcApiClient` 以及经 invoke 的 `rpc.call`。session-log-export 的浏览器 `apply` 再次变成 HEAD + href；desktop-app 在 `sessionLogDownload` 存在之后改用 blob 传输。

**技术栈：** Cordis 客户端插件、现有 preload `window.dshDesktop`、带 `hostPhase: true` 的 tsdown `clientBundle`、vitest jsdom 客户端规格测试。

**规格：** [docs/superpowers/specs/2026-08-19-web-desktop-client-carrier-split-design.md](../specs/2026-08-19-web-desktop-client-carrier-split-design.md)

## 全局约束

- 不要把 `@deepseek-ai/dsh-client-connection/client` 加进 `PLATFORM_MODULES` 或 `INLINE_SAFE`。desktop-app 不得对该 specifier 做值导入（允许只导入类型）。
- 不要把桌面抽成树外的 `dsh plugin`。不要回退 Host 的 `webServer` / `desktopRuntime` 双绑定。
- 不要编辑 `packages/bundle/web-app/cordis.patch.yml`。该文件本来就独立禁用了 HMR；桌面 HMR 只在 `dsh-desktop-app` 的 patch 里保持禁用。
- 不要重录模型对话快照。不要顺便批量修无关的桌面 UI/Host 小问题。
- 不要把无关脏树（`myplugins/`、`outputs/`、`.workbuddy/`、app-boot 残留、`2026-08-14-root-include-absolute-plugin-file-url` 笔记）混进这些提交。
- 渲染进程仍然从不 import `ipcRenderer`。文件以恰好一个尾随换行结束。测试使用 `node:url` / `import.meta.url`，不要只用 POSIX 路径字面量。
- 渲染进程会加载的客户端源码有改动后，按各任务规定重建该包的 `lib/client.js`（`tsc -b` 然后 `tsdown --env.DSH_BUILD_FACE client`）。渲染进程加载的是已构建 bundle，不是 `src/`。
- 启动后缺少 `ctx.connection` 仍是响亮的 Cordis inject 失败（runtime inject `connection`）。两次 `provide('connection')` 仍是响亮的 Cordis 失败。不要加空白根占位。
- 纯度：`@deepseek-ai/dsh-host-apiproxy/client` 和 `/api` 是 INLINE_SAFE。其它 `@deepseek-ai/` specifier 的值导入不是。冻结模块表无法 require ConnectionController，因此 desktop-app 客户端半边自带循环辅助的副本（jscpd ignore，并引用 Agent Note）。

## 文件结构

| 路径 | 职责 |
|---|---|
| `packages/client/connection/src/client/index.ts` | 只做 Web/fixture 的 provide；有 `dshDesktop` 且没有 `?fixture` 时跳过 provide |
| `packages/client/connection/src/client/handle.ts` | Web apply 使用的共享 `createConnectionHandle` |
| `packages/client/connection/src/client/dsh-desktop.ts` | 很小的 `readDshDesktop` 窗口检查（不含 IPC 客户端） |
| `packages/bundle/desktop-app/src/client/index.ts` | immediately 客户端半边：提供 `IpcApiClient`；改用 Session-log blob 传输 |
| `packages/bundle/desktop-app/src/client/ipc-api-client.ts` | 迁入的 `IpcApiClient` / `ipcDoFetch` |
| `packages/bundle/desktop-app/src/client/dsh-desktop.ts` | preload 桥读取器的桌面副本 |
| `packages/bundle/desktop-app/src/client/connection-controller.ts` | 内联的 `ConnectionController`（纯度；jscpd ignore） |
| `packages/bundle/desktop-app/src/client/rpc.ts` | 内联的 `createWebConnectionRpc`（纯度；jscpd ignore） |
| `packages/bundle/desktop-app/src/client/random-uuid.ts` | rpc 使用的内联 UUID 辅助 |
| `packages/bundle/desktop-app/src/client/handle.ts` | 内联的 `createConnectionHandle` |
| `packages/bundle/desktop-app/src/client/desktop-fetch.ts` | 迁入的 Session-log IPC GET |
| `packages/session-query/session-log-export/src/client/index.ts` | 仅 Web 的 `new SessionLogDownloadController()` |
| `packages/session-query/session-log-export/src/client/controller.ts` | `adoptBlobTransport(fetcher)` |
| `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md` | 已落地决策：Web 图不加载 IPC 客户端 |

---

### 任务 1：connection 客户端 apply 只服务 Web

connection 浏览器入口不得静态导入 `IpcApiClient` 或 `ipcDoFetch`。有 preload 桥且没有 `?fixture` 时，不得 `provide('connection')`。即使桥存在，fixture 仍然 provide。

**文件：**
- 新建： `packages/client/connection/src/client/handle.ts`
- 修改： `packages/client/connection/src/client/index.ts`
- 修改： `packages/client/connection/tsconfig.client.json`（加入 `handle.ts`；该文件要到任务 2 搬走时才从列表去掉 `ipc-api-client.ts`）
- 测试： `packages/client/connection/tests/client-apply.client.spec.ts`

**接口：**
- 消费：现有 `readDshDesktop()`、`WebApiClient`、`FixtureApiClient`、`createWebConnectionRpc()`、`ConnectionController`
- 产出：`createConnectionHandle(api: IApiClient, rpc: ClientConnectionRpc, isLoopback: boolean): ConnectionHandle`；`apply` 只为 fixture 或 Web provide

- [ ] **步骤 1：编写会失败的测试**

在 `packages/client/connection/tests/client-apply.client.spec.ts` 中：

删掉 `IpcApiClient` 的 import。

把两个桌面桥测试（`uses IpcApiClient…` 和 `carries generic RPC through the desktop invoke bridge…`）换成：

```ts
it('does not provide connection when the desktop bridge is present without ?fixture', async () => {
  ;(globalThis as { dshDesktop?: unknown }).dshDesktop = {
    invoke: async () => ({ status: 200, headers: {}, body: '{}' }),
    onMux: () => () => {},
    onHost: () => () => {},
    loadBundle: async () => '',
  }
  ;(globalThis as Win).location = { hostname: '', search: '', origin: 'null' }
  const ctx = new Context()
  await ctx.plugin({ apply, inject: [] })
  expect(ctx.get('connection')).toBeUndefined()
})

it('still provides the fixture client when ?fixture is set even if the desktop bridge exists', async () => {
  ;(globalThis as { dshDesktop?: unknown }).dshDesktop = {
    invoke: async () => ({ status: 200, headers: {}, body: '{}' }),
    onMux: () => () => {},
    onHost: () => () => {},
    loadBundle: async () => '',
  }
  ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture', origin: 'http://localhost' }
  const handle = await mount()
  expect(handle.api).toBeInstanceOf(FixtureApiClient)
})

it('does not statically import the IPC client implementation', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  expect(src).not.toMatch(/ipc-api-client/)
  expect(src).not.toMatch(/IpcApiClient/)
  expect(src).not.toMatch(/ipcDoFetch/)
})
```

保留所有现有的 Web / fixture / loopback / `start()` 测试。

- [ ] **步骤 2：跑测试并确认它们失败**

运行： `pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts -t "does not provide connection when the desktop bridge"`

预期：FAIL，因为 `apply` 仍会构造 `IpcApiClient` 并 provide `ctx.connection`。

- [ ] **步骤 3：最小实现**

把目前在 `apply` 里组装的 handle 对象（description 监听器、`start` / `stop`、`ConnectionController`）挪到 `packages/client/connection/src/client/handle.ts`：

```ts
export function createConnectionHandle(
  api: IApiClient,
  rpc: ClientConnectionRpc,
  isLoopback: boolean,
): ConnectionHandle
```

保持相同的 `start()` 第二消费者错误字符串、相同的 `publishDescription` 监听器隔离，以及相同的 `onConnected` 过期 generation 守卫。若从 `./index.ts` 只导入类型会产生循环，就把 `ConnectionHandle` 接口挪进 `handle.ts`，再从 `index.ts` 重新导出。

把 `packages/client/connection/src/client/index.ts` 的 `apply` 换成：

```ts
export function apply(ctx: Context): void {
  const pageLocation = typeof location === 'undefined' ? undefined : location
  const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture')
  const desktop = readDshDesktop()
  if (!fixture && desktop !== undefined) return
  const fixtureClient = fixture ? new FixtureApiClient() : undefined
  const api: IApiClient = fixtureClient ?? new WebApiClient()
  const rpc = fixtureClient?.rpc ?? createWebConnectionRpc()
  ctx.provide('connection', createConnectionHandle(
    api,
    rpc,
    desktop !== undefined || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
  ))
}
```

删除 `import { IpcApiClient, ipcDoFetch } from './ipc-api-client.ts'`。保留 `import { readDshDesktop } from './dsh-desktop.ts'`。更新该文件模块 JSDoc：这一半只 provide fixture 或 HTTP 传输；它不构造 IPC 客户端。

把 `src/client/handle.ts` 加进 `packages/client/connection/tsconfig.client.json` 的 `files`。

把 `ipc-api-client.ts` 留在磁盘上，直到任务 2 搬走它（任务 1 的测试不得导入它；`tsconfig.client.json` 在搬走前仍可列出它）。

- [ ] **步骤 4：跑测试**

运行： `pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts`

预期：全部 PASS，包括 skip-provide、带桥的 fixture、静态导入，以及现有 Web 用例。

重建 connection 客户端产物（渲染进程加载 `lib/client.js`）：

```bash
pnpm exec tsc -b packages/client/connection/tsconfig.client.json
pnpm --filter @deepseek-ai/dsh-client-connection exec tsdown --env.DSH_BUILD_FACE client
```

确认 `packages/client/connection/lib/client.js` 不含 `IpcApiClient` 或 `ipc-api-client`。

- [ ] **步骤 5：提交**

```bash
git add packages/client/connection/src/client/index.ts packages/client/connection/src/client/handle.ts packages/client/connection/tsconfig.client.json packages/client/connection/tests/client-apply.client.spec.ts
git commit -m "$(cat <<'EOF'
fix(connection): keep desktop IPC out of the Web client apply

The Web graph must not construct IpcApiClient. Skip provide when the preload bridge exists so dsh-desktop-app can own that carrier.
EOF
)"
```

---

### 任务 2：`dsh-desktop-app` 的 immediately 客户端半边提供 IPC

Web 从不挂载这个包，因此 Web 从不加载这一半。Desktop 会挂载它；这一半和 connection 都是 `immediately: true`。provide 顺序：connection 跳过（任务 1）；这一半 provide。若设置了 `?fixture`，这一半也跳过，让 connection 的 fixture provide 保持唯一。

**文件：**
- 新建： `packages/bundle/desktop-app/src/client/index.ts`
- 新建： `packages/bundle/desktop-app/src/client/ipc-api-client.ts` (move from connection)
- 新建： `packages/bundle/desktop-app/src/client/dsh-desktop.ts` (copy of the bridge reader)
- 新建： `packages/bundle/desktop-app/src/client/connection-controller.ts` (copy of `ConnectionController` with jscpd ignore)
- 新建： `packages/bundle/desktop-app/src/client/rpc.ts` (copy of `createWebConnectionRpc` with jscpd ignore)
- 新建： `packages/bundle/desktop-app/src/client/random-uuid.ts` (copy)
- 新建： `packages/bundle/desktop-app/src/client/handle.ts` (copy of `createConnectionHandle` with jscpd ignore)
- 新建： `packages/bundle/desktop-app/tsdown.config.ts`
- 新建： `packages/bundle/desktop-app/tsconfig.client.json`
- 修改： `packages/bundle/desktop-app/package.json` (`./client` export, `files` includes `lib/client.js`, `dsh.client`)
- 修改： `packages/bundle/desktop-app/tsconfig.json` (exclude `src/client`)
- 修改： `packages/bundle/desktop-app/src/invariant.ts` (JSDoc: IPC client lives in this package's client half)
- 修改： `packages/client/tsdown.client.ts` (`ClientBundleOptions.clientEntry`)
- 修改： `tsconfig.client.json` (reference desktop-app client tsconfig)
- 移动后删除：`packages/client/connection/src/client/ipc-api-client.ts`；从 connection 的 `tsconfig.client.json` `files` 里去掉它
- 测试： `packages/bundle/desktop-app/tests/client-apply.client.spec.ts`
- 测试： `packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts` (move from connection)
- 测试： `packages/bundle/desktop-app/tests/composition.spec.ts` (assert `dsh.client.immediately`)

**接口：**
- 消费：任务 1 的 skip-provide；preload `window.dshDesktop`；INLINE_SAFE 的 `@deepseek-ai/dsh-host-apiproxy/client` 和 `/api`
- 产出：`export const inject: string[] = []`；`export function apply(ctx: Context): void`，以 `handle.api instanceof IpcApiClient` 且 `rpc.call` 走 `ipcDoFetch` 的方式 `provide('connection', handle)`；客户端半边为测试 `export { IpcApiClient, ipcDoFetch }`

- [ ] **步骤 1：编写会失败的测试**

创建 `packages/bundle/desktop-app/tests/client-apply.client.spec.ts`：

```ts
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { IpcApiClient } from '../src/client/ipc-api-client.ts'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

type Win = typeof globalThis & { location?: { hostname: string; search: string; origin: string } }

afterEach(() => {
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
  delete (globalThis as Win).location
})

function bridge(invoke: () => Promise<{ status: number; headers: Record<string, string>; body: string }>) {
  return {
    invoke,
    onMux: () => () => {},
    onHost: () => () => {},
    loadBundle: async () => '',
  }
}

describe('desktop-app client apply', () => {
  it('provides IpcApiClient and reports loopback when the desktop bridge is present', async () => {
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = bridge(async () => ({ status: 200, headers: {}, body: '{}' }))
    ;(globalThis as Win).location = { hostname: '', search: '', origin: 'null' }
    const ctx = new Context()
    await ctx.plugin({ apply, inject })
    const handle = ctx.get('connection') as ConnectionHandle | undefined
    expect(handle).toBeDefined()
    expect(handle.api).toBeInstanceOf(IpcApiClient)
    expect(handle.isLoopback).toBe(true)
  })

  it('carries generic RPC through the desktop invoke bridge, not window fetch', async () => {
    const invoke = vi.fn(async (request: { url: string; body: string | null }) => {
      const sent = JSON.parse(request.body ?? '{}') as { rpcId: string }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'server-response',
          rpcId: sent.rpcId,
          result: { ok: true, value: { entries: [] } },
        }),
      }
    })
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = bridge(invoke)
    const fetch = vi.spyOn(globalThis, 'fetch')
    const ctx = new Context()
    await ctx.plugin({ apply, inject })
    const handle = ctx.get('connection') as ConnectionHandle
    try {
      await expect(handle.rpc.call('/api', 'pluginInventory/list', { args: {} }))
        .resolves.toEqual({ ok: true, value: { entries: [] } })
      expect(invoke).toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      const posted = invoke.mock.calls[0]?.[0] as { url: string }
      expect(posted.url).toContain('/api/pluginInventory/list')
    } finally {
      fetch.mockRestore()
    }
  })

  it('does not provide when ?fixture is set', async () => {
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = bridge(async () => ({ status: 200, headers: {}, body: '{}' }))
    ;(globalThis as Win).location = { hostname: 'localhost', search: '?fixture', origin: 'http://localhost' }
    const ctx = new Context()
    await ctx.plugin({ apply, inject })
    expect(ctx.get('connection')).toBeUndefined()
  })

  it('fails loud when the preload bridge is missing', async () => {
    expect(() => apply(new Context())).toThrow(/dshDesktop/)
  })
})
```

把 `packages/client/connection/tests/ipc-api-client.client.spec.ts` 挪到 `packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts`，并把 import 指到 `../src/client/ipc-api-client.ts`。

在 `packages/bundle/desktop-app/tests/composition.spec.ts` 中加入：

```ts
it('declares an immediately client half', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dsh?: { client?: { immediately?: boolean; platform?: string } }
    exports?: Record<string, unknown>
  }
  expect(pkg.dsh?.client?.immediately).toBe(true)
  expect(pkg.dsh?.client?.platform).toBe('web')
  expect(pkg.exports?.['./client']).toBeDefined()
})
```

- [ ] **步骤 2：跑测试并确认它们失败**

运行： `pnpm exec vitest run packages/bundle/desktop-app/tests/client-apply.client.spec.ts packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts`

预期：FAIL（缺少 `src/client/index.ts` / 缺少 `dsh.client` 元数据）。

- [ ] **步骤 3：最小实现**

在 `packages/client/tsdown.client.ts` 中扩展 `ClientBundleOptions`：

```ts
interface ClientBundleOptions {
  readonly hostPhase?: boolean
  readonly companions?: readonly UserConfig[]
  readonly lib?: UserConfig
  /** Browser entry. When set, both the unset face and the Client face compile this path instead of `lib/types/client/index.js`. */
  readonly clientEntry?: string
}
```

在 `clientBundle` 里，把 `clientConfig` 的入口选择换成：

```ts
const client = clientConfig(
  id,
  options.clientEntry ?? (face === undefined ? 'src/client/index.ts' : 'lib/types/client/index.js'),
)
```

创建 `packages/bundle/desktop-app/tsdown.config.ts`：

```ts
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-desktop-app',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true, clientEntry: 'src/client/index.ts' },
)
```

`clientEntry` 为 `src/client/index.ts`，这样 tsdown 直接内联 TypeScript（含本地副本），不必让 tsc 从一个混杂的 `rootDir` 发出 `lib/types/client/index.js`。

Host 侧 `packages/bundle/desktop-app/tsconfig.json`：加上 `"exclude": ["src/client"]`，避免 Node 程序去 typecheck 浏览器文件。

创建 `packages/bundle/desktop-app/tsconfig.client.json`：

```json
{
  "extends": "../../../tsconfig.base.client.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "tsBuildInfoFile": "lib/tsconfig.client.tsbuildinfo",
    "declaration": true,
    "emitDeclarationOnly": true
  },
  "include": ["src/client/**/*.ts"],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../host/apiproxy" },
    { "path": "../../client/connection/tsconfig.client.json" }
  ]
}
```

把 `{ "path": "./packages/bundle/desktop-app/tsconfig.client.json" }` 加进 `tsconfig.client.json` 的 `references`。

desktop-app 的 `package.json`：

- 增加导出 `"./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }`
- 把 `lib/client.js` 加进 `files`
- 加入

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": [],
    "platform": "web",
    "immediately": true
  }
}
```

把 `packages/client/connection/src/client/ipc-api-client.ts` 挪到 `packages/bundle/desktop-app/src/client/ipc-api-client.ts`。把来自 `./api.ts` 的值导入改成 INLINE_SAFE 的 host-apiproxy：

```ts
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { readDshDesktop, type DshDesktopBridge } from './dsh-desktop.ts'
```

保持 `ipcDoFetch`、`bodyInitFromIpc` 和 `IpcApiClient` 行为完全相同（含 base64 解码）。错误字符串可以写成 `desktop-app: IpcApiClient requires window.dshDesktop`。

把 `packages/client/connection/src/client/dsh-desktop.ts` 复制到 `packages/bundle/desktop-app/src/client/dsh-desktop.ts`（connection 为自己的 skip-provide 检查保留一份）。给 desktop-app 副本包上：

```ts
/* jscpd:ignore-start -- preload bridge reader duplicated because purity forbids value-import of dsh-client-connection/client; see 2026-08-18-desktop-shell-ipc-carrier */
```

并在文件末尾配上对应的 `ignore-end`。

把 `packages/client/connection/src/client/connection.ts` 复制到 `packages/bundle/desktop-app/src/client/connection-controller.ts`。把 `from './api.ts'` 换成 host-apiproxy 的 `IApiClient` / 帧类型（与 `ipc-api-client.ts` 相同的 INLINE_SAFE specifier）。整文件用带同一 Agent Note 理由的 `jscpd:ignore-start` / `ignore-end` 包起来。

用同样方式复制 `random-uuid.ts`（jscpd ignore）。

把 `packages/client/connection/src/client/rpc.ts` 复制到 `packages/bundle/desktop-app/src/client/rpc.ts`。保留 host-apiproxy 值导入。把 `import type { ClientConnectionRpc } from '../rpc.ts'` 改成 `import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'`（只导入类型）。导入 `./random-uuid.ts`。用 jscpd ignore 包起来。

把 `packages/client/connection/src/client/handle.ts` 复制到 `packages/bundle/desktop-app/src/client/handle.ts`。从 `./connection-controller.ts` 导入 `ConnectionController`。写 `import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'`。用 jscpd ignore 包起来。

创建 `packages/bundle/desktop-app/src/client/index.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { IpcApiClient, ipcDoFetch } from './ipc-api-client.ts'
import { readDshDesktop } from './dsh-desktop.ts'
import { createConnectionHandle } from './handle.ts'
import { createWebConnectionRpc } from './rpc.ts'

export const inject: string[] = []

export { IpcApiClient, ipcDoFetch } from './ipc-api-client.ts'

/**
 * Desktop immediately-tier client half: provide IPC connection when the preload bridge exists.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  const pageLocation = typeof location === 'undefined' ? undefined : location
  const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture')
  if (fixture) return
  const desktop = readDshDesktop()
  if (desktop === undefined) throw new Error('desktop-app: client apply requires window.dshDesktop')
  const api = new IpcApiClient()
  const handle: ConnectionHandle = createConnectionHandle(api, createWebConnectionRpc(ipcDoFetch), true)
  ctx.provide('connection', handle)
}
```

从 `packages/client/connection/tsconfig.client.json` 的 `files` 去掉 `src/client/ipc-api-client.ts`。移动后删除 connection 里的原文件。

更新 `packages/bundle/desktop-app/src/invariant.ts` 的 companion 注释：本包客户端半边提供 `IpcApiClient`；Host 半边仍然只提供 `desktopRuntime`。

- [ ] **步骤 4：跑测试并重建**

运行： `pnpm exec tsc -b packages/bundle/desktop-app/tsconfig.client.json packages/client/connection/tsconfig.client.json`

预期：PASS。

运行： `pnpm exec vitest run packages/bundle/desktop-app/tests/client-apply.client.spec.ts packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts packages/client/connection/tests/client-apply.client.spec.ts`

预期：PASS。

重建两份客户端产物：

```bash
pnpm exec tsc -b packages/client/connection/tsconfig.client.json packages/bundle/desktop-app/tsconfig.client.json
pnpm --filter @deepseek-ai/dsh-client-connection exec tsdown --env.DSH_BUILD_FACE client
pnpm --filter @deepseek-ai/dsh-desktop-app exec tsdown --env.DSH_BUILD_FACE client
```

确认 `packages/bundle/desktop-app/lib/client.js` 存在且含 IPC 客户端。确认 connection 的 `lib/client.js` 仍然没有 `IpcApiClient`。

- [ ] **步骤 5：提交**

```bash
git add packages/client/tsdown.client.ts packages/bundle/desktop-app packages/client/connection/tsconfig.client.json tsconfig.client.json
git add -u packages/client/connection/src/client/ipc-api-client.ts packages/client/connection/tests/ipc-api-client.client.spec.ts
git commit -m "$(cat <<'EOF'
feat(desktop-app): provide IpcApiClient from an immediately client half

Web never mounts dsh-desktop-app, so the Web graph no longer evaluates the IPC client. Desktop still provides connection over the preload bridge.
EOF
)"
```

---

### 任务 3：Session-log 的 Web apply 是 HEAD + href；desktop-app 改用 blob 传输

`dsh-session-log-export` 浏览器 `apply` 不得导入 desktop fetch。Blob GET / base64 解码放在只有 desktop-app 客户端半边才导入的模块里。控制器保留 `saveMode: 'blob'`，并增加 `adoptBlobTransport`，让 desktop-app 的嵌套插件在 `sessionLogDownload` 提供之后切换（session-log-export 不是 `immediately`）。

**文件：**
- 修改： `packages/session-query/session-log-export/src/client/index.ts`
- 修改： `packages/session-query/session-log-export/src/client/controller.ts`
- Delete: `packages/session-query/session-log-export/src/client/desktop-fetch.ts`
- 修改： `packages/bundle/desktop-app/src/client/index.ts` (nested plugin)
- 新建： `packages/bundle/desktop-app/src/client/desktop-fetch.ts` (move)
- 测试： `packages/session-query/session-log-export/tests/client-apply.client.spec.tsx`
- 测试： `packages/session-query/session-log-export/tests/controller.client.spec.ts`
- 测试： `packages/bundle/desktop-app/tests/desktop-fetch.client.spec.ts` (move)
- 测试： `packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts`

**接口：**
- 消费：任务 2 的 `apply` 已经 provide `connection`；`desktopDoFetch(input: string | URL, init?: RequestInit): Promise<Response>`
- 产出：`SessionLogDownloadController.adoptBlobTransport(fetcher: (input: string | URL, init?: RequestInit) => Promise<Response>): void` 设置 fetcher 并把 `saveMode` 设为 `'blob'`

- [ ] **步骤 1：编写会失败的测试**

在 `packages/session-query/session-log-export/tests/client-apply.client.spec.tsx` 中删除测试 `GETs the ZIP through desktop invoke and saves a blob URL`。加入：

```ts
it('does not import desktop invoke helpers', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  expect(src).not.toMatch(/desktop-fetch/)
  expect(src).not.toMatch(/desktopDoFetch/)
  expect(src).not.toMatch(/readDesktopInvoke/)
})
```

保留现有的 provide / Header / dispose 测试（它 stub `fetch`，并期望 HEAD 返回 HTTP 错误状态）。

在 `packages/session-query/session-log-export/tests/controller.client.spec.ts` 中删除两个 blob 模式单元测试（`buffers a GET ZIP…`、`publishes blob-mode HTTP failures…`），并把它们迁到 `packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts`。session-log-export 只保留 HEAD + href 覆盖。把下面这条 adopt 测试加到同一份 desktop-app 文件（它导入 `SessionLogDownloadController`）：

```ts
it('adoptBlobTransport switches a default href controller onto blob GET', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([0x50, 0x4b]), { status: 200 }))
  const save = vi.fn()
  const objectUrl = 'blob:adopt-transport'
  vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl)
  vi.spyOn(URL, 'revokeObjectURL')
  const controller = new SessionLogDownloadController((input, init) => fetch(input, init), save)
  controller.adoptBlobTransport(fetcher)
  await controller.download(SID)
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' })
  expect(save).toHaveBeenCalledWith(objectUrl, 'dsh-session-session-export-controller.zip')
})
```

用 `new SessionLogDownloadController((input, init) => fetch(input, init), save)` 构造，使第一个参数仍是真正的 `Fetch`，然后 `adoptBlobTransport(fetcher)` 覆盖它。

把 `packages/session-query/session-log-export/tests/desktop-fetch.client.spec.ts` 挪到 `packages/bundle/desktop-app/tests/desktop-fetch.client.spec.ts`，并把 import 指到 `../src/client/desktop-fetch.ts`。

创建 `packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts`：挂上 desktop-app 客户端 `apply` 和一个 stub 的 `sessionLogDownload` 服务，然后断言调用了 `adoptBlobTransport`。最小版本：

```ts
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { SessionLogDownloadController } from '../../../session-query/session-log-export/src/client/controller.ts'

afterEach(() => {
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
})

it('adopts blob transport on sessionLogDownload after the nested plugin resolves', async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
  const invoke = vi.fn(async () => ({
    status: 200,
    headers: { 'content-type': 'application/zip' },
    body: Buffer.from(zip).toString('base64'),
    bodyEncoding: 'base64' as const,
  }))
  ;(globalThis as { dshDesktop?: unknown }).dshDesktop = {
    invoke,
    onMux: () => () => {},
    onHost: () => () => {},
    loadBundle: async () => '',
  }
  const objectUrl = 'blob:desktop-session-log'
  vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl)
  vi.spyOn(URL, 'revokeObjectURL')
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('location', { origin: 'null', hostname: '', search: '' })

  const ctx = new Context()
  const desktop = ctx.plugin({ apply, inject })
  const controller = new SessionLogDownloadController()
  ctx.provide('sessionLogDownload', controller)
  await desktop.await()
  await controller.download('session-export-apply' as import('@deepseek-ai/dsh-client-runtime/client').SessionId)

  expect(invoke).toHaveBeenCalled()
  const request = invoke.mock.calls[0]?.[0] as { method: string; url: string }
  expect(request.method).toBe('GET')
  expect(request.url).toContain('/api/session.export')
  expect(click).toHaveBeenCalledOnce()
})
```

- [ ] **步骤 2：跑测试并确认它们失败**

运行： `pnpm exec vitest run packages/session-query/session-log-export/tests/client-apply.client.spec.tsx packages/session-query/session-log-export/tests/controller.client.spec.ts -t "does not import desktop invoke"`

预期：FAIL，因为 `index.ts` 仍导入 `./desktop-fetch.ts`。

- [ ] **步骤 3：最小实现**

在 `packages/session-query/session-log-export/src/client/controller.ts` 中，把 `fetcher` 和 `saveMode` 从 `private readonly` 构造函数字段改成可赋值的私有字段。加入：

```ts
/**
 * Switch this controller onto IPC GET + blob object-URL save (desktop has no HTTP download manager).
 * @param fetcher - unary fetch that returns ZIP bytes (desktop preload invoke).
 */
adoptBlobTransport(fetcher: Fetch): void {
  this.fetcher = fetcher
  this.saveMode = 'blob'
}
```

把 `packages/session-query/session-log-export/src/client/index.ts` 的 apply 构造换成：

```ts
const controller = new SessionLogDownloadController()
```

删除 `desktop-fetch` 的 import。

把 `desktop-fetch.ts` 挪到 `packages/bundle/desktop-app/src/client/desktop-fetch.ts`。保持 GET + `Uint8Array.from(atob(...))`（不要再引入 `headersFromInit` 克隆）。invoke 缺失时抛 `desktop-app: desktop invoke missing`。

在 `packages/bundle/desktop-app/src/client/index.ts` 里，于 `ctx.provide('connection', handle)` 之后注册：

```ts
ctx.plugin({
  inject: ['sessionLogDownload'],
  apply: (inner: Context) => {
    inner.sessionLogDownload.adoptBlobTransport(desktopDoFetch)
  },
})
```

加上 `import { desktopDoFetch } from './desktop-fetch.ts'`。

加一个只导入类型的 augment，让 `inner.sessionLogDownload` 能通过 typecheck：

```ts
import type {} from '@deepseek-ai/dsh-session-log-export/client'
```

只导入类型会被擦除，不会碰到纯度门禁。把 `{ "path": "../../session-query/session-log-export" }` 加进 desktop-app `tsconfig.client.json` 的 `references`。

从 session-log-export 客户端 tsconfig 的 `include` / `files` 列表去掉 `src/client/desktop-fetch.ts`。

- [ ] **步骤 4：跑测试并重建**

运行： `pnpm exec vitest run packages/session-query/session-log-export/tests/client-apply.client.spec.tsx packages/session-query/session-log-export/tests/controller.client.spec.ts packages/bundle/desktop-app/tests/desktop-fetch.client.spec.ts packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts packages/bundle/desktop-app/tests/client-apply.client.spec.ts`

预期：PASS。

重建 session-log-export 和 desktop-app 的客户端 bundle：

```bash
pnpm exec tsc -b packages/session-query/session-log-export packages/bundle/desktop-app/tsconfig.client.json
pnpm --filter @deepseek-ai/dsh-session-log-export exec tsdown --env.DSH_BUILD_FACE client
pnpm --filter @deepseek-ai/dsh-desktop-app exec tsdown --env.DSH_BUILD_FACE client
```

- [ ] **步骤 5：提交**

```bash
git add packages/session-query/session-log-export packages/bundle/desktop-app
git add -u packages/session-query/session-log-export/src/client/desktop-fetch.ts packages/session-query/session-log-export/tests/desktop-fetch.client.spec.ts
git commit -m "$(cat <<'EOF'
fix(session-log-export): restore Web HEAD download; adopt blob on desktop-app

The Web session-log plugin must not import IPC GET. Desktop-app switches the controller to blob transport after sessionLogDownload exists.
EOF
)"
```

---

### 任务 4：文档、Agent Note、Host 双绑定检查、组装后的 Web/桌面

各包 README 和桌面 IPC 载波 Agent Note 必须陈述当前行为：Web 客户端图不加载 IPC 实现；由 desktop-app 的 immediately 客户端半边提供。Host 双绑定保持不变。组装检查：Web 壳能画出来；`dsh desktop` 仍能打开；Session log ZIP 仍经 IPC 保存。

**文件：**
- 修改： `packages/client/connection/README.md` and `.zh.md` (one physical line per paragraph)
- 修改： `packages/bundle/desktop-app/README.md` and `.zh.md`
- 修改： `packages/session-query/session-log-export/README.md` and `.zh.md`
- 修改： `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md` and `.zh.md` (present tense; no spec-speak)
- 测试： `packages/client/connection/tests/node-half.host.spec.ts` (run existing dual-bind cases; no behavior change)
- 测试： `packages/bundle/desktop-app/tests/composition.spec.ts` (already updated in Task 2)
- 测试： `packages/bundle/web-app/tests/web-app.spec.ts` (must not provide `desktopRuntime`)

**接口：**
- 消费：任务 1–3 的行为
- 产出：文档化的 Web vs 桌面客户端载波拆分；重新记录 pairing

- [ ] **步骤 1：更新文案**

connection README（中英一起改）：浏览器 `apply` 构造 `WebApiClient` 或 fixture 客户端，`rpc.call` 使用 `window.fetch`。当存在 `window.dshDesktop` 且没有 `?fixture` 时，这一半不 provide `ctx.connection`。IPC 客户端住在 `@deepseek-ai/dsh-desktop-app/client`。保留 Host 双绑定和 base64 IPC body 的句子。

desktop-app README：本包声明 `dsh.client` 且 `immediately: true`。该客户端半边经 preload 桥提供 `IpcApiClient`，并把 Session-log 下载切到 blob GET。Web 从不挂载这个包。

session-log-export README：Web `apply` 始终先 HEAD，再交给浏览器下载管理器。desktop-app 的客户端半边调用 `adoptBlobTransport`，让同一控制器经 invoke GET ZIP 并保存 blob object URL。

Agent Note 的 Decision 段（替换“connection 客户端半边构造 `IpcApiClient`”那句）：connection 客户端半边构造 `WebApiClient`（或 fixture 客户端）。preload 桥存在时它不 provide `connection`。`dsh-desktop-app` 的 immediately 客户端半边提供 `IpcApiClient` 以及经 invoke 的 `rpc.call`。Web 从不挂载 `dsh-desktop-app`，因此 Web 客户端图不加载 IPC 实现。Session-log 的 blob 保存由同一 desktop-app 半边接管。

不要叙述迁移过程。只用现在时。每个段落一行物理行。

每对文档对齐后做 pairing：

```bash
pnpm run verify-translation-pairing --write packages/client/connection/README.md
pnpm run verify-translation-pairing --write packages/bundle/desktop-app/README.md
pnpm run verify-translation-pairing --write packages/session-query/session-log-export/README.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md
```

- [ ] **步骤 2：Host / 组合测试（无新行为）**

运行： `pnpm exec vitest run packages/client/connection/tests/node-half.host.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts packages/bundle/web-app/tests/web-app.spec.ts packages/bundle/desktop-app/tests/runtime.spec.ts`

预期：PASS。Web 组合仍然没有 `desktopRuntime`。Desktop runtime 仍然 `setApiFetch`。

- [ ] **步骤 3：组装检查**

重建任务 1–3 改过但还没重建的客户端 bundle。

分别运行 `pnpm dsh web` 和 `pnpm run dev:web`。预期：工作区选择器 / Session 列表 / 聊天壳，不是空白页。DevTools 控制台不得出现 `IpcApiClient` / `ipc-api-client` 里的崩溃。

运行 `pnpm dsh desktop`。预期：打开一个窗口。Session log 仍能保存 ZIP（invoke GET、blob 保存）。不要把剩下的桌面打磨问题算进本任务。

若 Web 仍是空白，说明 connection 的 `lib/client.js` 仍含 IPC，或另一个已挂载的客户端半边仍在值导入它 — 在 `packages/*/*/lib/client.js` 里 grep `IpcApiClient`，排除 `packages/bundle/desktop-app/lib/client.js`。

- [ ] **步骤 4：提交**

```bash
git add packages/client/connection/README.md packages/client/connection/README.zh.md packages/client/connection/README.i18n.yaml packages/bundle/desktop-app/README.md packages/bundle/desktop-app/README.zh.md packages/bundle/desktop-app/README.i18n.yaml packages/session-query/session-log-export/README.md packages/session-query/session-log-export/README.zh.md packages/session-query/session-log-export/README.i18n.yaml .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.zh.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.i18n.yaml
git commit -m "$(cat <<'EOF'
docs: record that the Web client graph does not load IpcApiClient

Connection's browser apply is HTTP-only; dsh-desktop-app's immediately client half owns the IPC carrier and Session-log blob save.
EOF
)"
```
