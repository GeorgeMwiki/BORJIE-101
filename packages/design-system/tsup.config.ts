import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    compilerOptions: {
      skipLibCheck: true,
      verbatimModuleSyntax: false,
      exactOptionalPropertyTypes: false,
      lib: ['ES2022', 'DOM'],
      // Limit included types to avoid hapi/opentelemetry types from monorepo
      types: ['react', 'react-dom', 'node'],
    },
  },
  clean: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
  external: ['react', 'react-dom'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  // Mark the final bundle as a client module so Next.js resolves dependencies
  // (notably `react-hook-form`) through their normal ESM entrypoint rather
  // than the `react-server` condition — the server entry omits form hooks
  // like `useFormContext`/`useForm`/`FormProvider`, which our ZodForm and
  // FormField rely on. The DS is 100% interactive UI (Cards, Dialogs,
  // Dropdowns, Forms), so client-only is the correct boundary.
  onSuccess: async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    for (const file of ['dist/index.mjs', 'dist/index.js']) {
      const src = readFileSync(file, 'utf8');
      if (!src.startsWith('"use client"')) {
        writeFileSync(file, `"use client";\n${src}`);
      }
    }
  },
});
