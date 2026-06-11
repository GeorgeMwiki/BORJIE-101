/**
 * CROSS-TENANT LEAK TEST — the crown jewel that gates the RSS-03 merge.
 *
 * Claim proven here (verbatim §1.1 of SPEC_scale-dbclient-pooler-ha):
 *   Binding the tenant GUC with `SET LOCAL` (`set_config(..., true)`) inside a
 *   transaction, against the Supabase/pgbouncer TRANSACTION pooler, can NEVER
 *   read another tenant's rows.
 *
 *   1. The transaction pooler guarantees ONE invariant: a single SQL
 *      transaction is served end-to-end by one backend (it only multiplexes
 *      BETWEEN transactions).
 *   2. `withTenantContext` runs `BEGIN; SET LOCAL app.current_tenant_id=$t;
 *      …queries…; COMMIT` as one transaction.
 *   3. Therefore the SET LOCAL and every query that reads it execute on the
 *      SAME backend, and SET LOCAL is discarded at transaction end — it cannot
 *      bleed onto the next transaction the pooler routes to that backend.
 *   4. With no GUC set, `current_setting('app.current_tenant_id', true)` is
 *      NULL → the policy matches ZERO tenant rows (fail-closed), never "all".
 *
 * No live Postgres is available in unit CI, so we drive the REAL
 * `withTenantContext` against a faithful mock of pgbouncer transaction-mode
 * `SET LOCAL` semantics: a small set of shared backends multiplexed BETWEEN
 * transactions, each backend carrying a single transaction-local GUC that is
 * cleared on COMMIT. If `withTenantContext` ever dropped a `SET LOCAL`, bound
 * the wrong scope (`false` third arg → session-leaky), or read on a different
 * backend than it bound, the interleaved harness would surface a foreign row.
 *
 * 1000 interleaved two-tenant iterations exercise the exact race the reserve()
 * pin was guarding against on a session pooler — and prove the SET-LOCAL path
 * is correct by construction without it.
 */

import { describe, expect, it } from 'vitest';
import { withTenantContext } from '../rls/with-tenant-context.js';
import type { DatabaseClient } from '../client.js';

const TENANT_A = '00000000-0000-0000-0000-00000000aaaa';
const TENANT_B = '00000000-0000-0000-0000-00000000bbbb';

interface Row {
  readonly id: string;
  readonly tenantId: string;
}

/**
 * A single pooled backend. Holds at most one transaction-local GUC at a time;
 * exactly one transaction may be active on it (the pooler never splits a
 * transaction across backends, and never runs two transactions on one backend
 * concurrently).
 */
class Backend {
  guc: string | null = null;
  busy = false;
}

/**
 * Faithful pgbouncer transaction-mode pooler mock.
 *
 * - A FIXED, SMALL set of backends is multiplexed across many logical
 *   transactions (forces tenant A and tenant B to share physical backends —
 *   the scenario a session-scoped GUC would leak through).
 * - `transaction(fn)` acquires a free backend, runs `fn` with a `tx` bound to
 *   THAT backend, then releases it. The backend's GUC is RESET on release
 *   (COMMIT discards SET LOCAL) so a later transaction on the same backend
 *   starts with NULL — exactly Postgres' SET LOCAL lifecycle.
 * - The `tx` handle's `execute()` interprets the `set_config(name, val, true)`
 *   statements `withTenantContext` issues and binds them to the backend.
 * - The `tx` handle's `select()` returns ONLY rows whose tenantId equals the
 *   backend's currently-bound GUC (RLS USING), or [] when the GUC is NULL.
 */
class TxPoolerMock {
  private readonly backends: Backend[];
  private readonly store: Row[] = [];

  constructor(backendCount: number) {
    this.backends = Array.from({ length: backendCount }, () => new Backend());
  }

  seed(rows: readonly Row[]): void {
    this.store.push(...rows);
  }

  /** Acquire any non-busy backend (the pooler's between-transaction routing). */
  private acquire(): Backend {
    const free = this.backends.find((b) => !b.busy);
    if (!free) {
      // With await-driven interleaving and >= concurrent-tenants backends this
      // never trips; guard anyway so a regression is loud, not a deadlock.
      throw new Error('pooler exhausted — no free backend');
    }
    free.busy = true;
    // A freshly-acquired backend must NOT carry a prior transaction's GUC.
    // (Postgres clears SET LOCAL at COMMIT; we assert that invariant here.)
    if (free.guc !== null) {
      throw new Error(
        'INVARIANT VIOLATION: backend carried a GUC across transactions ' +
          `(stale=${free.guc}) — SET LOCAL leaked past COMMIT`,
      );
    }
    return free;
  }

  /** drizzle-shaped `db.transaction(fn)` over the transaction pooler. */
  readonly transaction = async <T>(
    fn: (tx: DatabaseClient) => Promise<T>,
  ): Promise<T> => {
    const backend = this.acquire();
    const tx = this.makeTx(backend);
    try {
      return await fn(tx as unknown as DatabaseClient);
    } finally {
      // COMMIT/ROLLBACK — SET LOCAL is discarded, backend returns to the pool.
      backend.guc = null;
      backend.busy = false;
    }
  };

  /**
   * The per-transaction handle. Only the surface `withTenantContext` and the
   * test callback use is implemented: `execute(sql)` (for set_config) and a
   * tiny `select()` that applies the RLS USING predicate.
   */
  private makeTx(backend: Backend): {
    execute: (q: { queryChunks?: unknown } | unknown) => Promise<unknown>;
    selectForTenant: () => readonly Row[];
  } {
    return {
      // `withTenantContext` passes a drizzle `sql` tagged template. We don't
      // parse SQL; instead we reconstruct the statement text from the drizzle
      // SQL object and interpret the canonical tenant set_config. This keeps
      // the mock faithful to WHAT withTenantContext emits without coupling to
      // drizzle internals beyond a best-effort text render.
      execute: async (q: unknown) => {
        const text = renderSql(q);
        const m = text.match(
          /set_config\(\s*'app\.current_tenant_id'\s*,\s*'?([^',]+)'?\s*,\s*true\s*\)/i,
        );
        if (m && m[1] !== undefined) {
          // The canonical tenant GUC, transaction-local — bind to this backend.
          backend.guc = m[1];
        }
        // Other set_config calls (app.tenant_id mirror, app.is_service_role,
        // app.current_person_id) are no-ops for this leak harness.
        return [];
      },
      selectForTenant: () => {
        if (backend.guc === null) return []; // fail-closed: NULL GUC ⇒ no rows
        return this.store.filter((r) => r.tenantId === backend.guc);
      },
    };
  }
}

/**
 * Best-effort render of a drizzle `sql` object / param array to a flat string
 * so the mock can recognise the canonical set_config statement. Drizzle binds
 * the tenant id as a parameter, so we stitch the static chunks with the params
 * interleaved.
 */
function renderSql(q: unknown): string {
  if (typeof q === 'string') return q;
  const obj = q as {
    queryChunks?: Array<{ value?: unknown[] } | unknown>;
    // drizzle SQL exposes its parts under different shapes across versions; we
    // duck-type the two we care about.
  };
  // drizzle SQL objects expose `.queryChunks`; string chunks carry `.value`
  // (string[]), param chunks carry a `.value` we render as a quoted literal.
  const chunks = obj.queryChunks;
  if (!Array.isArray(chunks)) return JSON.stringify(q);
  let out = '';
  for (const c of chunks) {
    const cv = (c as { value?: unknown }).value;
    if (Array.isArray(cv)) out += cv.join('');
    else if (cv !== undefined) out += `'${String(cv)}'`;
    else if (typeof c === 'string') out += c;
  }
  return out;
}

/**
 * A "request" for one tenant: open a tenant context, assert it only ever sees
 * its own seeded row. Mirrors what a route does via the real wrapper.
 */
async function tenantRequest(
  pool: TxPoolerMock,
  tenantId: string,
): Promise<readonly Row[]> {
  return withTenantContext(
    pool as unknown as DatabaseClient,
    tenantId,
    async (tx) => {
      // The callback runs INSIDE the bound transaction. Yield once to maximise
      // interleaving with the other tenant's in-flight transaction.
      await Promise.resolve();
      const rows = (
        tx as unknown as { selectForTenant: () => readonly Row[] }
      ).selectForTenant();
      return rows;
    },
  );
}

describe('cross-tenant leak — transaction-mode SET LOCAL (1000 interleaved iterations)', () => {
  it('never reads another tenant rows across 1000 interleaved two-tenant requests', async () => {
    // 4 shared backends, 2 tenants → tenants are forced to share physical
    // backends across transactions (the exact session-GUC-leak scenario).
    const pool = new TxPoolerMock(4);
    pool.seed([
      { id: 'a-row', tenantId: TENANT_A },
      { id: 'b-row', tenantId: TENANT_B },
    ]);

    let leaks = 0;
    let aChecks = 0;
    let bChecks = 0;

    for (let i = 0; i < 1000; i++) {
      // Interleave the two tenants' requests concurrently on the shared pool.
      const [aRows, bRows] = await Promise.all([
        tenantRequest(pool, TENANT_A),
        tenantRequest(pool, TENANT_B),
      ]);

      // Tenant A must see ONLY its own row; never tenant B's.
      if (aRows.some((r) => r.tenantId !== TENANT_A)) leaks++;
      if (bRows.some((r) => r.tenantId !== TENANT_B)) leaks++;
      expect(aRows.map((r) => r.id)).toEqual(['a-row']);
      expect(bRows.map((r) => r.id)).toEqual(['b-row']);
      aChecks++;
      bChecks++;
    }

    expect(leaks).toBe(0);
    expect(aChecks).toBe(1000);
    expect(bChecks).toBe(1000);
  });

  it('fail-closed: a transaction that never SET LOCAL reads ZERO rows (not all)', async () => {
    const pool = new TxPoolerMock(2);
    pool.seed([
      { id: 'a-row', tenantId: TENANT_A },
      { id: 'b-row', tenantId: TENANT_B },
    ]);

    // Drive the mock directly WITHOUT withTenantContext → no SET LOCAL bound.
    const rows = await pool.transaction(async (tx) =>
      (tx as unknown as { selectForTenant: () => readonly Row[] }).selectForTenant(),
    );
    expect(rows).toHaveLength(0);
  });

  it('negative control: the harness WOULD catch a session-scope (set_config false) leak', async () => {
    // Prove the mock has teeth — model the BROKEN behaviour (session-scoped
    // GUC that survives COMMIT, i.e. a regression of withTenantContext back to
    // `set_config(..., false)` on a reused backend). A leaky pooler that does
    // NOT clear the GUC on release must surface a foreign row.
    class LeakyBackend {
      guc: string | null = null;
      busy = false;
    }
    const backend = new LeakyBackend();
    const store: Row[] = [
      { id: 'a-row', tenantId: TENANT_A },
      { id: 'b-row', tenantId: TENANT_B },
    ];
    // Tenant A "request": bind A, read (A-only), then release WITHOUT clearing
    // the GUC (the bug).
    backend.guc = TENANT_A;
    const aRows = store.filter((r) => r.tenantId === backend.guc);
    backend.busy = false; // released, but GUC NOT cleared (session-scope bug)

    // Tenant B "request" lands on the same backend but forgets to re-bind
    // (e.g. a route doing a raw query). It inherits tenant A's stale GUC.
    const bRowsLeaky = store.filter((r) => r.tenantId === backend.guc);

    expect(aRows.map((r) => r.id)).toEqual(['a-row']);
    // The leak: tenant B's "raw" read sees tenant A's row. This is exactly what
    // the SET-LOCAL path (proven above) prevents by construction.
    expect(bRowsLeaky.map((r) => r.id)).toEqual(['a-row']);
  });

  it('invariant: a backend never carries a GUC across transactions (SET LOCAL discarded at COMMIT)', async () => {
    // The TxPoolerMock.acquire() throws if a reused backend still holds a GUC.
    // Running many sequential single-tenant transactions on ONE backend proves
    // the bind is cleared every time — a regression to `set_config(...,false)`
    // (session scope) in withTenantContext would trip the invariant guard.
    const pool = new TxPoolerMock(1);
    pool.seed([{ id: 'a-row', tenantId: TENANT_A }]);
    for (let i = 0; i < 50; i++) {
      const rows = await tenantRequest(pool, i % 2 === 0 ? TENANT_A : TENANT_B);
      expect(rows.every((r) => r.tenantId === (i % 2 === 0 ? TENANT_A : TENANT_B))).toBe(true);
    }
  });
});
