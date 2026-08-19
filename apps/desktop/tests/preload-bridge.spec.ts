import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDesktopArgv } from '../src/argv.ts'
import { attachJsonListener, DSH_IPC, FOREIGN_WEB_CONTENTS } from '../src/ipc.ts'

describe('desktop preload bridge (no Electron)', () => {
  it('parses --patch overlays after the main script and forwards leftover args', () => {
    const overlay = join('D:', 'overlay.yml')
    const parsed = parseDesktopArgv(
      ['electron', '--import', 'tsx/esm', join('apps', 'desktop', 'src', 'main.ts'), '--patch', overlay, '--', 'rest'],
      join('apps', 'desktop', 'src', 'main.ts'),
    )
    expect(parsed.patches).toEqual([overlay])
    expect(parsed.args).toEqual(['rest'])
  })

  it('fails loud when --patch has no path', () => {
    expect(() => parseDesktopArgv(['electron', 'main.ts', '--patch'], 'main.ts'))
      .toThrow(/--patch requires a path/)
  })

  it('exposes the preload channel names and foreign-sender diagnostic', () => {
    expect(DSH_IPC.bootGraph).toBe('dsh:boot-graph')
    expect(DSH_IPC.invoke).toBe('dsh:invoke')
    expect(DSH_IPC.mux).toBe('dsh:mux')
    expect(DSH_IPC.host).toBe('dsh:host')
    expect(DSH_IPC.loadBundle).toBe('dsh:load-bundle')
    expect(FOREIGN_WEB_CONTENTS).toBe('desktop: foreign webContents')
  })

  it('fans ipcRenderer-style JSON frames to a listener and unsubscribes', () => {
    const handlers = new Map<string, (event: unknown, json: string) => void>()
    const received: string[] = []
    const stop = attachJsonListener(
      (channel, handler) => { handlers.set(channel, handler) },
      (channel) => { handlers.delete(channel) },
      DSH_IPC.mux,
      (json) => { received.push(json) },
    )
    handlers.get(DSH_IPC.mux)!({}, '{"ok":true}')
    stop()
    handlers.get(DSH_IPC.mux)?.({}, '{"no":true}')
    expect(received).toEqual(['{"ok":true}'])
  })
})
