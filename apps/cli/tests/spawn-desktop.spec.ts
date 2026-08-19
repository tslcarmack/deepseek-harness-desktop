import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeElectronResolveFailure, ELECTRON_TSCONFIG_PATH, electronArgv, electronNodeOptions, electronSpawnEnv } from '../src/spawn-desktop.ts'

describe('electronArgv', () => {
  it('builds the electron argv with tsx and forwarded patches', () => {
    const overlay = join('D:', 'overlay.yml')
    const main = join('apps', 'desktop', 'src', 'main.ts')
    const tsx = join('node_modules', 'tsx', 'dist', 'esm', 'index.mjs')
    const argv = electronArgv({
      patches: [overlay],
      args: [],
      main,
    })
    expect(argv[0]).toBe(main)
    expect(argv).not.toContain('--import')
    expect(argv).toContain('--patch')
    expect(argv).toContain(overlay)
    expect(electronNodeOptions(tsx)).toBe(`--import=${pathToFileURL(tsx).href}`)
    expect(electronNodeOptions(tsx, '--max-old-space-size=4096'))
      .toBe(`--max-old-space-size=4096 --import=${pathToFileURL(tsx).href}`)
    const env = electronSpawnEnv(tsx, { NODE_OPTIONS: '--max-old-space-size=4096' })
    expect(env.TSX_TSCONFIG_PATH).toBe(ELECTRON_TSCONFIG_PATH)
    expect(env.TSX_TSCONFIG_PATH).toMatch(/tsconfig\.json$/)
    expect(env.NODE_OPTIONS).toBe(`--max-old-space-size=4096 --import=${pathToFileURL(tsx).href}`)
    const withArgs = electronArgv({ patches: [], args: ['--foo'], main })
    expect(withArgs).toContain('--')
    expect(withArgs.at(-1)).toBe('--foo')
  })
})

describe('describeElectronResolveFailure', () => {
  it('tells the operator to rebuild when the package is linked without a platform binary', () => {
    const cause = new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again')
    expect(describeElectronResolveFailure(cause)).toContain('path.txt')
  })

  it('tells the operator to allow the install script when the package is missing', () => {
    const cause = Object.assign(new Error("Cannot find module 'electron'"), { code: 'MODULE_NOT_FOUND' })
    expect(describeElectronResolveFailure(cause)).toContain('pnpm approve-builds')
  })
})
