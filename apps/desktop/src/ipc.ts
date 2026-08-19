/** IPC channel names shared by Electron main and the CJS preload. */

export const DSH_IPC = {
  bootGraph: 'dsh:boot-graph',
  invoke: 'dsh:invoke',
  mux: 'dsh:mux',
  host: 'dsh:host',
  loadBundle: 'dsh:load-bundle',
} as const

/** Thrown when an invoke or load-bundle call is not from this window's webContents. */
export const FOREIGN_WEB_CONTENTS = 'desktop: foreign webContents'

/**
 * Subscribe one JSON listener to an ipcRenderer-style channel.
 * @param register - `ipcRenderer.on`.
 * @param unregister - `ipcRenderer.off`.
 * @param channel - mux or host channel.
 * @param listener - receives the JSON document argument.
 * @returns unsubscriber.
 */
export function attachJsonListener(
  register: (channel: string, handler: (event: unknown, json: string) => void) => void,
  unregister: (channel: string, handler: (event: unknown, json: string) => void) => void,
  channel: string,
  listener: (json: string) => void,
): () => void {
  const handler = (_event: unknown, json: string): void => { listener(json) }
  register(channel, handler)
  return () => { unregister(channel, handler) }
}
