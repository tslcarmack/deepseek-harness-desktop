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
  })
})
