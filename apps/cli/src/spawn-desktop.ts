/**
 * Spawn Electron for a live `desktop` profile boot. Config dumps stay in Node.
 * @module @deepseek-ai/dsh/spawn-desktop
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Overlay paths and leftover app arguments forwarded to Electron main. */
export interface ElectronArgvOptions {
  patches: readonly string[]
  args: readonly string[]
  main: string
  tsx: string
}

const DESKTOP_ROOT = fileURLToPath(new URL('../../desktop/', import.meta.url))
const ELECTRON_MISSING = 'dsh: electron is not installed; from the repository root run `pnpm approve-builds` to allow electron, then `pnpm install`'

/**
 * Build Electron argv: tsx ESM hook, desktop main, absolute `--patch` paths, then app args.
 * @param options - main path, tsx ESM specifier, overlays, and leftover args.
 * @returns argv after the Electron binary.
 */
export function electronArgv(options: ElectronArgvOptions): string[] {
  const argv = ['--import', options.tsx, options.main]
  for (const patch of options.patches) {
    argv.push('--patch', patch)
  }
  if (options.args.length > 0) argv.push('--', ...options.args)
  return argv
}

function resolveElectron(): string {
  const require = createRequire(join(DESKTOP_ROOT, 'package.json'))
  try {
    const binary = require('electron') as unknown
    if (typeof binary === 'string' && binary !== '') return binary
  } catch {
    // Fall through to the labelled install hint.
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
  const argv = electronArgv({ patches, args: invocation.args, main, tsx })
  const child = spawn(electronBinary, argv, { stdio: 'inherit', windowsHide: false })
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.on('error', reject)
    child.on('exit', (exitCode, signal) => {
      if (signal !== null) reject(new Error(`dsh: electron exited from signal ${signal}`))
      else resolveExit(exitCode)
    })
  })
  process.exit(code ?? 1)
}
