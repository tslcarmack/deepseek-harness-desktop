# Web / desktop client-carrier split Implementation Plan

English | [中文](2026-08-19-web-desktop-client-carrier-split.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `dsh web` / `dev:web` to the pre-desktop client graph (no IPC implementation on that graph) while `dsh desktop` still opens and Session log still saves a ZIP over IPC.

**Architecture:** The connection browser `apply` constructs only `WebApiClient` (or the fixture client) and uses `window.fetch`. When `window.dshDesktop` is present and `?fixture` is absent, it does not `provide('connection')`. `dsh-desktop-app` gains an `immediately: true` client half that provides `IpcApiClient` and invoke-backed `rpc.call`. Session-log-export browser `apply` is HEAD + href again; desktop-app adopts blob transport after `sessionLogDownload` exists.

**Tech Stack:** Cordis client plugins, existing preload `window.dshDesktop`, tsdown `clientBundle` with `hostPhase: true`, vitest jsdom client specs.

**Spec:** [docs/superpowers/specs/2026-08-19-web-desktop-client-carrier-split-design.md](../specs/2026-08-19-web-desktop-client-carrier-split-design.md)

## Global Constraints

- Do not add `@deepseek-ai/dsh-client-connection/client` to `PLATFORM_MODULES` or `INLINE_SAFE`. Desktop-app must not value-import that specifier (type-only imports are allowed).
- Do not extract desktop into an out-of-tree `dsh plugin`. Do not revert Host `webServer` / `desktopRuntime` dual-bind.
- Do not edit `packages/bundle/web-app/cordis.patch.yml`. That file already disables HMR independently of this change; desktop HMR stays disabled only in `dsh-desktop-app`'s patch.
- Do not re-record model-conversation snapshots. Do not batch-fix unrelated desktop UI/Host nits.
- Do not mix unrelated dirty tree (`myplugins/`, `outputs/`, `.workbuddy/`, app-boot leftovers, the `2026-08-14-root-include-absolute-plugin-file-url` notes) into these commits.
- Renderer still never imports `ipcRenderer`. Files end with exactly one trailing newline. Tests use `node:url` / `import.meta.url` rather than POSIX-only path literals.
- After any client source change that the renderer loads, rebuild that package's `lib/client.js` (`tsc -b` then `tsdown --env.DSH_BUILD_FACE client` as each task specifies). The renderer loads built bundles, not `src/`.
- Missing `ctx.connection` after boot stays a loud Cordis inject failure (runtime injects `connection`). Two `provide('connection')` calls stay a loud Cordis failure. Do not add a blank-root placeholder.
- Purity: `@deepseek-ai/dsh-host-apiproxy/client` and `/api` are INLINE_SAFE. Relative `@deepseek-ai/` specifiers are not. ConnectionController cannot be required from the frozen module table, so the desktop-app client half carries its own copy of the loop helper (jscpd ignore, citing the Agent Note).

## File structure

| Path | Role |
|---|---|
| `packages/client/connection/src/client/index.ts` | Web/fixture provide only; skip provide when `dshDesktop` and not `?fixture` |
| `packages/client/connection/src/client/handle.ts` | Shared `createConnectionHandle` used by the Web apply |
| `packages/client/connection/src/client/dsh-desktop.ts` | Tiny `readDshDesktop` window check (no IPC client) |
| `packages/bundle/desktop-app/src/client/index.ts` | Immediately client half: provide `IpcApiClient`; adopt Session-log blob transport |
| `packages/bundle/desktop-app/src/client/ipc-api-client.ts` | Moved `IpcApiClient` / `ipcDoFetch` |
| `packages/bundle/desktop-app/src/client/dsh-desktop.ts` | Desktop copy of the preload bridge reader |
| `packages/bundle/desktop-app/src/client/connection-controller.ts` | Inlined `ConnectionController` (purity; jscpd ignore) |
| `packages/bundle/desktop-app/src/client/rpc.ts` | Inlined `createWebConnectionRpc` (purity; jscpd ignore) |
| `packages/bundle/desktop-app/src/client/random-uuid.ts` | Inlined UUID helper used by rpc |
| `packages/bundle/desktop-app/src/client/handle.ts` | Inlined `createConnectionHandle` |
| `packages/bundle/desktop-app/src/client/desktop-fetch.ts` | Moved Session-log IPC GET |
| `packages/session-query/session-log-export/src/client/index.ts` | Web-only `new SessionLogDownloadController()` |
| `packages/session-query/session-log-export/src/client/controller.ts` | `adoptBlobTransport(fetcher)` |
| `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md` | Shipped decision: Web graph does not load the IPC client |

---

### Task 1: Connection client apply is Web-only

The connection browser entry must not statically import `IpcApiClient` or `ipcDoFetch`. With the preload bridge and no `?fixture`, it must not `provide('connection')`. Fixture still provides even when the bridge exists.

**Files:**
- Create: `packages/client/connection/src/client/handle.ts`
- Modify: `packages/client/connection/src/client/index.ts`
- Modify: `packages/client/connection/tsconfig.client.json` (add `handle.ts`; remove `ipc-api-client.ts` only in Task 2 when that file moves)
- Test: `packages/client/connection/tests/client-apply.client.spec.ts`

**Interfaces:**
- Consumes: existing `readDshDesktop()`, `WebApiClient`, `FixtureApiClient`, `createWebConnectionRpc()`, `ConnectionController`
- Produces: `createConnectionHandle(api: IApiClient, rpc: ClientConnectionRpc, isLoopback: boolean): ConnectionHandle`; `apply` provides only for fixture or Web

- [ ] **Step 1: Write the failing tests**

In `packages/client/connection/tests/client-apply.client.spec.ts`:

Remove the import of `IpcApiClient`.

Replace the two desktop-bridge tests (`uses IpcApiClient…` and `carries generic RPC through the desktop invoke bridge…`) with:

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

Keep every existing Web / fixture / loopback / `start()` test.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts -t "does not provide connection when the desktop bridge"`

Expected: FAIL because `apply` still constructs `IpcApiClient` and provides `ctx.connection`.

- [ ] **Step 3: Minimal implementation**

Create `packages/client/connection/src/client/handle.ts` by moving the handle object currently built inside `apply` (description listeners, `start` / `stop`, `ConnectionController`) into:

```ts
export function createConnectionHandle(
  api: IApiClient,
  rpc: ClientConnectionRpc,
  isLoopback: boolean,
): ConnectionHandle
```

Keep the same `start()` second-consumer error string, the same `publishDescription` listener isolation, and the same `onConnected` stale-generation guard. Import `ConnectionHandle` from `./index.ts` only as a type if that creates a cycle; if it does, move the `ConnectionHandle` interface into `handle.ts` and re-export it from `index.ts`.

Replace `packages/client/connection/src/client/index.ts` `apply` with:

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

Delete `import { IpcApiClient, ipcDoFetch } from './ipc-api-client.ts'`. Keep `import { readDshDesktop } from './dsh-desktop.ts'`. Update the file's module JSDoc: this half provides fixture or HTTP transport; it does not construct the IPC client.

Add `src/client/handle.ts` to `packages/client/connection/tsconfig.client.json` `files`.

Leave `ipc-api-client.ts` on disk until Task 2 moves it (Task 1 tests must not import it; `tsconfig.client.json` may still list it until the move).

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts`

Expected: all PASS, including skip-provide, fixture-with-bridge, static-import, and existing Web cases.

Rebuild the connection client artifact (renderer loads `lib/client.js`):

```bash
pnpm exec tsc -b packages/client/connection/tsconfig.client.json
pnpm --filter @deepseek-ai/dsh-client-connection exec tsdown --env.DSH_BUILD_FACE client
```

Confirm `packages/client/connection/lib/client.js` does not contain `IpcApiClient` or `ipc-api-client`.

- [ ] **Step 5: Commit**

```bash
git add packages/client/connection/src/client/index.ts packages/client/connection/src/client/handle.ts packages/client/connection/tsconfig.client.json packages/client/connection/tests/client-apply.client.spec.ts
git commit -m "$(cat <<'EOF'
fix(connection): keep desktop IPC out of the Web client apply

The Web graph must not construct IpcApiClient. Skip provide when the preload bridge exists so dsh-desktop-app can own that carrier.
EOF
)"
```

---

### Task 2: `dsh-desktop-app` immediately client half provides IPC

Web never mounts this package, so Web never loads this half. Desktop mounts it; both this half and connection are `immediately: true`. Provide-order: connection skips (Task 1); this half provides. If `?fixture` is set, this half also skips so the fixture provide from connection remains unique.

**Files:**
- Create: `packages/bundle/desktop-app/src/client/index.ts`
- Create: `packages/bundle/desktop-app/src/client/ipc-api-client.ts` (move from connection)
- Create: `packages/bundle/desktop-app/src/client/dsh-desktop.ts` (copy of the bridge reader)
- Create: `packages/bundle/desktop-app/src/client/connection-controller.ts` (copy of `ConnectionController` with jscpd ignore)
- Create: `packages/bundle/desktop-app/src/client/rpc.ts` (copy of `createWebConnectionRpc` with jscpd ignore)
- Create: `packages/bundle/desktop-app/src/client/random-uuid.ts` (copy)
- Create: `packages/bundle/desktop-app/src/client/handle.ts` (copy of `createConnectionHandle` with jscpd ignore)
- Create: `packages/bundle/desktop-app/tsdown.config.ts`
- Create: `packages/bundle/desktop-app/tsconfig.client.json`
- Modify: `packages/bundle/desktop-app/package.json` (`./client` export, `files` includes `lib/client.js`, `dsh.client`)
- Modify: `packages/bundle/desktop-app/tsconfig.json` (exclude `src/client`)
- Modify: `packages/bundle/desktop-app/src/invariant.ts` (JSDoc: IPC client lives in this package's client half)
- Modify: `packages/client/tsdown.client.ts` (`ClientBundleOptions.clientEntry`)
- Modify: `tsconfig.client.json` (reference desktop-app client tsconfig)
- Delete after move: `packages/client/connection/src/client/ipc-api-client.ts`; drop it from connection `tsconfig.client.json` `files`
- Test: `packages/bundle/desktop-app/tests/client-apply.client.spec.ts`
- Test: `packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts` (move from connection)
- Test: `packages/bundle/desktop-app/tests/composition.spec.ts` (assert `dsh.client.immediately`)

**Interfaces:**
- Consumes: Task 1 skip-provide; preload `window.dshDesktop`; INLINE_SAFE `@deepseek-ai/dsh-host-apiproxy/client` and `/api`
- Produces: `export const inject: string[] = []`; `export function apply(ctx: Context): void` that `provide('connection', handle)` with `handle.api instanceof IpcApiClient` and `rpc.call` going through `ipcDoFetch`; `export { IpcApiClient, ipcDoFetch }` from the client half for tests

- [ ] **Step 1: Write the failing tests**

Create `packages/bundle/desktop-app/tests/client-apply.client.spec.ts`:

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

Move `packages/client/connection/tests/ipc-api-client.client.spec.ts` to `packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts` and point imports at `../src/client/ipc-api-client.ts`.

In `packages/bundle/desktop-app/tests/composition.spec.ts` add:

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

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm exec vitest run packages/bundle/desktop-app/tests/client-apply.client.spec.ts packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts`

Expected: FAIL (missing `src/client/index.ts` / missing `dsh.client` metadata).

- [ ] **Step 3: Minimal implementation**

In `packages/client/tsdown.client.ts`, extend `ClientBundleOptions`:

```ts
interface ClientBundleOptions {
  readonly hostPhase?: boolean
  readonly companions?: readonly UserConfig[]
  readonly lib?: UserConfig
  /** Browser entry. When set, both the unset face and the Client face compile this path instead of `lib/types/client/index.js`. */
  readonly clientEntry?: string
}
```

In `clientBundle`, replace the `clientConfig` entry selection with:

```ts
const client = clientConfig(
  id,
  options.clientEntry ?? (face === undefined ? 'src/client/index.ts' : 'lib/types/client/index.js'),
)
```

Create `packages/bundle/desktop-app/tsdown.config.ts`:

```ts
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-desktop-app',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true, clientEntry: 'src/client/index.ts' },
)
```

`clientEntry` is `src/client/index.ts` so tsdown inlines TypeScript (including local copies) without requiring tsc to emit `lib/types/client/index.js` from a mixed `rootDir`.

Host `packages/bundle/desktop-app/tsconfig.json`: add `"exclude": ["src/client"]` so the Node program does not typecheck browser files.

Create `packages/bundle/desktop-app/tsconfig.client.json`:

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

Add `{ "path": "./packages/bundle/desktop-app/tsconfig.client.json" }` to `tsconfig.client.json` `references`.

`package.json` of desktop-app:

- Add export `"./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }`
- Add `lib/client.js` to `files`
- Add

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

Move `packages/client/connection/src/client/ipc-api-client.ts` to `packages/bundle/desktop-app/src/client/ipc-api-client.ts`. Change value imports from `./api.ts` to INLINE_SAFE host-apiproxy:

```ts
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { readDshDesktop, type DshDesktopBridge } from './dsh-desktop.ts'
```

Keep `ipcDoFetch`, `bodyInitFromIpc`, and `IpcApiClient` behavior identical (including base64 decode). Error string may read `desktop-app: IpcApiClient requires window.dshDesktop`.

Copy `packages/client/connection/src/client/dsh-desktop.ts` to `packages/bundle/desktop-app/src/client/dsh-desktop.ts` (connection keeps its own copy for the skip-provide check). Wrap the desktop-app copy with:

```ts
/* jscpd:ignore-start -- preload bridge reader duplicated because purity forbids value-import of dsh-client-connection/client; see 2026-08-18-desktop-shell-ipc-carrier */
```

and the matching `ignore-end` at EOF.

Copy `packages/client/connection/src/client/connection.ts` to `packages/bundle/desktop-app/src/client/connection-controller.ts`. Replace `from './api.ts'` with host-apiproxy `IApiClient` / frame types (same INLINE_SAFE specifiers as `ipc-api-client.ts`). Wrap the whole file in `jscpd:ignore-start` / `ignore-end` with the same Agent Note reason.

Copy `random-uuid.ts` the same way (jscpd ignore).

Copy `packages/client/connection/src/client/rpc.ts` to `packages/bundle/desktop-app/src/client/rpc.ts`. Keep host-apiproxy value imports. Change `import type { ClientConnectionRpc } from '../rpc.ts'` to `import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'` (type-only). Import `./random-uuid.ts`. Wrap with jscpd ignore.

Copy `packages/client/connection/src/client/handle.ts` to `packages/bundle/desktop-app/src/client/handle.ts`. Import `ConnectionController` from `./connection-controller.ts`. Import `import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'`. Wrap with jscpd ignore.

Create `packages/bundle/desktop-app/src/client/index.ts`:

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

Remove `src/client/ipc-api-client.ts` from `packages/client/connection/tsconfig.client.json` `files`. Delete the connection file after the move.

Update `packages/bundle/desktop-app/src/invariant.ts` companion comment: this package's client half provides `IpcApiClient`; the host half still only provides `desktopRuntime`.

- [ ] **Step 4: Run tests and rebuild**

Run: `pnpm exec tsc -b packages/bundle/desktop-app/tsconfig.client.json packages/client/connection/tsconfig.client.json`

Expected: PASS.

Run: `pnpm exec vitest run packages/bundle/desktop-app/tests/client-apply.client.spec.ts packages/bundle/desktop-app/tests/ipc-api-client.client.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts packages/client/connection/tests/client-apply.client.spec.ts`

Expected: PASS.

Rebuild both client artifacts:

```bash
pnpm exec tsc -b packages/client/connection/tsconfig.client.json packages/bundle/desktop-app/tsconfig.client.json
pnpm --filter @deepseek-ai/dsh-client-connection exec tsdown --env.DSH_BUILD_FACE client
pnpm --filter @deepseek-ai/dsh-desktop-app exec tsdown --env.DSH_BUILD_FACE client
```

Confirm `packages/bundle/desktop-app/lib/client.js` exists and contains the IPC client. Confirm connection `lib/client.js` still has no `IpcApiClient`.

- [ ] **Step 5: Commit**

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

### Task 3: Session-log Web apply is HEAD + href; desktop-app adopts blob transport

`dsh-session-log-export` browser `apply` must not import desktop fetch. Blob GET / base64 decode live in a module only the desktop-app client half imports. The controller keeps `saveMode: 'blob'` and gains `adoptBlobTransport` so the desktop-app nested plugin can switch after `sessionLogDownload` is provided (session-log-export is not `immediately`).

**Files:**
- Modify: `packages/session-query/session-log-export/src/client/index.ts`
- Modify: `packages/session-query/session-log-export/src/client/controller.ts`
- Delete: `packages/session-query/session-log-export/src/client/desktop-fetch.ts`
- Modify: `packages/bundle/desktop-app/src/client/index.ts` (nested plugin)
- Create: `packages/bundle/desktop-app/src/client/desktop-fetch.ts` (move)
- Test: `packages/session-query/session-log-export/tests/client-apply.client.spec.tsx`
- Test: `packages/session-query/session-log-export/tests/controller.client.spec.ts`
- Test: `packages/bundle/desktop-app/tests/desktop-fetch.client.spec.ts` (move)
- Test: `packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts`

**Interfaces:**
- Consumes: Task 2 `apply` already provides `connection`; `desktopDoFetch(input: string | URL, init?: RequestInit): Promise<Response>`
- Produces: `SessionLogDownloadController.adoptBlobTransport(fetcher: (input: string | URL, init?: RequestInit) => Promise<Response>): void` sets the fetcher and `saveMode` to `'blob'`

- [ ] **Step 1: Write the failing tests**

In `packages/session-query/session-log-export/tests/client-apply.client.spec.tsx`, delete the test `GETs the ZIP through desktop invoke and saves a blob URL`. Add:

```ts
it('does not import desktop invoke helpers', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  expect(src).not.toMatch(/desktop-fetch/)
  expect(src).not.toMatch(/desktopDoFetch/)
  expect(src).not.toMatch(/readDesktopInvoke/)
})
```

Keep the existing provide / Header / dispose test (it stubs `fetch` and expects HTTP error status from HEAD).

In `packages/session-query/session-log-export/tests/controller.client.spec.ts`, delete the two blob-mode unit tests (`buffers a GET ZIP…`, `publishes blob-mode HTTP failures…`) and relocate them into `packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts`. Session-log-export keeps HEAD + href coverage only. Add this adopt test to that same desktop-app file (it imports `SessionLogDownloadController`):

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

Construct with `new SessionLogDownloadController((input, init) => fetch(input, init), save)` so the first argument stays a real `Fetch`, then `adoptBlobTransport(fetcher)` overrides it.

Move `packages/session-query/session-log-export/tests/desktop-fetch.client.spec.ts` to `packages/bundle/desktop-app/tests/desktop-fetch.client.spec.ts` and point imports at `../src/client/desktop-fetch.ts`.

Create `packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts` that mounts desktop-app client `apply` and a stub `sessionLogDownload` service, then asserts `adoptBlobTransport` is called. Minimal version:

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

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm exec vitest run packages/session-query/session-log-export/tests/client-apply.client.spec.tsx packages/session-query/session-log-export/tests/controller.client.spec.ts -t "does not import desktop invoke"`

Expected: FAIL because `index.ts` still imports `./desktop-fetch.ts`.

- [ ] **Step 3: Minimal implementation**

In `packages/session-query/session-log-export/src/client/controller.ts`, change `fetcher` and `saveMode` from `private readonly` constructor fields to private assignable fields. Add:

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

Replace `packages/session-query/session-log-export/src/client/index.ts` apply construction with:

```ts
const controller = new SessionLogDownloadController()
```

Delete the `desktop-fetch` import.

Move `desktop-fetch.ts` to `packages/bundle/desktop-app/src/client/desktop-fetch.ts`. Keep GET + `Uint8Array.from(atob(...))` (do not reintroduce a `headersFromInit` clone). Throw `desktop-app: desktop invoke missing` when invoke is absent.

In `packages/bundle/desktop-app/src/client/index.ts`, after `ctx.provide('connection', handle)`, register:

```ts
ctx.plugin({
  inject: ['sessionLogDownload'],
  apply: (inner: Context) => {
    inner.sessionLogDownload.adoptBlobTransport(desktopDoFetch)
  },
})
```

Add `import { desktopDoFetch } from './desktop-fetch.ts'`.

Add a type-only augment so `inner.sessionLogDownload` typechecks:

```ts
import type {} from '@deepseek-ai/dsh-session-log-export/client'
```

Type-only imports are erased and never hit the purity gate. Add `{ "path": "../../session-query/session-log-export" }` to desktop-app `tsconfig.client.json` `references`.

Remove `src/client/desktop-fetch.ts` from session-log-export's client tsconfig `include` / `files` list.

- [ ] **Step 4: Run tests and rebuild**

Run: `pnpm exec vitest run packages/session-query/session-log-export/tests/client-apply.client.spec.tsx packages/session-query/session-log-export/tests/controller.client.spec.ts packages/bundle/desktop-app/tests/desktop-fetch.client.spec.ts packages/bundle/desktop-app/tests/session-log-blob.client.spec.ts packages/bundle/desktop-app/tests/client-apply.client.spec.ts`

Expected: PASS.

Rebuild session-log-export and desktop-app client bundles:

```bash
pnpm exec tsc -b packages/session-query/session-log-export packages/bundle/desktop-app/tsconfig.client.json
pnpm --filter @deepseek-ai/dsh-session-log-export exec tsdown --env.DSH_BUILD_FACE client
pnpm --filter @deepseek-ai/dsh-desktop-app exec tsdown --env.DSH_BUILD_FACE client
```

- [ ] **Step 5: Commit**

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

### Task 4: Docs, Agent Note, Host dual-bind check, assembled Web/desktop

Package READMEs and the desktop IPC carrier Agent Note must state current behavior: the Web client graph does not load the IPC implementation; desktop-app's immediately client half provides it. Host dual-bind stays. Assembled check: Web shell paints; `dsh desktop` still opens; Session log ZIP still saves over IPC.

**Files:**
- Modify: `packages/client/connection/README.md` and `.zh.md` (one physical line per paragraph)
- Modify: `packages/bundle/desktop-app/README.md` and `.zh.md`
- Modify: `packages/session-query/session-log-export/README.md` and `.zh.md`
- Modify: `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md` and `.zh.md` (present tense; no spec-speak)
- Test: `packages/client/connection/tests/node-half.host.spec.ts` (run existing dual-bind cases; no behavior change)
- Test: `packages/bundle/desktop-app/tests/composition.spec.ts` (already updated in Task 2)
- Test: `packages/bundle/web-app/tests/web-app.spec.ts` (must not provide `desktopRuntime`)

**Interfaces:**
- Consumes: Tasks 1–3 behavior
- Produces: documented Web vs desktop client-carrier split; pairing records re-written

- [ ] **Step 1: Update prose**

Connection README (English and Chinese together): the browser `apply` constructs `WebApiClient` or the fixture client and uses `window.fetch` for `rpc.call`. When `window.dshDesktop` is present and `?fixture` is absent, this half does not provide `ctx.connection`. The IPC client lives on `@deepseek-ai/dsh-desktop-app/client`. Keep the Host dual-bind and base64 IPC body sentences.

Desktop-app README: this package declares `dsh.client` with `immediately: true`. That client half provides `IpcApiClient` over the preload bridge and switches Session-log download to blob GET. Web never mounts this package.

Session-log-export README: Web `apply` always uses HEAD then the browser download manager. Desktop-app's client half calls `adoptBlobTransport` so the same controller GETs the ZIP through invoke and saves a blob object URL.

Agent Note Decision paragraph (replace the sentence that says the connection client half constructs `IpcApiClient`): the connection client half constructs `WebApiClient` (or the fixture client). When the preload bridge exists it does not provide `connection`. `dsh-desktop-app`'s immediately client half provides `IpcApiClient` and invoke-backed `rpc.call`. Web never mounts `dsh-desktop-app`, so the Web client graph does not load the IPC implementation. Session-log blob save is adopted from that same desktop-app half.

Do not narrate the migration. Present tense only. One physical line per paragraph.

Pairing after each pair is consistent:

```bash
pnpm run verify-translation-pairing --write packages/client/connection/README.md
pnpm run verify-translation-pairing --write packages/bundle/desktop-app/README.md
pnpm run verify-translation-pairing --write packages/session-query/session-log-export/README.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md
```

- [ ] **Step 2: Host / composition tests (no new behavior)**

Run: `pnpm exec vitest run packages/client/connection/tests/node-half.host.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts packages/bundle/web-app/tests/web-app.spec.ts packages/bundle/desktop-app/tests/runtime.spec.ts`

Expected: PASS. Web composition still has no `desktopRuntime`. Desktop runtime still `setApiFetch`.

- [ ] **Step 3: Assembled check**

Rebuild any client bundle touched and not rebuilt in Tasks 1–3.

Run `pnpm dsh web` and `pnpm run dev:web` (separately). Expected: workspace picker / session list / chat shell, not a blank page. DevTools console must not show a crash inside `IpcApiClient` / `ipc-api-client`.

Run `pnpm dsh desktop`. Expected: one window opens. Session log still saves a ZIP (invoke GET, blob save). Do not treat remaining desktop polish nits as this task.

If Web is still blank, the connection `lib/client.js` still contains IPC or another mounted client half still value-imports it — grep `IpcApiClient` under `packages/*/*/lib/client.js` except `packages/bundle/desktop-app/lib/client.js`.

- [ ] **Step 4: Commit**

```bash
git add packages/client/connection/README.md packages/client/connection/README.zh.md packages/client/connection/README.i18n.yaml packages/bundle/desktop-app/README.md packages/bundle/desktop-app/README.zh.md packages/bundle/desktop-app/README.i18n.yaml packages/session-query/session-log-export/README.md packages/session-query/session-log-export/README.zh.md packages/session-query/session-log-export/README.i18n.yaml .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.zh.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.i18n.yaml
git commit -m "$(cat <<'EOF'
docs: record that the Web client graph does not load IpcApiClient

Connection's browser apply is HTTP-only; dsh-desktop-app's immediately client half owns the IPC carrier and Session-log blob save.
EOF
)"
```
