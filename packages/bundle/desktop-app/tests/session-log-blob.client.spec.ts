// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { SessionLogDownloadController } from '../../../session-query/session-log-export/src/client/controller.ts'

const SID = 'session-export-controller' as SessionId

afterEach(() => {
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('desktop session-log blob transport', () => {
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

  it('buffers a GET ZIP and hands a blob URL to save', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    const fetcher = vi.fn(async () => new Response(zip, { status: 200 }))
    const save = vi.fn()
    const objectUrl = 'blob:session-log-export'
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const controller = new SessionLogDownloadController(fetcher, save, 'blob')

    await controller.download(SID)

    expect(fetcher).toHaveBeenCalledOnce()
    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.method).toBe('GET')
    expect(save).toHaveBeenCalledWith(objectUrl, 'dsh-session-session-export-controller.zip')
    expect(revoke).toHaveBeenCalledWith(objectUrl)
    expect(controller.store.getSnapshot().bySession[SID]).toEqual({
      open: true, status: 'success', error: null,
    })
  })

  it('publishes blob-mode HTTP failures without calling save', async () => {
    const save = vi.fn()
    const controller = new SessionLogDownloadController(
      async () => new Response('backend unavailable', { status: 500 }),
      save,
      'blob',
    )
    await controller.download(SID)
    expect(save).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().bySession[SID]).toEqual({
      open: true,
      status: 'error',
      error: 'Export failed: HTTP 500 backend unavailable',
    })
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
    await controller.download('session-export-apply' as SessionId)

    expect(invoke).toHaveBeenCalled()
    const request = invoke.mock.calls[0]?.[0] as { method: string; url: string }
    expect(request.method).toBe('GET')
    expect(request.url).toContain('/api/session.export')
    expect(click).toHaveBeenCalledOnce()
  })
})
