/** Host-side IPC carrier for the two server-to-renderer event streams. */

import { randomUUID } from 'node:crypto'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { DesktopRuntime } from './desktop-runtime.ts'

type Frame = MuxFrame | HostFrame

function serverRequest(frame: RpcRequest<Frame>): ServerRequest {
  return {
    type: 'server-request',
    rpcId: frame.rpcId,
    method: frame.payload.type,
    payload: frame.payload,
  }
}

/**
 * Pumps `api.events.mux` / `host` onto `DesktopRuntime.sendFrame`.
 * Client messages stay on the unary invoke path.
 */
export class IpcDownlinks {
  /**
   * @param api - host API supplying the typed event streams.
   * @param desktop - IPC send face; throws while no window is attached are swallowed.
   */
  constructor(
    private readonly api: ApiProxy,
    private readonly desktop: DesktopRuntime,
  ) {}

  /**
   * Start both pumps.
   * @returns disposer that aborts both streams.
   */
  start(): () => void {
    const abort = new AbortController()
    void this.pump('mux', this.api.events.mux({
      rpcId: RpcId(randomUUID()),
      payload: {},
    }, abort.signal), abort)
    void this.pump('host', this.api.events.host({
      rpcId: RpcId(randomUUID()),
      payload: {},
    }, abort.signal), abort)
    return () => { abort.abort() }
  }

  private async pump<F extends Frame>(
    stream: 'mux' | 'host',
    frames: AsyncIterable<RpcRequest<F>>,
    abort: AbortController,
  ): Promise<void> {
    try {
      for await (const frame of frames) {
        try {
          this.desktop.sendFrame(stream, JSON.stringify(serverRequest(frame)))
        } catch {
          // No BrowserWindow is attached yet, or the window was destroyed.
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        try {
          this.desktop.sendFrame(stream, JSON.stringify(serverRequest({
            rpcId: RpcId(randomUUID()),
            payload: {
              type: 'stream/error',
              error: { code: 'internal', message: String(error), details: {} },
            },
          })))
        } catch {
          // No window remains to receive the failure frame.
        }
      }
    }
  }
}
