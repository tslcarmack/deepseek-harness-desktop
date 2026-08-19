/** Preload-injected desktop bridge types and a typed reader for `globalThis.dshDesktop`. */

/**
 * Unary IPC request the renderer sends through the preload bridge.
 */
export interface IpcFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

/**
 * Unary IPC response the preload bridge returns to the renderer.
 * JSON and other textual bodies stay UTF-8 strings. ZIP and other non-textual
 * bodies use `bodyEncoding: 'base64'` so binary octets survive structured clone.
 */
export interface IpcFetchResponse {
  status: number
  headers: Record<string, string>
  body: string
  bodyEncoding?: 'utf8' | 'base64'
}

/**
 * Narrow main-world API preload exposes. The renderer never imports `ipcRenderer`.
 */
export interface DshDesktopBridge {
  /**
   * Post one unary envelope and wait for the matching ServerResponse JSON.
   * @param request - method, URL, headers, and JSON body.
   * @returns HTTP-shaped status, headers, and body from the shared fetch handler. Non-textual bodies set `bodyEncoding` to `base64`.
   */
  invoke(request: IpcFetchRequest): Promise<IpcFetchResponse>
  /**
   * Subscribe to mux ServerRequest JSON documents.
   * @param listener - receives one complete JSON document per frame.
   * @returns unsubscriber.
   */
  onMux(listener: (json: string) => void): () => void
  /**
   * Subscribe to host ServerRequest JSON documents.
   * @param listener - receives one complete JSON document per frame.
   * @returns unsubscriber.
   */
  onHost(listener: (json: string) => void): () => void
  /**
   * Load a graph-row client bundle as source text.
   * @param url - graph `url` (`/plugins/<id>/client.js?rev=…`).
   * @returns the on-disk `lib/client.js` source.
   */
  loadBundle(url: string): Promise<string>
}

function isFn(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

/**
 * Read `globalThis.dshDesktop` when it implements the preload bridge.
 * @returns the bridge, or `undefined` when the object is absent or incomplete.
 */
export function readDshDesktop(): DshDesktopBridge | undefined {
  const candidate = (globalThis as { dshDesktop?: unknown }).dshDesktop
  if (candidate === null || typeof candidate !== 'object') return undefined
  const bridge = candidate as DshDesktopBridge
  if (!isFn(bridge.invoke) || !isFn(bridge.onMux) || !isFn(bridge.onHost) || !isFn(bridge.loadBundle)) {
    return undefined
  }
  return bridge
}
