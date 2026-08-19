# Desktop Shell Implementation Plan

English | [中文](2026-08-18-desktop-shell.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source-launch `dsh desktop` opens one Electron window that boots the `desktop` profile, reuses the existing React client plugins over IPC, and never listens on a TCP port.

**Architecture:** Electron main is the harness process (`runProfile({ profile: 'desktop' })`). The Node `dsh` CLI only spawns that binary for a live boot. `dsh-desktop-app` stacks on `dsh-base` without `dsh-web-app` / `webserver`. The renderer loads the built `dsh-web-frontend` dist; preload injects `__DSH_BOOT__` and `window.dshDesktop`; `IpcApiClient` is the `AbstractApiClient` subclass.

**Tech Stack:** Cordis plugins, existing ApiProxy `toFetchHandler`, Electron 35 (devDependency, source-launch main via `tsx/esm`), existing client `lib/client.js` bundles.

**Spec:** [docs/superpowers/specs/2026-08-18-desktop-shell-design.md](../specs/2026-08-18-desktop-shell-design.md)

## Global Constraints

- No TCP listen and no `dsh-host-webserver` in the desktop profile.
- No second GUI; reuse `AppWebEntry` and the host-authored `dsh.client` graph.
- Version one: source-launch only; no installer, tray, menu, notifications, IPC client HMR, Electron `dialog`/`shell` replacements, custom `dsh://` HTTP impersonation, or page-level `fetch`/`WebSocket` polyfills.
- Close window exits; stderr + `installFailLoud` + exit 1 on boot failure; no Electron error dialog.
- Assembled GUI snapshots stay on `test:web`. No real-Electron CI gate in version one.
- Renderer never imports `ipcRenderer`. Privileged RPCs are allowed because the preload bridge exists (`isLoopback: true` when `window.dshDesktop` is present). Reconstruct IPC `Request` URLs as `http://127.0.0.1/api/...` so existing loopback fences still pass.
- Graph row URLs stay `/plugins/<id>/client.js?rev=...`; `BootSeams.loadBundle` intercepts them.
- Follow [docs/cookbook/adding-a-package.md](../../cookbook/adding-a-package.md) for `dsh-desktop-app`. Non-trivial commits include the Agent Note named in Task 1.
- Every task's tests use native `node:path` / `node:url` (no POSIX-only literals). Files end with one trailing newline.

## File structure

| Path | Role |
|---|---|
| `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md` (+ `.zh.md` + `.i18n.yaml`) | Shipped decision |
| `packages/client/modules/src/index.ts` | `ClientModuleRegistry` optional `webServer`; HTTP routes only when present |
| `packages/client/connection/src/client/ipc-api-client.ts` | `IpcApiClient` |
| `packages/client/connection/src/client/index.ts` | Choose fixture / IPC / Web; desktop `isLoopback` |
| `packages/client/connection/src/desktop-runtime.ts` | Structural `DesktopRuntime` consumed by the node half |
| `packages/client/connection/src/ipc-downlink.ts` | Pump `api.events.mux` / `host` onto `DesktopRuntime.sendFrame` |
| `packages/client/connection/src/index.ts` | Dual-bind: `webServer` or `desktopRuntime`, else fail loud |
| `packages/bundle/desktop-app/` | New bundle: patch + glue providing `desktopRuntime` |
| `packages/boot/app-boot/src/profile.ts` | `PROFILE_TEMPLATES.desktop` |
| `apps/desktop/` | Electron main, preload, package.json |
| `apps/cli/src/args.ts`, `bin.ts` | `dsh desktop` alias; spawn Electron only for live profile boot |
| `pnpm-workspace.yaml` | `allowBuilds.electron: true` |

Do not add `electron` as a dependency of any `packages/*` package. Only `apps/desktop` depends on `electron`.

---

### Task 1: Optional webServer on ClientModuleRegistry + Agent Note

`ClientModuleRegistry` currently `static inject = ['webServer', 'loader']` and always registers `/plugins` plus the index tap. Desktop has no webserver. Graph composition and `clientPath(id)` must work without it.

**Files:**
- Create: `.agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md` and `.zh.md` / `.i18n.yaml` (body = spec Decision, Alternatives, Consequences; Status: implemented)
- Modify: `packages/client/modules/src/index.ts` (`static inject`, constructor route registration)
- Test: `packages/client/modules/tests/node-half.client.spec.ts`

**Interfaces:**
- Consumes: existing `graph(): WebBootGraph`, `clientPath(id: string): string | undefined`
- Produces: registry constructs with only `loader`; `webServer` HTTP effects run iff `ctx.get('webServer')` is defined

- [ ] **Step 1: Write the failing test**

Add to `packages/client/modules/tests/node-half.client.spec.ts`:

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

Adapt the fixture seeding from the existing `webServer` test in that file so the graph is non-empty. Do not register fake HTTP routes.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run packages/client/modules/tests/node-half.client.spec.ts -t "without a webServer"`

Expected: FAIL because `inject` still requires `webServer` (fiber pending or constructor throws).

- [ ] **Step 3: Minimal implementation**

In `packages/client/modules/src/index.ts`:

```ts
static inject = ['loader']
```

In the constructor, after `this.composed = this.compose()` and the activation flush, wrap the two `ctx.webServer` effects:

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

Keep every existing HTTP test unchanged. Write the Agent Note triplet from the spec (present tense). Record pairing: `pnpm run verify-translation-pairing --write .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/client/modules/tests/node-half.client.spec.ts`

Expected: all PASS, including the new case and the existing HTTP registration cases.

- [ ] **Step 5: Commit**

```bash
git add packages/client/modules/src/index.ts packages/client/modules/tests/node-half.client.spec.ts .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.zh.md .agents/notes/implemented/architecture/2026-08-18-desktop-shell-ipc-carrier.i18n.yaml
git commit -m "feat(modules): compose the client boot graph without webServer"
```

---

### Task 2: IpcApiClient

**Files:**
- Create: `packages/client/connection/src/client/ipc-api-client.ts`
- Create: `packages/client/connection/src/client/dsh-desktop.ts` (bridge types + `readDshDesktop()`)
- Test: `packages/client/connection/tests/ipc-api-client.client.spec.ts` (`// @vitest-environment jsdom` first line)

**Interfaces:**
- Consumes: `AbstractApiClient` (`doFetch(input: URL, init?: RequestInit): Promise<Response>`, `openMux` / `openHost`)
- Produces:

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

`readDshDesktop` returns `undefined` unless `globalThis` has a `dshDesktop` object with `invoke`, `onMux`, `onHost`, and `loadBundle`.

- [ ] **Step 1: Write the failing test**

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

Adjust `sessions.list` value to match `UNARY_VALUE_SCHEMAS['session.list']` if the dummy `{ items: [] }` fails the second parse — copy a valid value from `client-apply.client.spec.ts`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run packages/client/connection/tests/ipc-api-client.client.spec.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement IpcApiClient**

`doFetch`:

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

Override `openMux` / `openHost` like `WebApiClient.readWebSocket`, but subscribe with `desktop.onMux` / `onHost`, parse `serverRequestSchema` then the frame schema, call `this.onEnvelope(full)`, yield `{ rpcId, payload: frame }`, and unsubscribe on abort. Call `onOpen` immediately after subscribe (IPC has no handshake). Drop malformed JSON with `console.error` like the WebSocket path.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/client/connection/tests/ipc-api-client.client.spec.ts packages/client/connection/tests/client-apply.client.spec.ts`

Expected: PASS. Existing Web/fixture apply tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/client/connection/src/client/ipc-api-client.ts packages/client/connection/src/client/dsh-desktop.ts packages/client/connection/tests/ipc-api-client.client.spec.ts
git commit -m "feat(connection): add IpcApiClient over the desktop preload bridge"
```

---

### Task 3: Connection client apply picks IpcApiClient

**Files:**
- Modify: `packages/client/connection/src/client/index.ts`
- Test: `packages/client/connection/tests/client-apply.client.spec.ts`

**Interfaces:**
- Consumes: `readDshDesktop()`, `IpcApiClient`, existing `FixtureApiClient` / `WebApiClient`
- Produces: `ctx.connection.api` is `IpcApiClient` when `dshDesktop` is present and `?fixture` is absent; `isLoopback` is `true` when `dshDesktop` is present

- [ ] **Step 1: Write the failing tests**

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

Keep the existing `WebApiClient` test. `?fixture` still wins over IPC.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts -t "desktop bridge"`

Expected: FAIL (`WebApiClient` still constructed; `isLoopback` false for empty hostname).

- [ ] **Step 3: Implement selection**

In `apply`:

```ts
const desktop = readDshDesktop()
const api: IApiClient = fixtureClient ?? (desktop !== undefined ? new IpcApiClient() : new WebApiClient())
```

```ts
isLoopback: desktop !== undefined || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/client/connection/tests/client-apply.client.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/connection/src/client/index.ts packages/client/connection/tests/client-apply.client.spec.ts
git commit -m "feat(connection): select IpcApiClient when the desktop bridge is present"
```

---

### Task 4: DesktopRuntime + connection node dual-bind

**Files:**
- Create: `packages/client/connection/src/desktop-runtime.ts`
- Create: `packages/client/connection/src/ipc-downlink.ts`
- Modify: `packages/client/connection/src/index.ts` (`inject`, `apply`)
- Test: `packages/client/connection/tests/node-half.host.spec.ts`

**Interfaces:**
- Consumes: `toFetchHandler(apiProxy).fetch`, `api.events.mux` / `host` (same as `WebSocketDownlinks`)
- Produces:

```ts
export interface DesktopRuntime {
  setApiFetch(fetch: (request: Request) => Promise<Response>): () => void
  sendFrame(stream: 'mux' | 'host', json: string): void
}
```

Context merge (in `desktop-runtime.ts`):

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopRuntime: DesktopRuntime
  }
}
```

`export const inject = []` (replace `['webServer']`). `apply` uses `ctx.get('webServer')` and `ctx.get('desktopRuntime')`.

IPC `Request` reconstruction uses `new Request(url.replace(/^file:\/\/.*$/u, 'http://127.0.0.1') …)` is wrong. Instead, when the desktop glue later forwards invokes, it will pass URLs like `http://dsh.internal/api/session.list` (file:// origin is `'null'`, so `AbstractApiClient.resolveBase()` is `http://dsh.internal`). Node-half fetch handler should rewrite the hostname to `127.0.0.1` before `isTrustedApiRequest` / privileged checks, or construct `new Request('http://127.0.0.1' + pathname + search, init)`.

Privileged methods: after rewrite, `isTrustedApiRequest(request, [])` is true for 127.0.0.1, matching loopback. Do not skip `PRIVILEGED_METHODS` for arbitrary IPC senders — only this process's preload can call invoke (enforced in Task 6 by checking `event.sender === window.webContents`).

- [ ] **Step 1: Write the failing tests**

In `node-half.host.spec.ts`:

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

Use a real `RpcId` if the schema requires the brand format. Keep every existing HTTP test: they still `provide('webServer', fakeHttpServer(...))`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run packages/client/connection/tests/node-half.host.spec.ts -t "desktopRuntime"`

Expected: FAIL (`inject` still `['webServer']` or apply always registers HTTP).

- [ ] **Step 3: Implement dual-bind**

Replace `export const inject = ['webServer']` with `export const inject: string[] = []`.

At the start of `apply`:

```ts
const webServer = ctx.get('webServer')
const desktopRuntime = ctx.get('desktopRuntime')
if (webServer === undefined && desktopRuntime === undefined) {
  throw new Error('client-connection: needs webServer or desktopRuntime')
}
```

If `webServer` is defined, keep the current route + WebSocket block unchanged (use that `webServer` instead of `ctx.webServer`).

If `desktopRuntime` is defined:

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

`IpcDownlinks.start()` returns a disposer that aborts both pumps. Implementation: copy the pump loop from `WebSocketDownlinks` (for-await `api.events.mux` / `host`, `JSON.stringify` of `{ type: 'server-request', rpcId, method: frame.payload.type, payload: frame.payload }`, `desktopRuntime.sendFrame`). Do not import `ws`. Swallow `sendFrame` throws when no window is attached yet (Task 6 attaches the window after boot).

Both carriers must not be installed in one process in version one, but `apply` may see only one of the two services.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/client/connection/tests/node-half.host.spec.ts packages/client/connection/tests/websocket-downlink.host.spec.ts packages/client/connection/tests/http-bridge.host.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/connection/src/index.ts packages/client/connection/src/desktop-runtime.ts packages/client/connection/src/ipc-downlink.ts packages/client/connection/tests/node-half.host.spec.ts
git commit -m "feat(connection): bind ApiProxy to desktopRuntime when webServer is absent"
```

---

### Task 5: dsh-desktop-app bundle + desktop profile template

**Files:**
- Create: `packages/bundle/desktop-app/` following `packages/bundle/web-app/` (package.json, tsconfig.json, src/index.ts, src/invariant.ts, cordis.patch.yml, README.md + README.zh.md + i18n.yaml)
- Modify: `packages/boot/app-boot/src/profile.ts` (`PROFILE_TEMPLATES.desktop`)
- Modify: `packages/boot/app-boot/tests/profile.spec.ts`
- Modify: `tsconfig.host.json` (add `{ "path": "./packages/bundle/desktop-app" }`)
- Modify: `packages/bundle/README.md` and `README.zh.md` (table row)
- Modify: `apps/cli/package.json` (dependency `@deepseek-ai/dsh-desktop-app`)
- Test: `packages/bundle/desktop-app/tests/composition.spec.ts`

**Interfaces:**
- Consumes: `DesktopRuntime` from Task 4
- Produces: `ctx.desktopRuntime` from the glue plugin; profile template `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app']`

Glue plugin (`packages/bundle/desktop-app/src/index.ts`):

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

Add `subscribeMux` / `subscribeHost` on the impl (not on the connection-facing `DesktopRuntime`) so apps/desktop can forward `sendFrame` into `webContents.send` after the window exists. Connection's `IpcDownlinks` calls `sendFrame`; the glue fans out to subscribers that apps/desktop registers.

`cordis.patch.yml`: copy `packages/bundle/web-app/cordis.patch.yml` then:

- Delete rows `web-startup`, `webserver`, `web-runtime` (the HTTP printer / frontend-static / trustedHosts).
- Insert `id: desktop-runtime`, `name: '@deepseek-ai/dsh-desktop-app'` before `modules`.
- Keep `modules`, `connection`, the full `dsh.client` roster, `client-hmr`, workspace, apiproxy, directory-picker, and the other host rows web-app inserts.
- Change connection config: remove `trustedHosts: !!js ctx.webRuntime.trustedHosts` (no LAN). Use `trustedHosts: []` or omit (schema default `[]`).
- Remove `inject: [webRuntime]` from the connection row.
- Keep `client-hmr` mounted (idle).

`package.json` dependencies: same client/host roster as web-app **minus** `dsh-host-webserver`, `dsh-host-frontend-static`, `dsh-web-frontend` can stay because the glue or apps/desktop resolves the dist via `createRequire` of `@deepseek-ai/dsh-web-frontend` — add that dependency so `require.resolve` works. No `electron`.

README Known Limitations: Electron binary must be approved (`pnpm approve-builds`); frontend dist and client bundles must already be built; version one has no installer.

- [ ] **Step 1: Write the failing profile + dump tests**

In `packages/boot/app-boot/tests/profile.spec.ts`, next to the web template assertion:

```ts
expect(PROFILE_TEMPLATES.desktop).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-desktop-app'])
```

In `packages/bundle/desktop-app/tests/composition.spec.ts`:

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

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts -t desktop`

Expected: FAIL (`PROFILE_TEMPLATES.desktop` undefined).

- [ ] **Step 3: Create the package and template**

Copy package scaffolding from web-app / headless. Set `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. Add `PROFILE_TEMPLATES.desktop`. Register tsconfig.host.json. Add CLI dependency. Invariant companion: empty installer with reason that window/IPC effects live in `apps/desktop` and `connection` (or register a real invariant once Task 6 proves dispose of `setApiFetch`).

After files exist: `pnpm install` so the workspace links.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts packages/bundle/desktop-app/tests/composition.spec.ts`

Expected: PASS.

Also run: `pnpm exec tsx apps/cli/src/bin.ts --profile desktop --dump-default-config` (after template exists). Expected: YAML with `desktop-runtime`, without `webserver`. This uses Node only.

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/desktop-app packages/boot/app-boot/src/profile.ts packages/boot/app-boot/tests/profile.spec.ts tsconfig.host.json packages/bundle/README.md packages/bundle/README.zh.md packages/bundle/README.i18n.yaml apps/cli/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add dsh-desktop-app bundle and desktop profile template"
```

Re-record `packages/bundle/README` pairing if the table row changed both languages.

---

### Task 6: apps/desktop Electron main + preload

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts`, `apps/desktop/tsdown.config.ts` (preload only), `apps/desktop/README.md` + `.zh.md` + `.i18n.yaml`
- Modify: `pnpm-workspace.yaml` (`allowBuilds.electron: true`)
- Modify: root `package.json` script `"dsh:desktop": "pnpm dsh desktop"` only if needed; prefer the CLI alias in Task 7
- Test: `apps/desktop/tests/preload-bridge.spec.ts` (pure: serialize invoke + boot graph; mock no Electron)

**Interfaces:**
- Consumes: `runProfile` from `apps/cli/src/profile-boot.ts` (or duplicate the same import `@deepseek-ai/dsh-app-boot` + composeProfile path that `profile-boot.ts` uses). Prefer importing `runProfile` from a path apps/desktop can resolve: add a named export if `profile-boot.ts` is not exported. If `apps/cli` does not export `runProfile`, extract `runProfile` to `@deepseek-ai/dsh-app-boot` or `apps/cli/src/profile-boot.ts` imported via relative path from `apps/desktop` — **do not** duplicate shutdown/signal logic. Relative import `../../cli/src/profile-boot.ts` from `apps/desktop/src/main.ts` is acceptable in this monorepo for version one.
- Produces: window + preload bridge matching `DshDesktopBridge`

Preload (built to `apps/desktop/lib/preload.cjs` because Electron preload must be CJS):

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

Main (source-launched, not bundled):

1. `app.whenReady()`
2. `runProfile({ profile: 'desktop', patchFiles, args, environment })` with argv after `--` forwarded from the CLI spawn
3. `const runtime = ctx.get('desktopRuntime')` (the impl from Task 5)
4. Resolve frontend dist: `createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')` or whatever export `dsh-web-frontend` already uses (copy the resolve from `packages/bundle/web-app/src/index.ts`)
5. `BrowserWindow` `{ webPreferences: { preload: pathToPreloadCjs, contextIsolation: true, nodeIntegration: false, sandbox: false } }` — `sandbox: false` matches WorkBuddy's contextBridge requirement
6. `ipcMain.on('dsh:boot-graph', (event) => { event.returnValue = runtime.graph() })` only if `event.sender === window.webContents`
7. `ipcMain.handle('dsh:invoke', async (event, request) => { if (event.sender !== window.webContents) throw new Error('desktop: foreign webContents'); const response = await runtime.fetchFromPreload(request); return response })`
8. Subscribe `runtime` mux/host listeners → `window.webContents.send('dsh:mux', json)` (swallow if destroyed)
9. `loadFile(indexHtml)`
10. `window.on('closed')` → dispose `ctx.fiber` then `app.quit()`
11. `installFailLoud('dsh', process, () => ctx.fiber.dispose())`

Extend the Task 5 impl with `fetchFromPreload(request: IpcFetchRequest)` that builds `new Request(request.url, { method, headers, body })` and calls the `setApiFetch` handler. Missing handler → 503 body `desktop-app: api fetch not installed`.

Renderer `loadBundle` in AppWebEntry: `apps/desktop` cannot change `apps/web/src/main.ts`. Inject the seam from a tiny `apps/desktop/src/renderer.ts` **only if** the web dist cannot take seams. Spec says reuse the web frontend dist. The dist's `main.ts` is `new AppWebEntry(el).run()` with no seams.

Therefore `loadBundle` must work with default `<script src=url>`. `/plugins/...` will 404 on `file://`. Options allowed by spec: `BootSeams.loadBundle` requires a custom renderer entry.

**Resolution (lock this):** do not reuse the hashed web dist `main.ts` as-is. `apps/desktop/src/renderer.ts`:

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

Add `apps/desktop/index.html` with `<div id="root"></div>` and a script tag for the renderer bundle. Build renderer with a small Vite config that aliases the same `PLATFORM_MODULES` as `apps/web` (copy `apps/web/vite.config.ts` and change root/entry). This is still “reuse AppWebEntry + client plugins”, not a second GUI.

`package.json` of `apps/desktop`: `"private": true`, dependency `electron` (same major as WorkBuddy: `^35`), `tsx`, `@deepseek-ai/dsh-client-web`, `@deepseek-ai/dsh-web-frontend` if CSS/assets are imported through the shell. tsdown for preload only.

- [ ] **Step 1: Write a bridge unit test without Electron**

Test `fetchFromPreload` URL rewrite and `loadBundleSource` path mapping in `packages/bundle/desktop-app/tests/runtime.spec.ts` (pure Node). Do not import `electron`.

- [ ] **Step 2: Run it and confirm fail, then implement glue methods + apps/desktop files**

Run: `pnpm exec vitest run packages/bundle/desktop-app/tests/runtime.spec.ts`

- [ ] **Step 3: Implement main/preload/renderer as above**

Document in README: `pnpm approve-builds` must allow `electron`; first launch needs `pnpm run build` of client bundles and `pnpm --filter @deepseek-ai/dsh-web-frontend...` / whatever `apps/web` already documents for dist, plus `pnpm --filter @deepseek-ai/dsh-desktop build` for preload/renderer.

- [ ] **Step 4: Run package tests**

Run: `pnpm exec vitest run packages/bundle/desktop-app/tests packages/client/connection/tests/node-half.host.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop packages/bundle/desktop-app pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(desktop): add Electron main, preload bridge, and renderer seam"
```

---

### Task 7: CLI `dsh desktop` spawn + docs

**Files:**
- Modify: `apps/cli/src/args.ts` (desktop alias copied from `web`)
- Modify: `apps/cli/src/bin.ts` (profile `desktop` + mode profile → spawn Electron)
- Modify: `apps/cli/tests/args.spec.ts`
- Create: `apps/cli/src/spawn-desktop.ts`
- Modify: `apps/cli/README.md`, `README.zh.md`, `apps/cli/reference/README.md` + zh, `docs/architecture.md` (one sentence that desktop exists as a third profile)
- Test: `apps/cli/tests/spawn-desktop.spec.ts`

**Interfaces:**
- Consumes: `parseDshArgs` `mode: 'profile' | 'dump-config'`, Electron binary from `apps/desktop`
- Produces: `dsh desktop` live boot spawns Electron; `dsh desktop --dump-config` and `dsh --profile desktop --dump-config` stay in Node

- [ ] **Step 1: Write failing CLI tests**

In `args.spec.ts`, clone the `web` cases for `desktop` (`parse(['desktop'])` → `{ mode: 'profile', profile: 'desktop', patches: [], args: [] }`, dump-config, `--patch`).

In `spawn-desktop.spec.ts`:

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

Use `join` in the test instead of hard-coded drives if that is cleaner; assert relative positions, not Windows-only paths.

- [ ] **Step 2: Run tests, confirm fail**

Run: `pnpm exec vitest run apps/cli/tests/args.spec.ts apps/cli/tests/spawn-desktop.spec.ts`

- [ ] **Step 3: Implement alias + spawn**

`args.ts`: duplicate the `web` command block as `desktop` with description `boot the desktop profile (alias of --profile desktop); spawns Electron`. Dump flags stay launcher-owned so `--dump-config` never reaches Electron.

`bin.ts`:

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

`spawnDesktop`: `spawn(electronBinary, ['--import', tsxEsm, mainTs, ...forwarded], { stdio: 'inherit', windowsHide: false })`. Forward `--patch <abs>` by resolving paths with `resolve(process.cwd(), path)` before spawn so the child can re-read them. Exit with the child's exit code. If `electron` cannot be resolved, throw a labelled error naming `pnpm approve-builds` and `apps/desktop`.

Do not call `boot()` in the parent Node process.

- [ ] **Step 4: Run tests + dump-config**

Run: `pnpm exec vitest run apps/cli/tests/args.spec.ts apps/cli/tests/spawn-desktop.spec.ts`

Run: `pnpm exec tsx apps/cli/src/bin.ts desktop --dump-default-config`

Expected: prints YAML, process exits 0, no Electron.

Update bilingual CLI + architecture docs. Record pairing.

- [ ] **Step 5: Commit**

```bash
git add apps/cli docs/architecture.md docs/architecture.zh.md docs/architecture.i18n.yaml
git commit -m "feat(cli): add dsh desktop alias that spawns Electron"
```

---

## Manual verification (not a CI gate)

On a machine that already runs `pnpm dsh web`:

1. `pnpm approve-builds` → allow `electron`; `pnpm install`
2. Build frontend dist and client `lib/client.js` the same way as Web
3. Build `apps/desktop` preload + renderer
4. `pnpm dsh desktop` opens one window
5. Session list / prompt / tools / approvals match Web
6. No listener on 3080 (`netstat` / Resource Monitor)
7. Close window → process exits
8. `pnpm dsh desktop --patch ./path/to/overlay.yml` still boots

---

## Spec coverage

| Spec item | Task |
|---|---|
| Electron main is harness; CLI spawn | 6, 7 |
| No webserver / no TCP | 1, 4, 5, 7 dump |
| Reuse client plugins + AppWebEntry | 6 renderer |
| IpcApiClient / four quadrants | 2, 3, 4 |
| Preload bridge, no ipcRenderer in renderer | 6 |
| `__DSH_BOOT__` + loadBundle | 1 `clientPath`, 5 `loadBundleSource`, 6 |
| Privileged RPCs via bridge | 3 `isLoopback`, 4 URL rewrite, 6 sender check |
| Profile template + dump-config Node | 5, 7 |
| Failures / no dialog | 6 `installFailLoud` |
| Tests without real Electron | 1–5, 7 |
| Out of scope list | Global constraints; no tasks add those features |
| Agent Note | 1 |

## Self-review

- No TBD / “handle edge cases” without code.
- Names: `DshDesktopBridge`, `IpcFetchRequest`, `IpcFetchResponse`, `IpcApiClient`, `DesktopRuntime`, `IpcDownlinks`, `readDshDesktop` — used consistently.
- `ClientModuleRegistry.clientPath` already exists; Task 5 `loadBundleSource` uses it.
- Renderer cannot be the unmodified web dist `main.ts` because `BootSeams` is required; Task 6 locks a thin `apps/desktop/src/renderer.ts` that still uses `AppWebEntry`.
