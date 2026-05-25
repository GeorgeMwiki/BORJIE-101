import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/capability-card/index.ts',
    'src/refusal-grammar/index.ts',
    'src/plan-view/index.ts',
    'src/decision-provenance/index.ts',
    'src/automation-suggester/index.ts'
  ],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true
})
