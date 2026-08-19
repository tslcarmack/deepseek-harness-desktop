import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('dsh-desktop-app composition', () => {
  it('dump of the desktop bundle has no webserver and includes desktop-runtime', () => {
    const text = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(text).not.toMatch(/id: webserver/)
    expect(text).toMatch(/id: desktop-runtime/)
    expect(text).toMatch(/id: modules/)
    expect(text).toMatch(/id: connection/)
    expect(text).not.toMatch(/webRuntime/)
    expect(text).not.toMatch(/directory-picker-auto/)
    expect(text).toMatch(/dsh-host-directory-picker-native/)
    expect(text).toMatch(/dsh-client-ui-directory-picker-native/)
    expect(text).toMatch(/id: client-hmr/)
  })

  it('declares an immediately client half', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { immediately?: boolean; platform?: string } }
      exports?: Record<string, unknown>
    }
    expect(pkg.dsh?.client?.immediately).toBe(true)
    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(pkg.exports?.['./client']).toBeDefined()
  })
})
