/**
 * withWorkerTenantContext — G8 robustness-audit closure tests.
 *
 * Verifies the helper:
 *   1. Wraps the body in BEGIN / SET LOCAL / <body> / COMMIT.
 *   2. Binds BOTH the canonical `app.current_tenant_id` and legacy
 *      `app.tenant_id` GUC names.
 *   3. ROLLBACKs on body throw and re-raises the original error.
 *   4. ROLLBACKs even when the body's first DB call fails (simulates
 *      Supabase connection reap mid-tick).
 *   5. Rejects an empty tenantId as a programmer error.
 *
 * The DB is stubbed — we capture every execute() call and assert on
 * the SQL text + ordering.
 */

import { describe, it, expect, vi } from 'vitest';
import { withWorkerTenantContext } from '../with-tenant-context.js';

interface CapturedCall {
  readonly sql: string;
}

function makeStubDb(opts?: { failAt?: (text: string) => boolean }) {
  const calls: CapturedCall[] = [];
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const sqlObj = q as {
        strings?: ReadonlyArray<string>;
        queryChunks?: ReadonlyArray<{ value?: string }>;
      };
      const text =
        sqlObj?.strings?.join(' ') ??
        sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
        '';
      calls.push({ sql: text });
      if (opts?.failAt && opts.failAt(text)) {
        throw new Error('connection terminated unexpectedly');
      }
      return { rows: [] };
    }),
  };
}

describe('withWorkerTenantContext', () => {
  it('wraps the body in BEGIN; SET LOCAL <both GUCs>; <body>; COMMIT', async () => {
    const db = makeStubDb();
    const body = vi.fn(async () => 'ok');

    const result = await withWorkerTenantContext(db, 't_happy', body);

    expect(result).toBe('ok');
    expect(body).toHaveBeenCalledOnce();

    // Order: BEGIN -> set_config -> COMMIT (body has no DB calls
    // here, but the wrapper's own SQL is enough to verify the shape).
    expect(/^\s*BEGIN/.test(db.calls[0]!.sql)).toBe(true);
    expect(db.calls[1]!.sql).toContain('set_config');
    expect(db.calls[1]!.sql).toContain('app.current_tenant_id');
    expect(db.calls[1]!.sql).toContain('app.tenant_id');
    expect(/^\s*COMMIT/.test(db.calls[db.calls.length - 1]!.sql)).toBe(true);
  });

  it('emits ROLLBACK and re-raises when the body throws', async () => {
    const db = makeStubDb();
    const original = new Error('body failed mid-tick');
    await expect(
      withWorkerTenantContext(db, 't_throw', async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    const rollbackIdx = db.calls.findIndex((c) => /^\s*ROLLBACK/.test(c.sql));
    const commitIdx = db.calls.findIndex((c) => /^\s*COMMIT/.test(c.sql));
    expect(rollbackIdx).toBeGreaterThanOrEqual(0);
    // No COMMIT must have fired — the txn is rolled back, not committed.
    expect(commitIdx).toBe(-1);
  });

  it('emits ROLLBACK when set_config itself throws (connection reaped before body)', async () => {
    // Worst-case scenario: Supabase reaps the conn after BEGIN but
    // before set_config returns. The helper must still emit ROLLBACK
    // so no half-bound GUC leaks if the conn ever returns to a pool.
    const db = makeStubDb({
      failAt: (text) => text.includes('set_config'),
    });
    await expect(
      withWorkerTenantContext(db, 't_reap', async () => 'never reached'),
    ).rejects.toThrow('connection terminated unexpectedly');
    const rollbackIdx = db.calls.findIndex((c) => /^\s*ROLLBACK/.test(c.sql));
    expect(rollbackIdx).toBeGreaterThanOrEqual(0);
  });

  it('isolates tenant context — sequential calls with different tenants do not leak', async () => {
    // Confirms each call binds its OWN tenant; the BEGIN/COMMIT pair
    // guarantees the binding cannot survive into the next caller's
    // txn.
    const db = makeStubDb();
    await withWorkerTenantContext(db, 't_alpha', async () => undefined);
    await withWorkerTenantContext(db, 't_beta', async () => undefined);

    const setConfigCalls = db.calls.filter((c) => c.sql.includes('set_config'));
    expect(setConfigCalls).toHaveLength(2);
    // The drizzle tagged-template stub joins the strings together; the
    // tenant id is bound via a parameterised slot ($1) so we cannot
    // recover the literal value from the stub. We assert ordering
    // instead: both set_config calls live INSIDE their own BEGIN/COMMIT
    // pair, so a stray binding cannot survive.
    const beginIdxs = db.calls
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => /^\s*BEGIN/.test(c.sql))
      .map(({ i }) => i);
    const commitIdxs = db.calls
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => /^\s*COMMIT/.test(c.sql))
      .map(({ i }) => i);
    expect(beginIdxs).toHaveLength(2);
    expect(commitIdxs).toHaveLength(2);
    // Every BEGIN precedes its matching COMMIT.
    expect(beginIdxs[0]).toBeLessThan(commitIdxs[0]!);
    expect(beginIdxs[1]).toBeLessThan(commitIdxs[1]!);
    // The first COMMIT lands before the second BEGIN — no overlapping
    // txns share the same connection state.
    expect(commitIdxs[0]).toBeLessThan(beginIdxs[1]!);
  });

  it('rejects empty tenantId as a programmer error', async () => {
    const db = makeStubDb();
    await expect(
      withWorkerTenantContext(db, '', async () => undefined),
    ).rejects.toThrow('tenantId must be non-empty');
    await expect(
      withWorkerTenantContext(db, '   ', async () => undefined),
    ).rejects.toThrow('tenantId must be non-empty');
    // The helper rejected BEFORE emitting any SQL — no half-open txn.
    expect(db.calls).toHaveLength(0);
  });
});
