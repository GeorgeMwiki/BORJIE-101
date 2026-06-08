/**
 * Pool-mode option test (RSS-03/RSS-04).
 *
 * Proves the env-flag contract on `readPoolOptions` / `readReadonlyPoolOptions`
 * / `readPoolMode`:
 *
 *   1. DEFAULT (no env)            — 'session' mode; the options object is
 *                                    BYTE-FOR-BYTE today's behaviour: it carries
 *                                    NO `prepare` and NO `fetch_types` key at
 *                                    all, so postgres-js keeps prepared
 *                                    statements ON exactly as before this lane.
 *   2. DATABASE_POOL_MODE=transaction — adds `prepare:false`,`fetch_types:false`
 *                                    (transaction-pooler-safe), unless
 *                                    DATABASE_PREPARE=true re-enables them.
 *   3. The shared-pool memo returns the SAME client instance per conn string.
 *
 * Pure option assertions — no Postgres needed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readPoolMode,
  readPoolOptions,
  readReadonlyPoolOptions,
  getSharedDatabaseClient,
  __resetSharedDatabaseClientsForTests,
} from '../client.js';

const POOL_ENV_KEYS = [
  'DATABASE_POOL_MODE',
  'DATABASE_PREPARE',
  'DATABASE_POOL_MAX',
  'DATABASE_READONLY_POOL_MAX',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of POOL_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetSharedDatabaseClientsForTests();
});

afterEach(() => {
  for (const k of POOL_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetSharedDatabaseClientsForTests();
});

describe('readPoolMode', () => {
  it('defaults to session when DATABASE_POOL_MODE is unset', () => {
    expect(readPoolMode()).toBe('session');
  });

  it('returns session for any value other than the literal "transaction"', () => {
    process.env.DATABASE_POOL_MODE = 'pooled'; // typo / unknown
    expect(readPoolMode()).toBe('session');
    process.env.DATABASE_POOL_MODE = 'SESSION';
    expect(readPoolMode()).toBe('session');
  });

  it('returns transaction only for the exact literal "transaction"', () => {
    process.env.DATABASE_POOL_MODE = 'transaction';
    expect(readPoolMode()).toBe('transaction');
  });
});

describe('readPoolOptions — session mode (default) is byte-for-byte current behaviour', () => {
  it('emits NO prepare and NO fetch_types key when mode is session', () => {
    const opts = readPoolOptions() as Record<string, unknown>;
    expect('prepare' in opts).toBe(false);
    expect('fetch_types' in opts).toBe(false);
  });

  it('keeps the exact pre-lane shape (max/idle/lifetime/connect/connection)', () => {
    const opts = readPoolOptions() as Record<string, unknown>;
    expect(opts.max).toBe(20);
    expect(opts.idle_timeout).toBe(30);
    expect(opts.max_lifetime).toBe(30 * 60);
    expect(opts.connect_timeout).toBe(10);
    expect(opts.connection).toEqual({
      statement_timeout: 30_000,
      lock_timeout: 5_000,
    });
    // Exhaustively: the ONLY keys are the historical ones.
    expect(Object.keys(opts).sort()).toEqual(
      [
        'connect_timeout',
        'connection',
        'idle_timeout',
        'max',
        'max_lifetime',
      ].sort(),
    );
  });
});

describe('readPoolOptions — transaction mode', () => {
  it('adds prepare:false + fetch_types:false by default', () => {
    process.env.DATABASE_POOL_MODE = 'transaction';
    const opts = readPoolOptions() as Record<string, unknown>;
    expect(opts.prepare).toBe(false);
    expect(opts.fetch_types).toBe(false);
  });

  it('re-enables prepared statements when DATABASE_PREPARE=true', () => {
    process.env.DATABASE_POOL_MODE = 'transaction';
    process.env.DATABASE_PREPARE = 'true';
    const opts = readPoolOptions() as Record<string, unknown>;
    expect(opts.prepare).toBe(true);
    expect(opts.fetch_types).toBe(true);
  });
});

describe('readReadonlyPoolOptions inherits the same transaction toggles', () => {
  it('no prepare key in session mode', () => {
    const opts = readReadonlyPoolOptions() as Record<string, unknown>;
    expect('prepare' in opts).toBe(false);
  });

  it('prepare:false in transaction mode', () => {
    process.env.DATABASE_POOL_MODE = 'transaction';
    const opts = readReadonlyPoolOptions() as Record<string, unknown>;
    expect(opts.prepare).toBe(false);
    expect(opts.fetch_types).toBe(false);
  });
});

describe('getSharedDatabaseClient — single bounded pool of record', () => {
  // postgres-js opens connections lazily, so constructing a client against an
  // unreachable URL does NOT connect — it is safe in a unit test.
  const URL_A = 'postgres://u:p@127.0.0.1:65432/a';
  const URL_B = 'postgres://u:p@127.0.0.1:65432/b';

  it('returns the SAME instance for the same connection string', () => {
    const c1 = getSharedDatabaseClient(URL_A);
    const c2 = getSharedDatabaseClient(URL_A);
    expect(c1).toBe(c2);
  });

  it('returns DISTINCT instances for distinct connection strings', () => {
    const a = getSharedDatabaseClient(URL_A);
    const b = getSharedDatabaseClient(URL_B);
    expect(a).not.toBe(b);
  });

  it('reset clears the memo so a fresh pool is built next time', () => {
    const first = getSharedDatabaseClient(URL_A);
    __resetSharedDatabaseClientsForTests();
    const second = getSharedDatabaseClient(URL_A);
    expect(first).not.toBe(second);
  });
});
