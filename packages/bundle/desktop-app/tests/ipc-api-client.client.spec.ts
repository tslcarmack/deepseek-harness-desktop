// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpcApiClient, ipcDoFetch } from '../src/client/ipc-api-client.ts'

afterEach(() => {
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
})

describe('IpcApiClient', () => {
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

  it('reconstructs a binary Response from a base64 IPC body', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = {
      invoke: async () => ({
        status: 200,
        headers: { 'content-type': 'application/zip' },
        body: Buffer.from(zip).toString('base64'),
        bodyEncoding: 'base64',
      }),
      onMux: () => () => {},
      onHost: () => () => {},
      loadBundle: async () => '',
    }
    const response = await ipcDoFetch(new URL('http://dsh.internal/api/session.export'))
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(zip)
  })
})
