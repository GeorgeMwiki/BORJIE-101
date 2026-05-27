import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Match the `@/*` -> `./src/*` mapping declared in tsconfig.json
      // so vitest can resolve the same paths the Expo / Metro bundler
      // resolves at runtime.
      '@': path.resolve(__dirname, 'src')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true
  }
})
