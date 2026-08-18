import { basename } from 'node:path'

/**
 * Parse Electron/tsx argv after the main script for `--patch` overlays and app args.
 * @param argv - `process.argv`.
 * @param scriptPath - this file's `import.meta.url` filesystem path.
 * @returns overlay paths and the remaining app arguments after `--` or unrecognized tokens.
 */
export function parseDesktopArgv(
  argv: readonly string[],
  scriptPath: string,
): { patches: string[]; args: string[] } {
  const from = argv.findIndex(part => part === scriptPath || isMainScript(part))
  const rest = from === -1 ? argv.slice(2) : argv.slice(from + 1)
  const patches: string[] = []
  const args: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (token === '--patch') {
      const next = rest[++i]
      if (next === undefined) throw new Error('dsh: --patch requires a path')
      patches.push(next)
      continue
    }
    if (token === '--') {
      args.push(...rest.slice(i + 1))
      break
    }
    if (token !== undefined) args.push(token)
  }
  return { patches, args }
}

function isMainScript(part: string): boolean {
  const name = basename(part)
  return name === 'main.ts' || name === 'main.js'
}
