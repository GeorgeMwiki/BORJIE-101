import { defineConfig } from 'vitest/config';

/**
 * tsup parity stub.
 *
 * The package currently builds via `tsc` (matches the rest of the
 * monorepo's TypeScript-only packages). This file is kept for parity
 * with the spec and as a reference point for future ESM + CJS dual
 * bundling if/when the runtime targets diverge.
 */
export default defineConfig({});
