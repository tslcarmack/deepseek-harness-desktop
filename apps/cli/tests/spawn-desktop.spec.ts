import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { electronArgv } from '../src/spawn-desktop.ts'

describe('electronArgv', () => {
  it('builds the electron argv with tsx and forwarded patches', () => {
    const overlay = join('D:', 'overlay.yml')
    const main = join('apps', 'desktop', 'src', 'main.ts')
    const tsx = join('node_modules', 'tsx', 'dist', 'esm', 'index.mjs')
    const argv = electronArgv({
      patches: [overlay],
      args: [],
      main,
      tsx,
    })
    expect(argv).toContain('--import')
    expect(argv.some(part => part.includes('main.ts'))).toBe(true)
    expect(argv).toContain('--patch')
    expect(argv).toContain(overlay)
    const importAt = argv.indexOf('--import')
    expect(argv[importAt + 1]).toBe(tsx)
    expect(argv[importAt + 2]).toBe(main)
    const withArgs = electronArgv({ patches: [], args: ['--foo'], main, tsx })
    expect(withArgs).toContain('--')
    expect(withArgs.at(-1)).toBe('--foo')
  })
})
