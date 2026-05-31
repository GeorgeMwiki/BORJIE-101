/**
 * mwikila-autonomous-wiring — unit tests for Wave AUTONOMY-CRON-WIRE.
 *
 * Covers:
 *   - degraded mode (no DB) returns an inert stub
 *   - test-env / env-disabled returns an inert stub
 *   - active-tenants JOIN query targets tenants + users(is_owner)
 *   - JOIN returns [] on DB error
 *   - interval bounds are enforced ([60s, 60m])
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __testing,
  createMwikilaAutonomousWiring,
} from '../mwikila-autonomous-wiring.js';

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Parameters<typeof createMwikilaAutonomousWiring>[0]['logger'];

const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_DISABLE = process.env.BORJIE_MWIKILA_WORKER_DISABLED;
const ORIG_LEGACY_DISABLE = process.env.MWIKILA_WORKER_DISABLED;
const ORIG_INTERVAL = process.env.BORJIE_MWIKILA_WORKER_INTERVAL_MS;

beforeEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.BORJIE_MWIKILA_WORKER_DISABLED;
  delete process.env.MWIKILA_WORKER_DISABLED;
  delete process.env.BORJIE_MWIKILA_WORKER_INTERVAL_MS;
});

afterEach(() => {
  if (ORIG_NODE_ENV !== undefined) process.env.NODE_ENV = ORIG_NODE_ENV;
  if (ORIG_DISABLE !== undefined)
    process.env.BORJIE_MWIKILA_WORKER_DISABLED = ORIG_DISABLE;
  if (ORIG_LEGACY_DISABLE !== undefined)
    process.env.MWIKILA_WORKER_DISABLED = ORIG_LEGACY_DISABLE;
  if (ORIG_INTERVAL !== undefined)
    process.env.BORJIE_MWIKILA_WORKER_INTERVAL_MS = ORIG_INTERVAL;
});

describe('createMwikilaAutonomousWiring', () => {
  it('returns inert stub when db is null (degraded mode)', async () => {
    const worker = createMwikilaAutonomousWiring({
      db: null,
      logger: stubLogger,
    });
    // start + stop are no-ops
    worker.start();
    worker.stop();
    const stats = await worker.tickOnce();
    expect(stats).toEqual({
      tenantsScanned: 0,
      handlersInvoked: 0,
      inboxRowsWritten: 0,
    });
  });

  it('returns inert stub when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    const db = { execute: vi.fn() };
    const worker = createMwikilaAutonomousWiring({ db, logger: stubLogger });
    await worker.tickOnce();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns inert stub when BORJIE_MWIKILA_WORKER_DISABLED=true', async () => {
    process.env.BORJIE_MWIKILA_WORKER_DISABLED = 'true';
    const db = { execute: vi.fn() };
    const worker = createMwikilaAutonomousWiring({ db, logger: stubLogger });
    await worker.tickOnce();
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('__testing.listActiveTenantsWithOwner', () => {
  it('returns one row per tenant with owner_user_id', async () => {
    const db = {
      execute: vi.fn(async () => ({
        rows: [
          { tenant_id: 't1', owner_user_id: 'u1' },
          { tenant_id: 't2', owner_user_id: 'u2' },
        ],
      })),
    };
    const result = await __testing.listActiveTenantsWithOwner(db, stubLogger);
    expect(result).toEqual([
      { tenantId: 't1', ownerUserId: 'u1' },
      { tenantId: 't2', ownerUserId: 'u2' },
    ]);
  });

  it('drops rows where tenant_id or owner_user_id is missing', async () => {
    const db = {
      execute: vi.fn(async () => ({
        rows: [
          { tenant_id: 't1', owner_user_id: 'u1' },
          { tenant_id: null, owner_user_id: 'orphan' },
          { tenant_id: 't3', owner_user_id: null },
        ],
      })),
    };
    const result = await __testing.listActiveTenantsWithOwner(db, stubLogger);
    expect(result).toEqual([{ tenantId: 't1', ownerUserId: 'u1' }]);
  });

  it('degrades to [] on DB error', async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    };
    const result = await __testing.listActiveTenantsWithOwner(db, stubLogger);
    expect(result).toEqual([]);
  });

  it('targets the tenants × users join in the SQL', async () => {
    const captured: string[] = [];
    const db = {
      execute: vi.fn(async (q: unknown) => {
        const sqlObj = q as {
          strings?: ReadonlyArray<string>;
          queryChunks?: ReadonlyArray<{ value?: string }>;
        };
        const text =
          sqlObj?.strings?.join(' ') ??
          sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
          '';
        captured.push(text);
        return { rows: [] };
      }),
    };
    await __testing.listActiveTenantsWithOwner(db, stubLogger);
    const text = captured.join('\n');
    expect(text).toMatch(/FROM tenants/);
    expect(text).toMatch(/JOIN users/);
    expect(text).toMatch(/is_owner/);
  });
});

describe('__testing.resolveIntervalMs', () => {
  it('uses default when no override + no env', () => {
    expect(__testing.resolveIntervalMs()).toBe(15 * 60 * 1000);
  });

  it('clamps overrides to the 60s floor', () => {
    expect(__testing.resolveIntervalMs(100)).toBe(60_000);
  });

  it('clamps overrides to the 60m ceiling', () => {
    expect(__testing.resolveIntervalMs(99 * 60 * 60 * 1000)).toBe(
      60 * 60 * 1000,
    );
  });

  it('honours the env override', () => {
    process.env.BORJIE_MWIKILA_WORKER_INTERVAL_MS = String(5 * 60 * 1000);
    expect(__testing.resolveIntervalMs()).toBe(5 * 60 * 1000);
  });

  it('explicit override beats env', () => {
    process.env.BORJIE_MWIKILA_WORKER_INTERVAL_MS = '999999';
    expect(__testing.resolveIntervalMs(2 * 60 * 1000)).toBe(2 * 60 * 1000);
  });
});
