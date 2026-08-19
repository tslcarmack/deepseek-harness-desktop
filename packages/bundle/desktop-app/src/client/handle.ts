/* jscpd:ignore-start -- duplicated: purity forbids value-import of dsh-client-connection/client
 * (2026-08-18-desktop-shell-ipc-carrier) */
/** Connection handle factory for the desktop IPC client half. */

import type { IApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import type { ConnectionHandle, ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  ConnectionController,
  type ConnectionConfig,
  type ConnectionSinks,
} from './connection-controller.ts'

type HostDescription = import('@deepseek-ai/dsh-host-apiproxy/api').ResponseValue<'host.describe'>

/**
 * Build the ctx.connection handle around one API client and RPC caller.
 * @param api - IPC client.
 * @param rpc - generic RPC channels over the preload invoke.
 * @param isLoopback - always true on the desktop preload bridge.
 * @returns the connection handle provided on ctx.
 */
export function createConnectionHandle(
  api: IApiClient,
  rpc: ClientConnectionRpc,
  isLoopback: boolean,
): ConnectionHandle {
  let started = false
  let description: HostDescription | undefined
  const descriptionListeners = new Set<() => void>()
  const publishDescription = (next: HostDescription | undefined): void => {
    if (Object.is(description, next)) return
    description = next
    for (const listener of [...descriptionListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[web-runtime] host-description listener threw:', error)
      }
    }
  }
  return {
    api,
    isLoopback,
    hostDescription: {
      getSnapshot: () => description,
      subscribe: (listener) => {
        descriptionListeners.add(listener)
        return () => { descriptionListeners.delete(listener) }
      },
    },
    rpc,
    start(sinks: ConnectionSinks, config?: ConnectionConfig) {
      if (started) throw new Error('connection: the stream loop is already owned by another consumer')
      started = true
      const controller = new ConnectionController(api, {
        ...sinks,
        onConnected: (next) => {
          publishDescription(next)
          if (!Object.is(description, next)) return
          sinks.onConnected?.(next)
        },
        onStateChange: (state) => {
          if (state === 'reconnecting') publishDescription(undefined)
          sinks.onStateChange?.(state)
        },
      }, config ?? {})
      controller.start()
      return {
        stop: () => {
          controller.stop()
          publishDescription(undefined)
        },
      }
    },
  }
}
/* jscpd:ignore-end */
