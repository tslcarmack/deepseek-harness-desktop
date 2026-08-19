/**
 * Spawn Electron for a live `desktop` profile boot. Config dumps stay in Node.
 * @module @deepseek-ai/dsh/spawn-desktop
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Overlay paths and leftover app arguments forwarded to Electron main.
 * The tsx loader is passed through NODE_OPTIONS: Electron argv `--import` is
 * Chromium's bookmark-import switch, not Node's ESM loader.
 */
export interface ElectronArgvOptions {
  patches: readonly string[]
  args: readonly string[]
  main: string
}

const DESKTOP_ROOT = fileURLToPath(new URL('../../desktop/', import.meta.url))
const ELECTRON_MISSING = 'dsh: electron is not installed; from the repository root run `pnpm approve-builds` to allow electron, then `pnpm install`'
const ELECTRON_BINARY_MISSING = 'dsh: electron is linked but its platform binary is missing; from the repository root run `pnpm --filter @deepseek-ai/dsh-desktop rebuild` and wait until apps/desktop/node_modules/electron/path.txt exists'

/**
 * Map `require('electron')` failure to an operator-facing recovery hint.
 * @param cause - the thrown value from the CommonJS require.
 * @returns labelled recovery text; never empty.
 */
export function describeElectronResolveFailure(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined
  if (code === 'MODULE_NOT_FOUND') return ELECTRON_MISSING
  const message = cause instanceof Error ? cause.message : String(cause)
  if (message.includes('failed to install correctly')) return ELECTRON_BINARY_MISSING
  return `dsh: cannot resolve the electron binary: ${message}`
}

/**
 * Build Electron argv: desktop main, absolute `--patch` paths, then app args.
 * @param options - main path, overlays, and leftover args.
 * @returns argv after the Electron binary.
 */
export function electronArgv(options: ElectronArgvOptions): string[] {
  const argv = [options.main]
  for (const patch of options.patches) {
    argv.push('--patch', patch)
  }
  if (options.args.length > 0) argv.push('--', ...options.args)
  return argv
}

/**
 * Put the tsx ESM loader on NODE_OPTIONS so Electron's Node process loads TypeScript.
 * @param tsx - path to `tsx/esm` (absolute from `require.resolve`).
 * @param existing - the current `NODE_OPTIONS` value, if any.
 * @returns NODE_OPTIONS including `--import=<file-url>`.
 */
export function electronNodeOptions(tsx: string, existing?: string): string {
  const flag = `--import=${pathToFileURL(tsx).href}`
  if (existing === undefined || existing === '') return flag
  return `${existing} ${flag}`
}

/** Repo-root tsconfig: Electron's cwd is not the CLI's, so tsx must not discover tsconfig by walking up. */
export const ELECTRON_TSCONFIG_PATH = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * Environment for the Electron main process: tsx ESM loader plus the repo paths map.
 * @param tsx - path to `tsx/esm`.
 * @param existing - the parent process environment.
 * @returns env for `spawn(electron, argv, { env })`.
 */
export function electronSpawnEnv(tsx: string, existing: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...existing,
    NODE_OPTIONS: electronNodeOptions(tsx, existing.NODE_OPTIONS),
    TSX_TSCONFIG_PATH: ELECTRON_TSCONFIG_PATH,
  }
}

function resolveElectron(): string {
  const require = createRequire(join(DESKTOP_ROOT, 'package.json'))
  try {
    const binary = require('electron') as unknown
    if (typeof binary === 'string' && binary !== '') return binary
  } catch (cause) {
    throw new Error(describeElectronResolveFailure(cause))
  }
  throw new Error(ELECTRON_MISSING)
}

function resolveTsx(): string {
  const require = createRequire(join(DESKTOP_ROOT, 'package.json'))
  try {
    return require.resolve('tsx/esm')
  } catch {
    throw new Error('dsh: tsx is not installed for the desktop source launch')
  }
}

/**
 * Spawn the desktop Electron binary and exit with its status. Does not boot the harness in this process.
 * @param invocation - live profile boot (`mode: 'profile'`, `profile: 'desktop'`).
 * @returns never; this process exits with Electron's status.
 */
export async function spawnDesktop(invocation: {
  patches: readonly string[]
  args: readonly string[]
}): Promise<void> {
  const electronBinary = resolveElectron()
  const tsx = resolveTsx()
  const main = join(DESKTOP_ROOT, 'src', 'main.ts')
  const patches = invocation.patches.map(path => resolve(process.cwd(), path))
  const argv = electronArgv({ patches, args: invocation.args, main })
  process.stderr.write('dsh: launching Electron; the window opens after the desktop profile boots\n')
  const child = spawn(electronBinary, argv, {
    stdio: 'inherit',
    windowsHide: false,
    env: electronSpawnEnv(tsx),
  })
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.on('error', reject)
    child.on('exit', (exitCode, signal) => {
      if (signal !== null) reject(new Error(`dsh: electron exited from signal ${signal}`))
      else resolveExit(exitCode)
    })
  })
  process.exit(code ?? 1)
}
