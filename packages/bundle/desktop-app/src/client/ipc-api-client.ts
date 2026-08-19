/** Desktop API carrier: unary invoke plus mux/host JSON downlinks over the preload bridge. */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { readDshDesktop, type DshDesktopBridge } from './dsh-desktop.ts'

type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

function requireDesktop(): DshDesktopBridge {
  const desktop = readDshDesktop()
  if (desktop === undefined) throw new Error('desktop-app: IpcApiClient requires window.dshDesktop')
  return desktop
}

function headersFromInit(init: RequestInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  const raw = init?.headers
  if (raw instanceof Headers) raw.forEach((value, key) => { headers[key] = value })
  else if (Array.isArray(raw)) for (const [key, value] of raw) headers[key] = value
  else if (raw !== undefined) for (const [key, value] of Object.entries(raw)) headers[key] = value
  return headers
}

/**
 * Unary fetch through the preload invoke bridge (ApiProxy methods, generic `/api` RPC, and ZIP downloads).
 * @param input - request URL (path is what main rewrites onto loopback).
 * @param init - method, headers, and body.
 * @returns HTTP-shaped Response from main; base64 IPC bodies are decoded to bytes.
 */
export async function ipcDoFetch(input: URL, init?: RequestInit): Promise<Response> {
  const desktop = requireDesktop()
  const body = typeof init?.body === 'string' ? init.body : init?.body == null ? null : String(init.body)
  const reply = await desktop.invoke({
    url: input.href,
    method: init?.method ?? 'GET',
    headers: headersFromInit(init),
    body,
  })
  return new Response(bodyInitFromIpc(reply), { status: reply.status, headers: reply.headers })
}

function bodyInitFromIpc(reply: { body: string; bodyEncoding?: 'utf8' | 'base64' }): BodyInit {
  if (reply.bodyEncoding !== 'base64') return reply.body
  const binary = atob(reply.body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Browser platform subclass: unary/respond use the preload invoke; mux/host use JSON subscriptions. */
export class IpcApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return ipcDoFetch(input, init)
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readIpc('mux', signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readIpc('host', signal, hostFrameSchema, onOpen)
  }

  private async *readIpc<F extends MuxFrame | HostFrame>(
    stream: 'mux' | 'host',
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const desktop = requireDesktop()
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleJson = (json: string): void => {
      let full: ServerRequest
      let frame: F
      try {
        full = serverRequestSchema.parse(JSON.parse(json) as unknown)
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[desktop-app] dropping malformed IPC frame on ${stream}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const unsubscribe = stream === 'mux' ? desktop.onMux(handleJson) : desktop.onHost(handleJson)
    const handleAbort = (): void => { enqueue({ kind: 'end' }) }
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    onOpen?.()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      unsubscribe()
    }
  }
}
