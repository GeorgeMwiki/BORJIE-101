import { defineConfig } from 'vitest/config';

/**
 * tsup parity stub.
 *
 * The package builds via `tsc` (matches the rest of the BORJIE
 * monorepo's TypeScript-only packages). This file is kept for parity
 * with the Phase 2 spec and as a hook point if/when ESM + CJS dual
 * bundling becomes needed (e.g. when this package starts shipping
 * brand-locked Carbone templates to non-TS consumers).
 */
export default defineConfig({});
