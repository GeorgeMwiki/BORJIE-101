/**
 * Tests for PostgresDamageDeductionRepository.
 *
 * Uses an in-memory drizzle fake (structural predicates via vi.mock).
 * Verifies CRUD, append-only turns, tenant isolation, and listOpen filtering.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresDamageDeductionRepository } from './postgres-damage-deduction-repository.js';
import type {
  DamageDeductionCase,
  NegotiationTurn,
} from './damage-deduction-case.js';
import { asDamageDeductionCaseId } from './damage-deduction-case.js';
import type {
  TenantId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';

type Row = Record<string, unknown>;

vi.mock('drizzle-orm', () => ({
  and: (...parts: any[]) => (row: Row) =>
    parts.every((p) => (p ? p(row) : true)),
  eq: (col: any, val: unknown) => (row: Row) => row[col.name] === val,
  inArray: (col: any, vals: unknown[]) => (row: Row) =>
    vals.includes(row[col.name]),
}));

vi.mock('./damage-deduction.schema.js', () => {
  const col = (name: string) => ({ name });
  return {
    damageDeductionCases: {
      id: col('id'),
      tenantId: col('tenantId'),
      status: col('status'),
    },
  };
});

function makeFakeDb() {
  const rows: Row[] = [];
  const toPred = (p: any) => (typeof p === 'function' ? p : () => true);
  return {
    rows,
    select: () => {
      let predicate: (r: Row) => boolean = () => true;
      let limit = Infinity;
      const chain: any = {
        from: () => chain,
        where: (p: any) => ((predicate = toPred(p)), chain),
        limit: (n: number) => ((limit = n), chain),
        then: (resolve: (r: Row[]) => void) =>
          resolve(rows.filter(predicate).slice(0, limit)),
      };
      return chain;
    },
    insert: (_t: unknown) => ({
      values(v: Row) {
        rows.push({ ...v });
      },
    }),
    update: (_t: unknown) => {
      let patch: Row = {};
      const chain: any = {
        set: (p: Row) => ((patch = p), chain),
        where: (p: any) => {
          const pred = toPred(p);
          for (const row of rows) if (pred(row)) Object.assign(row, patch);
          return Promise.resolve();
        },
      };
      return chain;
    },
  };
}

const TENANT_A = 'tenant_A' as TenantId;
const TENANT_B = 'tenant_B' as TenantId;
const ACTOR = 'u_1' as UserId;

function makeCase(
  id: string,
  tenantId: TenantId,
  overrides: Partial<DamageDeductionCase> = {}
): DamageDeductionCase {
  const now = new Date().toISOString() as ISOTimestamp;
  return {
    id: asDamageDeductionCaseId(id),
    tenantId,
    claimedDeductionMinor: 100_000,
    currency: 'TZS',
    status: 'claim_filed',
    aiMediatorTurns: [
      {
        id: 'turn_init',
        actor: 'owner',
        actorId: ACTOR,
        proposedAmountMinor: 100_000,
        rationale: 'seed',
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    ...overrides,
  };
}

describe('PostgresDamageDeductionRepository', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let repo: PostgresDamageDeductionRepository;

  beforeEach(() => {
    db = makeFakeDb();
    repo = new PostgresDamageDeductionRepository(db as any);
  });

  it('create + findById round-trips an entity', async () => {
    const entity = makeCase('ddc_1', TENANT_A);
    await repo.create(entity);
    const found = await repo.findById(entity.id, TENANT_A);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(entity.id);
    expect(found?.aiMediatorTurns).toHaveLength(1);
  });

  it('tenant isolation: cannot read a case from a different tenant', async () => {
    const entity = makeCase('ddc_A', TENANT_A);
    await repo.create(entity);
    const crossTenant = await repo.findById(entity.id, TENANT_B);
    expect(crossTenant).toBeNull();
  });

  it('appendTurn is additive (never replaces history)', async () => {
    const entity = makeCase('ddc_2', TENANT_A);
    await repo.create(entity);
    const turn: NegotiationTurn = {
      id: 'turn_tenant',
      actor: 'tenant',
      proposedAmountMinor: 50_000,
      rationale: 'partial',
      createdAt: new Date().toISOString() as ISOTimestamp,
    };
    await repo.appendTurn(entity.id, TENANT_A, turn);
    const found = await repo.findById(entity.id, TENANT_A);
    expect(found?.aiMediatorTurns).toHaveLength(2);
    expect(found?.aiMediatorTurns[1].id).toBe('turn_tenant');
  });

  it('updateStatus changes status', async () => {
    const entity = makeCase('ddc_3', TENANT_A);
    await repo.create(entity);
    await repo.updateStatus(entity.id, TENANT_A, 'negotiating', ACTOR);
    const found = await repo.findById(entity.id, TENANT_A);
    expect(found?.status).toBe('negotiating');
  });

  it('listOpen filters out terminal statuses', async () => {
    await repo.create(makeCase('ddc_open1', TENANT_A, { status: 'claim_filed' }));
    await repo.create(makeCase('ddc_open2', TENANT_A, { status: 'negotiating' }));
    await repo.create(makeCase('ddc_done', TENANT_A, { status: 'resolved' }));
    const open = await repo.listOpen(TENANT_A);
    const ids = open.map((c) => c.id);
    expect(ids).toContain('ddc_open1');
    expect(ids).toContain('ddc_open2');
    expect(ids).not.toContain('ddc_done');
  });
});
