/** Structural Host face the desktop glue provides so connection can bind ApiProxy without HTTP. */

/**
 * IPC carrier installed by `dsh-desktop-app`. Connection never imports Electron.
 */
export interface DesktopRuntime {
  /**
   * Install the shared `/api` fetch handler used by preload invoke.
   * @param fetch - WHATWG Request→Response function (privileged methods rewritten to loopback).
   * @returns disposer that uninstalls this handler.
   */
  setApiFetch(fetch: (request: Request) => Promise<Response>): () => void
  /**
   * Push one ServerRequest JSON document to the renderer.
   * @param stream - mux or host downlink.
   * @param json - complete `ServerRequest` JSON document.
   */
  sendFrame(stream: 'mux' | 'host', json: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** IPC fetch and downlink face when the desktop profile is mounted. */
    desktopRuntime: DesktopRuntime
  }
}
