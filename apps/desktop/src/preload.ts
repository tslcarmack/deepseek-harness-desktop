import { contextBridge, ipcRenderer } from 'electron'
import { attachJsonListener, DSH_IPC } from './ipc.ts'

const graph = ipcRenderer.sendSync(DSH_IPC.bootGraph)
contextBridge.exposeInMainWorld('__DSH_BOOT__', graph)
contextBridge.exposeInMainWorld('dshDesktop', {
  invoke: (request: unknown) => ipcRenderer.invoke(DSH_IPC.invoke, request),
  onMux: (listener: (json: string) => void) => attachJsonListener(
    (channel, handler) => { ipcRenderer.on(channel, handler) },
    (channel, handler) => { ipcRenderer.off(channel, handler) },
    DSH_IPC.mux,
    listener,
  ),
  onHost: (listener: (json: string) => void) => attachJsonListener(
    (channel, handler) => { ipcRenderer.on(channel, handler) },
    (channel, handler) => { ipcRenderer.off(channel, handler) },
    DSH_IPC.host,
    listener,
  ),
  loadBundle: (url: string) => ipcRenderer.invoke(DSH_IPC.loadBundle, url) as Promise<string>,
})
