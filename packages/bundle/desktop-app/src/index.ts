/**
 * @deepseek-ai/dsh-desktop-app — the Electron-surface bundle's runtime glue.
 * Provides `desktopRuntime` so connection can bind ApiProxy without HTTP.
 * Window, preload, and ipcMain wiring live in `apps/desktop`.
 * @module @deepseek-ai/dsh-desktop-app
 */

import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { DesktopRuntime } from '@deepseek-ai/dsh-client-connection'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** No required services: the glue provides `desktopRuntime` for later rows. */
export const inject: string[] = []

/** DesktopRuntime plus the methods Electron main uses after the window exists. */
export interface DesktopRuntimeImpl extends DesktopRuntime {
  /** Current host-authored client boot graph. */
  readonly graph: () => WebBootGraph
  /**
   * Read the on-disk client bundle for a graph-row URL.
   * @param url - graph `url` (`/plugins/<id>/client.js?rev=…`).
   * @returns the `lib/client.js` source text.
   */
  loadBundleSource(url: string): Promise<string>
  /**
   * Subscribe to mux ServerRequest JSON.
   * @param listener - receives one complete JSON document per frame.
   * @returns unsubscriber.
   */
  subscribeMux(listener: (json: string) => void): () => void
  /**
   * Subscribe to host ServerRequest JSON.
   * @param listener - receives one complete JSON document per frame.
   * @returns unsubscriber.
   */
  subscribeHost(listener: (json: string) => void): () => void
}

function clientIdFromBundleUrl(url: string): string {
  const pathname = new URL(url, 'http://dsh.internal').pathname
  return decodeURIComponent(pathname.replace(/^\/plugins\//u, '').replace(/\/client\.js$/u, ''))
}

/**
 * Provide `desktopRuntime` for connection and for Electron main.
 * @param ctx - plugin context; `clientModules` is read lazily when graph or loadBundle run.
 * @returns nothing; `desktopRuntime` is provided on `ctx`.
 */
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
      const id = clientIdFromBundleUrl(url)
      const modules = ctx.get('clientModules')
      const path = modules?.clientPath(id)
      if (path === undefined) throw new Error(`desktop-app: no client bundle for ${id}`)
      return readFile(path, 'utf8')
    },
    subscribeMux(listener) {
      muxListeners.add(listener)
      return () => { muxListeners.delete(listener) }
    },
    subscribeHost(listener) {
      hostListeners.add(listener)
      return () => { hostListeners.delete(listener) }
    },
  }
  ctx.provide('desktopRuntime', runtime)
}
