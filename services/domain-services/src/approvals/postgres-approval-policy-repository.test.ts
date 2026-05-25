/**
 * Tests for PostgresApprovalPolicyRepository.
 *
 * These tests use a lightweight in-memory fake that mimics the Drizzle client
 * contract the repository relies on (select / insert / where / limit /
 * onConflictDoUpdate). The goal is to verify behavioral contracts defined by
 * ApprovalPolicyOverrideRepository without requiring a live Postgres:
 *
 *   - findPolicy returns null when no override exists (service falls back to default)
 *   - upsertPolicy then findPolicy returns the custom policy
 *   - Cross-tenant isolation: tenant A's override is invisible to tenant B
 *   - listPolicies returns only the current tenant's overrides
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PostgresApprovalPolicyRepository } from './postgres-approval-policy-repository.js';
import type { ApprovalPolicy, ApprovalType } from './types.js';
import type { TenantId, UserId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Fake Drizzle client — composite PK on (tenant_id, type)
// ---------------------------------------------------------------------------

type Row = {
  tenantId: string;
  type: string;
  policyJson: unknown;
  updatedAt: Date;
  updatedBy: string | null;
};

function makeFakeDb() {
  const rows: Row[] = [];

  // Predicate compiled from drizzle `and`/`eq` calls (we capture the fields by
  // identity via the imported schema). We only need a structural matcher for
  // our small surface area.
  type Predicate = (row: Row) => boolean;

  function fromBuilder(_table: unknown) {
    let predicate: Predicate = () => true;
    let limit = Infinity;
    const builder = {
      from(_t: unknown) {
        return builder;
      },
      where(pred: Predicate) {
        predicate = pred;
        return builder;
      },
      limit(n: number) {
        limit = n;
        return builder;
      },
      // Execute on await
      then(resolve: (v: Row[]) => void) {
        const out = rows.filter(predicate).slice(0, limit);
        resolve(out);
      },
    };
    return builder;
  }

  const db = {
    _rows: rows,
    select() {
      return {
        from(_t: unknown) {
          return fromBuilder(_t);
        },
      };
    },
    insert(_t: unknown) {
      let pending: Row | null = null;
      // Tracks whether a terminal clause (onConflictDoUpdate) already
      // reconciled the insert against the existing rows. Without this flag
      // the `then()` fallback re-pushes `pending` after the conflict handler
      // has already merged it in place, producing duplicate rows in the
      // fake store.
      let resolved = false;
      const builder = {
        values(v: Row) {
          pending = {
            tenantId: v.tenantId,
            type: v.type,
            policyJson: v.policyJson,
            updatedAt: v.updatedAt,
            updatedBy: v.updatedBy ?? null,
          };
          return builder;
        },
        onConflictDoUpdate(_cfg: { target: unknown; set: Partial<Row> }) {
          if (!pending) throw new Error('values() not called');
          const idx = rows.findIndex(
            (r) => r.tenantId === pending!.tenantId && r.type === pending!.type
          );
          if (idx === -1) {
            rows.push(pending);
          } else {
            rows[idx] = {
              ...rows[idx],
              ...pending,
              ..._cfg.set,
            } as Row;
          }
          resolved = true;
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          if (!resolved && pending) {
            // Caller skipped onConflictDoUpdate → plain insert semantics.
            rows.push(pending);
            resolved = true;
          }
          resolve(undefined);
        },
      };
      return builder;
    },
  };
  return db;
}

// We need the predicate produced by drizzle's `and(eq(...), eq(...))` to work
// against our fake rows. Drizzle's `eq(column, value)` returns a SQL object;
// the fake `where` above receives it verbatim. To bridge this for tests, we
// mock drizzle-orm's `and`/`eq` to return plain predicate functions.
//
// Direct namespace reassignment does not work: modern Node marks ESM
// namespace exports as read-only, so `(drizzleOrm as any).eq = …` throws
// `TypeError: Cannot assign to read only property`. vi.mock registers a
// factory BEFORE module load and supplies writable bindings.

import { vi } from 'vitest';
import { approvalPolicies } from '@borjie/database';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      return (row: Row) => {
        if (col === approvalPolicies.tenantId) return row.tenantId === val;
        if (col === approvalPolicies.type) return row.type === val;
        return false;
      };
    },
    and: (...preds: Array<(r: Row) => boolean>) => {
      return (row: Row) => preds.every((p) => p(row));
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_A = 'tenant_a' as unknown as TenantId;
const TENANT_B = 'tenant_b' as unknown as TenantId;
const ACTOR = 'user_admin' as unknown as UserId;
const TYPE: ApprovalType = 'maintenance_cost';

function makePolicy(overrides: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return {
    tenantId: TENANT_A,
    type: TYPE,
    thresholds: [
      { minAmount: 0, maxAmount: 1000, requiredRole: 'estate_manager', approvalLevel: 1 },
    ],
    autoApproveRules: [
      { maxAmount: 200, maxAmountCurrency: 'USD', appliesToRoles: ['estate_manager'] },
    ],
    approvalChain: [
      { level: 1, requiredRole: 'estate_manager', timeoutHours: 12, escalateToRole: 'owner' },
    ],
    defaultTimeoutHours: 12,
    autoEscalateToRole: 'owner',
    updatedAt: new Date().toISOString(),
    updatedBy: ACTOR,
    ...overrides,
  } as ApprovalPolicy;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostgresApprovalPolicyRepository', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let repo: PostgresApprovalPolicyRepository;

  beforeEach(() => {
    db = makeFakeDb();
    repo = new PostgresApprovalPolicyRepository(db as any);
  });

  it('findPolicy returns null when no override exists (service falls back to default)', async () => {
    const found = await repo.findPolicy(TENANT_A, TYPE);
    expect(found).toBeNull();
  });

  it('upsertPolicy then findPolicy returns the custom policy', async () => {
    const custom = makePolicy({ defaultTimeoutHours: 6 });
    await repo.upsertPolicy(TENANT_A, TYPE, custom, ACTOR);

    const found = await repo.findPolicy(TENANT_A, TYPE);
    expect(found).not.toBeNull();
    expect(found?.defaultTimeoutHours).toBe(6);
    expect(found?.tenantId).toBe(TENANT_A);
    expect(found?.type).toBe(TYPE);
  });

  it('upsertPolicy twice for the same (tenant, type) updates in place', async () => {
    await repo.upsertPolicy(TENANT_A, TYPE, makePolicy({ defaultTimeoutHours: 6 }), ACTOR);
    await repo.upsertPolicy(TENANT_A, TYPE, makePolicy({ defaultTimeoutHours: 24 }), ACTOR);

    const found = await repo.findPolicy(TENANT_A, TYPE);
    expect(found?.defaultTimeoutHours).toBe(24);
    // And only one row exists
    expect(db._rows.length).toBe(1);
  });

  it('enforces cross-tenant isolation — tenant A policy invisible to tenant B', async () => {
    const policyA = makePolicy({ defaultTimeoutHours: 6, tenantId: TENANT_A });
    await repo.upsertPolicy(TENANT_A, TYPE, policyA, ACTOR);

    const foundForB = await repo.findPolicy(TENANT_B, TYPE);
    expect(foundForB).toBeNull();

    const foundForA = await repo.findPolicy(TENANT_A, TYPE);
    expect(foundForA?.defaultTimeoutHours).toBe(6);
  });

  it('listPolicies returns only the queried tenant\'s overrides', async () => {
    await repo.upsertPolicy(TENANT_A, 'maintenance_cost', makePolicy({ tenantId: TENANT_A, type: 'maintenance_cost' }), ACTOR);
    await repo.upsertPolicy(TENANT_A, 'refund', makePolicy({ tenantId: TENANT_A, type: 'refund' }), ACTOR);
    await repo.upsertPolicy(TENANT_B, 'maintenance_cost', makePolicy({ tenantId: TENANT_B, type: 'maintenance_cost' }), ACTOR);

    const listedA = await repo.listPolicies(TENANT_A);
    expect(listedA.length).toBe(2);
    expect(listedA.every((p) => p.tenantId === TENANT_A)).toBe(true);

    const listedB = await repo.listPolicies(TENANT_B);
    expect(listedB.length).toBe(1);
    expect(listedB[0].tenantId).toBe(TENANT_B);
  });

  it('upsertPolicy stamps updatedBy = actor regardless of passed policy.updatedBy', async () => {
    const stale = makePolicy({ updatedBy: 'someone_else' as unknown as UserId });
    await repo.upsertPolicy(TENANT_A, TYPE, stale, ACTOR);

    const row = db._rows[0];
    expect(row.updatedBy).toBe(ACTOR);
  });
});
