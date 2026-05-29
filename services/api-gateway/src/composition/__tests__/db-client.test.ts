/**
 * Z5 HA wire — getDbReadonly() resolver tests.
 *
 * Verifies the env-driven decision tree:
 *
 *   - DATABASE_URL_READONLY unset  → readonly aliases primary (no second pool)
 *   - DATABASE_URL_READONLY == primary → same as above
 *   - DATABASE_URL_READONLY set + different → distinct pool
 *   - DATABASE_URL unset → both accessors return null
 *
 * Mocks `@borjie/database` so we never touch a real Postgres.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is HOISTED above all const declarations, so the mock factory
// cannot close over outer `const` bindings. Use `vi.hoisted` to declare
// the spies up-front, then reference them from both the factory and the
// test bodies.
const { createDatabaseClientMock, createReadonlyDatabaseClientMock } = vi.hoisted(
  () => ({
    createDatabaseClientMock: vi.fn(),
    createReadonlyDatabaseClientMock: vi.fn(),
  }),
);

vi.mock('@borjie/database', () => ({
  createDatabaseClient: createDatabaseClientMock,
  createReadonlyDatabaseClient: createReadonlyDatabaseClientMock,
}));

// Import AFTER the mock has been registered.
import {
  getDb,
  getDbReadonly,
  __resetDbClientForTests,
} from '../db-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  __resetDbClientForTests();
  createDatabaseClientMock.mockReset();
  createReadonlyDatabaseClientMock.mockReset();
  // Default: factories return tagged sentinel objects so each call
  // produces a unique reference. Tests assert identity below.
  createDatabaseClientMock.mockImplementation((url: string) => ({
    __kind: 'primary',
    url,
  }));
  createReadonlyDatabaseClientMock.mockImplementation((url: string) => ({
    __kind: 'readonly',
    url,
  }));
  // Reset env from the snapshot.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_READONLY;
});

afterEach(() => {
  __resetDbClientForTests();
});

describe('getDb / getDbReadonly — Z5 HA wire', () => {
  it('returns null from both when DATABASE_URL is unset', () => {
    expect(getDb()).toBeNull();
    expect(getDbReadonly()).toBeNull();
    expect(createDatabaseClientMock).not.toHaveBeenCalled();
    expect(createReadonlyDatabaseClientMock).not.toHaveBeenCalled();
  });

  it('aliases readonly to the primary when DATABASE_URL_READONLY is unset', () => {
    process.env.DATABASE_URL = 'postgres://primary/db';
    const primary = getDb();
    const readonly = getDbReadonly();
    // Same client instance — no second pool opened.
    expect(readonly).toBe(primary);
    expect(createDatabaseClientMock).toHaveBeenCalledTimes(1);
    expect(createReadonlyDatabaseClientMock).not.toHaveBeenCalled();
  });

  it('aliases readonly to the primary when DATABASE_URL_READONLY equals DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://primary/db';
    process.env.DATABASE_URL_READONLY = 'postgres://primary/db';
    const primary = getDb();
    const readonly = getDbReadonly();
    expect(readonly).toBe(primary);
    expect(createReadonlyDatabaseClientMock).not.toHaveBeenCalled();
  });

  it('opens a separate pool when DATABASE_URL_READONLY differs from DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://primary/db';
    process.env.DATABASE_URL_READONLY = 'postgres://replica/db';
    const primary = getDb();
    const readonly = getDbReadonly();
    expect(readonly).not.toBe(primary);
    expect(createDatabaseClientMock).toHaveBeenCalledWith('postgres://primary/db');
    expect(createReadonlyDatabaseClientMock).toHaveBeenCalledWith(
      'postgres://replica/db',
    );
    expect((readonly as { __kind: string }).__kind).toBe('readonly');
  });

  it('memoizes the readonly client across calls', () => {
    process.env.DATABASE_URL = 'postgres://primary/db';
    process.env.DATABASE_URL_READONLY = 'postgres://replica/db';
    const first = getDbReadonly();
    const second = getDbReadonly();
    expect(first).toBe(second);
    expect(createReadonlyDatabaseClientMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the primary when the replica factory throws', () => {
    process.env.DATABASE_URL = 'postgres://primary/db';
    process.env.DATABASE_URL_READONLY = 'postgres://broken-replica/db';
    createReadonlyDatabaseClientMock.mockImplementation(() => {
      throw new Error('replica unreachable');
    });
    // R4 2026-05-29 — `db-client.ts` now routes its fallback warning
    // through the project's structured logger, which writes to
    // `process.stderr.write` (CLAUDE.md "no console.log in services" —
    // the logger IS the sink, see `utils/logger.ts:127-135`). The
    // earlier `console.warn` spy never fired. Capture stderr instead.
    const capturedStderr: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ): boolean => {
      capturedStderr.push(typeof chunk === 'string' ? chunk : String(chunk));
      return originalWrite(chunk as never, ...(rest as never[]));
    }) as typeof process.stderr.write;
    try {
      const readonly = getDbReadonly();
      const primary = getDb();
      expect(readonly).toBe(primary);
      const combined = capturedStderr.join('\n');
      expect(combined).toContain('read-replica init failed');
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
