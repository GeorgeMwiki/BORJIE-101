/**
 * withWorkerTenantContext — connection-pinning contract tests.
 *
 * The helper delegates to `@borjie/database`'s `withTenantContext`, which
 * opens a REAL Drizzle transaction (postgres.js `.begin()` — pins one
 * connection) and binds `app.current_tenant_id` + `app.tenant_id` +
 * `app.is_service_role` via SET LOCAL, then runs the body on the pinned `tx`.
 *
 * These unit tests assert that CONTRACT against a transaction-capable stub:
 *   1. it opens a transaction and binds BOTH tenant GUC names (transaction-
 *      local) before running the body;
 *   2. the body receives — and must use — the pinned `tx` handle;
 *   3. a body throw rejects with the original error (the driver rolls the
 *      transaction back — that part is exercised against a real Postgres in
 *      `src/__tests__/worker-tenant-context-pinning.test.ts`);
 *   4. each call opens its OWN transaction (no cross-tenant carryover);
 *   5. an empty tenantId is rejected before any DB work.
 *
 * NOTE: the previous implementation issued raw `BEGIN`/`SET LOCAL`/`COMMIT`
 * as separate `execute()` calls, which did NOT pin on a pooled client; those
 * SQL-sequence assertions were removed with that broken implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import { withWorkerTenantContext } from '../with-tenant-context.js';

interface CapturedCall {
  readonly sql: string;
}

function sqlTextOf(q: unknown): string {
  const sqlObj = q as {
    strings?: ReadonlyArray<string>;
    queryChunks?: ReadonlyArray<{ value?: string }>;
  };
  return (
    sqlObj?.strings?.join(' ') ??
    sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
    ''
  );
}

/**
 * Transaction-capable stub. `withTenantContext` calls `db.transaction(fn)`;
 * our stub runs `fn` against a single `tx` whose `execute` records every
 * statement — so we can assert the SET LOCAL binds + the body's calls all
 * land on the SAME pinned handle. The real driver auto-ROLLBACKs + rethrows
 * on a callback throw; the stub just rethrows (rollback is the driver's job).
 */
function makeTxStubDb(opts?: { failAt?: (text: string) => boolean }) {
  const calls: CapturedCall[] = [];
  const txExecute = vi.fn(async (q: unknown) => {
    const text = sqlTextOf(q);
    calls.push({ sql: text });
    if (opts?.failAt?.(text)) {
      throw new Error('connection terminated unexpectedly');
    }
    return { rows: [] };
  });
  const tx = { execute: txExecute };
  const transaction = vi.fn(
    async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  );
  return { calls, tx, transaction, execute: txExecute };
}

describe('withWorkerTenantContext', () => {
  it('opens a transaction, binds both GUCs (SET LOCAL), runs the body on the pinned tx', async () => {
    const db = makeTxStubDb();
    const body = vi.fn(async (tx: { execute: (q: unknown) => Promise<unknown> }) => {
      await tx.execute({ strings: ['SELECT 1 FROM widgets'] });
      return 'ok';
    });

    const result = await withWorkerTenantContext(db, 't_happy', body);

    expect(result).toBe('ok');
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(body).toHaveBeenCalledOnce();
    // body received the SAME handle the GUCs were bound on.
    expect(body.mock.calls[0]![0]).toBe(db.tx);

    const setConfig = db.calls.filter((c) => c.sql.includes('set_config'));
    expect(setConfig.length).toBeGreaterThanOrEqual(2);
    expect(db.calls.some((c) => c.sql.includes('app.current_tenant_id'))).toBe(true);
    expect(db.calls.some((c) => c.sql.includes('app.tenant_id'))).toBe(true);
    // The GUC binds happen BEFORE the body's own query.
    const firstBodyIdx = db.calls.findIndex((c) => c.sql.includes('widgets'));
    const lastBindIdx = db.calls.reduce(
      (acc, c, i) => (c.sql.includes('set_config') ? i : acc),
      -1,
    );
    expect(lastBindIdx).toBeGreaterThanOrEqual(0);
    expect(lastBindIdx).toBeLessThan(firstBodyIdx);
  });

  it('rejects with the original error when the body throws (driver rolls back)', async () => {
    const db = makeTxStubDb();
    const original = new Error('body failed mid-tick');
    await expect(
      withWorkerTenantContext(db, 't_throw', async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('rejects when the GUC bind itself throws (connection reaped before body)', async () => {
    const db = makeTxStubDb({ failAt: (text) => text.includes('set_config') });
    const body = vi.fn(async () => 'never reached');
    await expect(
      withWorkerTenantContext(db, 't_reap', body),
    ).rejects.toThrow('connection terminated unexpectedly');
    expect(body).not.toHaveBeenCalled();
  });

  it('opens a fresh transaction per call — sequential tenants cannot leak', async () => {
    const db = makeTxStubDb();
    await withWorkerTenantContext(db, 't_alpha', async () => undefined);
    await withWorkerTenantContext(db, 't_beta', async () => undefined);

    // One transaction per call; each binds its own GUCs inside it.
    expect(db.transaction).toHaveBeenCalledTimes(2);
    const setConfigCalls = db.calls.filter((c) => c.sql.includes('set_config'));
    // ≥2 binds per call (current_tenant_id + tenant_id [+ is_service_role]).
    expect(setConfigCalls.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects empty tenantId as a programmer error — before any DB work', async () => {
    const db = makeTxStubDb();
    await expect(
      withWorkerTenantContext(db, '', async () => undefined),
    ).rejects.toThrow('tenantId must be non-empty');
    await expect(
      withWorkerTenantContext(db, '   ', async () => undefined),
    ).rejects.toThrow('tenantId must be non-empty');
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });
});
