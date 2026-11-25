import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', browser: 'src/browser.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2020',
  // tsup reads tsconfig.json, which also covers tests and examples; the build needs only src.
  tsconfig: 'tsconfig.build.json',
})
