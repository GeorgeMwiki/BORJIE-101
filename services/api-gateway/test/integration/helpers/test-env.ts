/**
 * Test environment bootstrap.
 *
 * MUST be imported before any code that reads `process.env.DATABASE_URL`
 * or `process.env.JWT_SECRET` at module-load time (composition/db-client,
 * middleware/database, config/jwt). Vitest's `setupFiles` guarantees this
 * runs first.
 *
 * The DB name is stable (`borjie_test`) — the per-suite isolation is
 * handled by `resetDatabase()` which truncates user tables between tests.
 * Using a fixed name avoids having multiple throwaway databases pile up
 * when tests crash.
 */

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'borjie_test';
const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
const TEST_DB_PORT = process.env.TEST_DB_PORT || '5432';
const TEST_DB_USER = process.env.TEST_DB_USER || process.env.USER || 'postgres';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';

export const TEST_DATABASE_URL = (() => {
  const auth = TEST_DB_PASSWORD
    ? `${TEST_DB_USER}:${TEST_DB_PASSWORD}@`
    : `${TEST_DB_USER}@`;
  return `postgres://${auth}${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}`;
})();

export const ADMIN_DATABASE_URL = (() => {
  const auth = TEST_DB_PASSWORD
    ? `${TEST_DB_USER}:${TEST_DB_PASSWORD}@`
    : `${TEST_DB_USER}@`;
  return `postgres://${auth}${TEST_DB_HOST}:${TEST_DB_PORT}/postgres`;
})();

// Pin env BEFORE any downstream imports read them. Vitest loads this
// file via `setupFiles` so this assignment lands on the real
// process.env before the gateway's own modules evaluate.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_DATA = 'false';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'integration-test-secret-at-least-32-characters-long-pad';
process.env.OUTBOX_WORKER_DISABLED = 'true';
process.env.ALLOWED_ORIGINS = 'http://localhost';
// assertApiKeyConfig is a no-op when NODE_ENV !== 'production', so no
// shim needed here.

export const TEST_DB_NAME_EXPORT = TEST_DB_NAME;
