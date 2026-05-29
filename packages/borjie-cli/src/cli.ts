#!/usr/bin/env node
/**
 * `borjie` — bin entry. Wraps the commander program with a thin
 * top-level catch so unexpected errors print a tidy stderr line +
 * non-zero exit, instead of an unhandled-promise stack trace.
 */

import { buildProgram } from './cli-program.js';

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
});
