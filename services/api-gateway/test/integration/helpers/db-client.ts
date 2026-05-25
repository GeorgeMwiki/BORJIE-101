/**
 * Per-suite postgres-js client used by test helpers to TRUNCATE + reseed
 * before each `it`. Separate from the app's own Drizzle singleton so a
 * failing test can't leave the app's connection in a bad state.
 */

import postgres from 'postgres';
import { TEST_DATABASE_URL } from './test-env';

let pool: postgres.Sql | null = null;

export function getPool(): postgres.Sql {
  if (!pool) {
    pool = postgres(TEST_DATABASE_URL, { max: 2, idle_timeout: 5 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    try {
      await pool.end({ timeout: 2 });
    } catch {
      // already closed
    }
    pool = null;
  }
}
