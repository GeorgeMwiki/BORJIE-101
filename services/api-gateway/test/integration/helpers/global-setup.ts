/**
 * Vitest globalSetup — creates the test database + runs migrations ONCE
 * per `vitest run`. Per-test cleanup uses `resetDatabase()` which
 * truncates mutable tables in milliseconds.
 *
 * globalTeardown drops the DB so the next CI run starts fresh. Local
 * dev can skip teardown via `KEEP_TEST_DB=1` for faster re-runs.
 */

import './test-env';
import { setupTestDb, cleanupTestDb } from './db';
import type postgres from 'postgres';

let sharedSql: postgres.Sql | null = null;

export async function setup(): Promise<void> {
  sharedSql = await setupTestDb();
  // We don't need to keep the connection open across suites — each
  // test file opens its own pool via `helpers/db-client`. Close it.
  try {
    await sharedSql.end({ timeout: 2 });
  } catch {
    // no-op
  }
  sharedSql = null;
}

export async function teardown(): Promise<void> {
  if (process.env.KEEP_TEST_DB === '1') {
    // Developers running single tests often want to inspect state.
    return;
  }
  await cleanupTestDb();
}
