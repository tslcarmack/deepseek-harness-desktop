import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import { apply, type DesktopRuntimeImpl } from '../src/index.ts'

const graph: WebBootGraph = { rev: 'r1', entries: [] }

describe('desktopRuntime glue', () => {
  let scratch: string | undefined

  afterEach(() => {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
    scratch = undefined
  })

  it('fans mux and host frames to subscribers and ignores a stale setApiFetch disposer', () => {
    const ctx = new Context()
    apply(ctx)
    const runtime = ctx.get('desktopRuntime') as DesktopRuntimeImpl
    const mux: string[] = []
    const host: string[] = []
    const stopMux = runtime.subscribeMux((json) => { mux.push(json) })
    const stopHost = runtime.subscribeHost((json) => { host.push(json) })
    runtime.sendFrame('mux', '{"mux":1}')
    runtime.sendFrame('host', '{"host":1}')
    stopMux()
    stopHost()
    runtime.sendFrame('mux', '{"mux":2}')
    runtime.sendFrame('host', '{"host":2}')
    expect(mux).toEqual(['{"mux":1}'])
    expect(host).toEqual(['{"host":1}'])

    const first = (): Promise<Response> => Promise.reject(new Error('unused'))
    const second = (): Promise<Response> => Promise.reject(new Error('unused'))
    const disposeFirst = runtime.setApiFetch(first)
    const disposeSecond = runtime.setApiFetch(second)
    disposeFirst()
    disposeSecond()
  })

  it('reads graph and bundle source through clientModules', async () => {
    scratch = mkdtempSync(join(tmpdir(), 'dsh-desktop-app-'))
    const bundle = join(scratch, 'client.js')
    writeFileSync(bundle, 'export default 1\n', 'utf8')
    const ctx = new Context()
    apply(ctx)
    ctx.provide('clientModules', {
      graph: () => graph,
      clientPath: (id: string) => id === '@scope/pkg' ? bundle : undefined,
    })
    const runtime = ctx.get('desktopRuntime') as DesktopRuntimeImpl
    expect(runtime.graph()).toEqual(graph)
    await expect(runtime.loadBundleSource('/plugins/%40scope%2Fpkg/client.js?rev=abc'))
      .resolves.toBe('export default 1\n')
  })

  it('fails loud when clientModules or the bundle path is missing', async () => {
    const ctx = new Context()
    apply(ctx)
    const runtime = ctx.get('desktopRuntime') as DesktopRuntimeImpl
    expect(() => runtime.graph()).toThrow(/clientModules is not mounted/)
    await expect(runtime.loadBundleSource('/plugins/missing/client.js'))
      .rejects.toThrow(/no client bundle for missing/)
    ctx.provide('clientModules', {
      graph: () => graph,
      clientPath: () => undefined,
    })
    await expect(runtime.loadBundleSource('/plugins/still-missing/client.js'))
      .rejects.toThrow(/no client bundle for still-missing/)
  })
})
