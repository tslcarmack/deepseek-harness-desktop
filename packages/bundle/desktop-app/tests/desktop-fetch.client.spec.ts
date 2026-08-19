// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { desktopDoFetch, readDesktopInvoke } from '../src/client/desktop-fetch.ts'

afterEach(() => {
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
})

describe('desktop session-log fetch', () => {
  it('returns undefined unless invoke is a function', () => {
    expect(readDesktopInvoke()).toBeUndefined()
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = null
    expect(readDesktopInvoke()).toBeUndefined()
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = 1
    expect(readDesktopInvoke()).toBeUndefined()
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = { invoke: 1 }
    expect(readDesktopInvoke()).toBeUndefined()
  })

  it('throws when invoke disappears before the fetch', async () => {
    await expect(desktopDoFetch(new URL('http://dsh.internal/api/session.export')))
      .rejects.toThrow(/desktop invoke missing/)
  })

  it('defaults to GET with an empty body and keeps UTF-8 replies as text', async () => {
    const seen: Array<{ url: string; method: string; body: string | null }> = []
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop = {
      invoke: async (request: { url: string; method: string; body: string | null }) => {
        seen.push({ url: request.url, method: request.method, body: request.body })
        return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }
      },
    }

    const fromUrl = await desktopDoFetch(new URL('http://dsh.internal/api/x'))
    expect(await fromUrl.text()).toBe('{"ok":true}')
    const fromString = await desktopDoFetch('http://dsh.internal/api/x', { method: 'HEAD' })
    expect(fromString.status).toBe(200)
    expect(seen).toEqual([
      { url: 'http://dsh.internal/api/x', method: 'GET', body: null },
      { url: 'http://dsh.internal/api/x', method: 'HEAD', body: null },
    ])
  })
})
