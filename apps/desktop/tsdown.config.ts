import { defineConfig } from 'tsdown'

/** Preload must be CommonJS: Electron loads it in an isolated CJS context. */
export default defineConfig({
  entry: { preload: 'src/preload.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  external: ['electron'],
})
