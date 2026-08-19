/** Desktop immediately-tier client half: provide IPC connection when the preload bridge exists. */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
import { IpcApiClient, ipcDoFetch } from './ipc-api-client.ts'
import { desktopDoFetch } from './desktop-fetch.ts'
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
  ctx.plugin({
    inject: ['sessionLogDownload'],
    apply: (inner: Context) => {
      inner.sessionLogDownload.adoptBlobTransport(desktopDoFetch)
    },
  })
}
