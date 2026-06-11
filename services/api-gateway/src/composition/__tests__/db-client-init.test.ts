/**
 * initDbClient (RSS-03/04) tests.
 *
 * The composition init/wiring entry point the integration phase calls at boot.
 * Proves:
 *   1. DEFAULT (no DATABASE_POOL_MODE)  → poolMode 'session' (today's path).
 *   2. DATABASE_POOL_MODE=transaction   → poolMode 'transaction'.
 *   3. DATABASE_URL unset               → db/readonlyDb null, mode still resolves.
 *   4. The same single shared client is returned (no second pool): getDb() and
 *      the init result share one instance per process.
 *   5. getResolvedPoolMode reflects the last init.
 *
 * postgres-js connects lazily, so constructing a client against an unreachable
 * URL never opens a socket — safe in a unit test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initDbClient,
  getDb,
  getResolvedPoolMode,
  __resetDbClientForTests,
} from '../db-client';

const ENV_KEYS = ['DATABASE_URL', 'DATABASE_URL_READONLY', 'DATABASE_POOL_MODE'] as const;
const UNREACHABLE = 'postgres://u:p@127.0.0.1:65432/borjie_test';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetDbClientForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetDbClientForTests();
});

describe('initDbClient', () => {
  it('defaults to session pool mode when DATABASE_POOL_MODE is unset', () => {
    process.env.DATABASE_URL = UNREACHABLE;
    const init = initDbClient();
    expect(init.poolMode).toBe('session');
    expect(getResolvedPoolMode()).toBe('session');
  });

  it('resolves transaction pool mode when DATABASE_POOL_MODE=transaction', () => {
    process.env.DATABASE_URL = UNREACHABLE;
    process.env.DATABASE_POOL_MODE = 'transaction';
    const init = initDbClient();
    expect(init.poolMode).toBe('transaction');
    expect(getResolvedPoolMode()).toBe('transaction');
  });

  it('returns null db handles (but a resolved mode) when DATABASE_URL is unset', () => {
    const init = initDbClient();
    expect(init.db).toBeNull();
    expect(init.readonlyDb).toBeNull();
    expect(init.poolMode).toBe('session');
  });

  it('shares one client — getDb() returns the same instance the init produced', () => {
    process.env.DATABASE_URL = UNREACHABLE;
    const init = initDbClient();
    expect(init.db).not.toBeNull();
    expect(getDb()).toBe(init.db);
  });

  it('aliases readonly to the primary when no distinct replica URL is set', () => {
    process.env.DATABASE_URL = UNREACHABLE;
    const init = initDbClient();
    expect(init.readonlyDb).toBe(init.db);
  });

  it('is idempotent — a second init returns the same shared client', () => {
    process.env.DATABASE_URL = UNREACHABLE;
    const first = initDbClient();
    const second = initDbClient();
    expect(second.db).toBe(first.db);
  });
});
