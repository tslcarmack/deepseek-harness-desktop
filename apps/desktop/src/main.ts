/**
 * Electron main: this process IS the harness (`runProfile({ profile: 'desktop' })`).
 * The renderer talks IPC through preload; nothing listens on TCP.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import type { DesktopRuntimeImpl } from '@deepseek-ai/dsh-desktop-app'
import { runProfile } from '../../cli/src/profile-boot.ts'
import { parseDesktopArgv } from './argv.ts'
import { DSH_IPC, FOREIGN_WEB_CONTENTS } from './ipc.ts'

const here = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(here, '..', 'lib', 'preload.cjs')
const indexHtml = join(here, '..', 'dist', 'index.html')

function requireFile(path: string, hint: string): void {
  if (!existsSync(path)) throw new Error(`desktop: missing ${path}; ${hint}`)
}

function sendJson(contents: Electron.WebContents, channel: string, json: string): void {
  if (contents.isDestroyed()) return
  try {
    contents.send(channel, json)
  } catch {
    // The window closed between isDestroyed and send.
  }
}

async function main(): Promise<void> {
  requireFile(preloadPath, 'run `pnpm --filter @deepseek-ai/dsh-desktop build`')
  requireFile(indexHtml, 'run `pnpm --filter @deepseek-ai/dsh-desktop build`')
  const { patches, args } = parseDesktopArgv(process.argv, fileURLToPath(import.meta.url))
  await app.whenReady()
  process.stderr.write('dsh: booting desktop profile\n')
  const { ctx } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    patchFiles: patches,
    args,
  })
  const runtime = ctx.get('desktopRuntime') as DesktopRuntimeImpl | undefined
  if (runtime === undefined) throw new Error('desktop: desktopRuntime is not mounted')

  const window = new BrowserWindow({
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const fromThisWindow = (sender: Electron.WebContents): boolean => sender === window.webContents

  ipcMain.on(DSH_IPC.bootGraph, (event) => {
    if (!fromThisWindow(event.sender)) return
    event.returnValue = runtime.graph()
  })
  ipcMain.handle(DSH_IPC.invoke, async (event, request) => {
    if (!fromThisWindow(event.sender)) throw new Error(FOREIGN_WEB_CONTENTS)
    return runtime.fetchFromPreload(request)
  })
  ipcMain.handle(DSH_IPC.loadBundle, async (event, url: string) => {
    if (!fromThisWindow(event.sender)) throw new Error(FOREIGN_WEB_CONTENTS)
    return runtime.loadBundleSource(url)
  })
  runtime.subscribeMux((json) => { sendJson(window.webContents, DSH_IPC.mux, json) })
  runtime.subscribeHost((json) => { sendJson(window.webContents, DSH_IPC.host, json) })

  window.on('closed', () => {
    void ctx.fiber.dispose().finally(() => { app.quit() })
  })
  await window.loadFile(indexHtml)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`dsh: desktop main failed\n${message}\n`)
  app.exit(1)
})
