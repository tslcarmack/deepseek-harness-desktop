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
