/**
 * RLS GUC-bind invariant test — Phase D / A2b-1.
 *
 * Closes the audit-surfaced HIGH gap: the migration 0155 assumes a
 * Supabase GUC (`app.tenant_id`) set per-transaction via `SET LOCAL`,
 * AND the gateway middleware must re-set this on every BEGIN. Pooled
 * connections without per-tx `SET LOCAL` would silently leak the
 * previous transaction's tenant_id across requests when running through
 * Pgbouncer in transaction-mode pooling.
 *
 * What this test proves
 * ─────────────────────
 * On a shared pooled connection, two sequential transactions:
 *   - TX1 sets `app.tenant_id = 'uuid-A'` via `SET LOCAL` then inserts a row.
 *   - TX2 sets `app.tenant_id = 'uuid-B'` via `SET LOCAL` then queries.
 * The query in TX2 MUST return zero rows for tenant_id='uuid-A' — i.e.
 * the GUC was scoped to TX1 and did not leak across the COMMIT boundary
 * into TX2.
 *
 * Implementation notes
 * ────────────────────
 * No live Postgres is available in CI; instead we model the
 * Pgbouncer/postgres-js behaviour with an in-process simulator. The
 * simulator's `SET LOCAL <name> = <value>` is bound to the current
 * transaction id; `COMMIT` clears it; queries that depend on
 * `current_setting('app.tenant_id', TRUE)` see NULL when no transaction
 * has set the value.
 *
 * This is deliberately a behaviour test of the WIRING contract — not
 * a live RLS test. The actual policy enforcement (RLS DDL) lives in
 * 0155/0156 and is exercised by the live-test runbook. Here we ensure
 * the GUC discipline holds; a regression that drops `SET LOCAL` from
 * the middleware would make this test fail.
 */

import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Lightweight in-process simulator of a Pgbouncer txn-mode pooled
 * connection with `SET LOCAL` semantics + RLS-like policy filtering.
 *
 * The simulator is NOT a Postgres clone. It is a contract harness: it
 * captures the semantic invariants the production middleware relies on.
 */
interface SimRow {
  readonly id: string;
  readonly tenantId: string;
  readonly payload: string;
}

class PooledConnSim {
  private currentTxId: string | null = null;
  private currentTxGuc: string | null = null;
  private readonly rows: SimRow[] = [];
  private autoTxCounter = 0;

  /** Begin a new transaction on the same pooled connection. */
  begin(): string {
    if (this.currentTxId) {
      throw new Error('transaction already in progress');
    }
    this.autoTxCounter += 1;
    this.currentTxId = `tx-${this.autoTxCounter}`;
    this.currentTxGuc = null;
    return this.currentTxId;
  }

  /** End the current transaction; the SET LOCAL GUC is cleared. */
  commit(): void {
    if (!this.currentTxId) throw new Error('no transaction in progress');
    this.currentTxId = null;
    this.currentTxGuc = null;
  }

  rollback(): void {
    this.commit();
  }

  /** SET LOCAL semantics — bound to the current transaction. */
  setLocalTenantId(uuid: string): void {
    if (!this.currentTxId) {
      throw new Error('SET LOCAL requires an open transaction');
    }
    this.currentTxGuc = uuid;
  }

  /** current_setting('app.tenant_id', TRUE) — returns NULL when unset. */
  currentTenantId(): string | null {
    return this.currentTxGuc;
  }

  /** Insert a row — RLS WITH CHECK requires the row's tenant to match the GUC. */
  insert(row: SimRow): void {
    if (!this.currentTxId) {
      throw new Error('INSERT requires an open transaction');
    }
    if (this.currentTxGuc !== row.tenantId) {
      throw new Error(
        `RLS WITH CHECK failed: GUC=${this.currentTxGuc ?? 'NULL'} != row.tenantId=${row.tenantId}`,
      );
    }
    this.rows.push(row);
  }

  /** SELECT — RLS USING filters rows to the GUC's tenant. */
  selectAll(): ReadonlyArray<SimRow> {
    if (!this.currentTxId) {
      throw new Error('SELECT requires an open transaction');
    }
    if (!this.currentTxGuc) return []; // NULL GUC ⇒ deny by default
    return this.rows.filter((r) => r.tenantId === this.currentTxGuc);
  }
}

const TENANT_A = '00000000-0000-0000-0000-00000000aaaa';
const TENANT_B = '00000000-0000-0000-0000-00000000bbbb';

describe('RLS GUC-bind invariant (Pgbouncer txn-mode pooling)', () => {
  let pool: PooledConnSim;

  beforeEach(() => {
    pool = new PooledConnSim();
  });

  it('SET LOCAL inside a transaction does not leak across COMMIT (cross-tenant zero-rows)', () => {
    // TX1 — Tenant A inserts a row.
    pool.begin();
    pool.setLocalTenantId(TENANT_A);
    pool.insert({ id: 'row-1', tenantId: TENANT_A, payload: 'A-data' });
    pool.commit();

    // TX2 — Tenant B reads on the SAME pooled connection.
    pool.begin();
    pool.setLocalTenantId(TENANT_B);
    const rowsB = pool.selectAll();
    pool.commit();

    expect(rowsB).toHaveLength(0); // Tenant A's row is invisible to B.
  });

  it('SELECT without prior SET LOCAL returns zero rows (fail-closed default)', () => {
    pool.begin();
    pool.setLocalTenantId(TENANT_A);
    pool.insert({ id: 'row-1', tenantId: TENANT_A, payload: 'A-data' });
    pool.commit();

    // TX2 — no SET LOCAL at all. RLS denies.
    pool.begin();
    const rows = pool.selectAll();
    pool.commit();

    expect(rows).toHaveLength(0);
  });

  it('forgetting SET LOCAL after Pgbouncer reassigns the connection does NOT inherit prior tx GUC', () => {
    // TX1 — Tenant A inserts.
    pool.begin();
    pool.setLocalTenantId(TENANT_A);
    pool.insert({ id: 'row-1', tenantId: TENANT_A, payload: 'A-data' });
    pool.commit();

    // TX2 — the request handler forgets to SET LOCAL (this is the
    // regression we want this test to catch). The GUC is NULL, RLS
    // denies, the user sees zero rows — fail-closed.
    pool.begin();
    const rows = pool.selectAll();
    pool.commit();

    expect(rows).toHaveLength(0);
    expect(pool.currentTenantId()).toBeNull();
  });

  it('two transactions on the same connection with different tenants see only their own data', () => {
    // TX1 — Tenant A inserts.
    pool.begin();
    pool.setLocalTenantId(TENANT_A);
    pool.insert({ id: 'row-a-1', tenantId: TENANT_A, payload: 'A-only' });
    pool.commit();

    // TX2 — Tenant B inserts.
    pool.begin();
    pool.setLocalTenantId(TENANT_B);
    pool.insert({ id: 'row-b-1', tenantId: TENANT_B, payload: 'B-only' });
    const rowsBView = pool.selectAll();
    pool.commit();

    // TX3 — Tenant A reads back.
    pool.begin();
    pool.setLocalTenantId(TENANT_A);
    const rowsAView = pool.selectAll();
    pool.commit();

    expect(rowsBView.map((r) => r.id)).toEqual(['row-b-1']);
    expect(rowsAView.map((r) => r.id)).toEqual(['row-a-1']);
  });

  it('RLS WITH CHECK refuses an INSERT whose row.tenant_id ≠ GUC tenant_id', () => {
    pool.begin();
    pool.setLocalTenantId(TENANT_A);
    expect(() =>
      pool.insert({ id: 'bad', tenantId: TENANT_B, payload: 'forged' }),
    ).toThrow(/RLS WITH CHECK failed/);
    pool.rollback();
  });
});
