/**
 * Tests for the Drizzle tenant-aware query wrapper.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  tenantAwareQuery,
  type DrizzleLikeQueryBuilder,
  type TenantScopedTable,
} from '../drizzle/tenant-aware-query.js';
import { runInTenantContext } from '../context/tenant-context.js';
import { asTenantId, IsolationViolation, type TenantContext, type TenantId } from '../types.js';

function makeCtx(t: string): TenantContext {
  const tid = asTenantId(t) as TenantId;
  return { tenantId: tid, actorTenantId: tid, requestId: 'req_drizzle_test' };
}

function makeStubDb(): { db: DrizzleLikeQueryBuilder; recorded: { where?: unknown; rows?: unknown } } {
  const recorded: { where?: unknown; rows?: unknown } = {};
  const fromChain = {
    where: vi.fn((expr: unknown) => {
      recorded.where = expr;
      return 'select-result';
    }),
  };
  const selectChain = { from: vi.fn(() => fromChain) };
  const updateChain = {
    set: vi.fn(() => ({
      where: vi.fn((expr: unknown) => {
        recorded.where = expr;
        return 'update-result';
      }),
    })),
  };
  const deleteChain = {
    where: vi.fn((expr: unknown) => {
      recorded.where = expr;
      return 'delete-result';
    }),
  };
  const insertChain = {
    values: vi.fn((rows: unknown) => {
      recorded.rows = rows;
      return 'insert-result';
    }),
  };
  const db: DrizzleLikeQueryBuilder = {
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
    delete: vi.fn(() => deleteChain),
    insert: vi.fn(() => insertChain),
  };
  return { db, recorded };
}

const parcelsTable: TenantScopedTable = { _name: 'parcels', tenant_id: 'parcels.tenant_id' };

const eq = (col: unknown, v: string): unknown => ({ __op: 'eq', col, v });

describe('tenantAwareQuery', () => {
  it('select adds tenant_id WHERE fragment', async () => {
    const { db, recorded } = makeStubDb();
    const q = tenantAwareQuery({ db, eq });
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      q.select(parcelsTable);
    });
    expect(recorded.where).toEqual({ __op: 'eq', col: 'parcels.tenant_id', v: 'tenant_alpha' });
  });

  it('update sets values + tenant_id WHERE', async () => {
    const { db, recorded } = makeStubDb();
    const q = tenantAwareQuery({ db, eq });
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      q.update(parcelsTable, { area: 12 });
    });
    expect(recorded.where).toEqual({ __op: 'eq', col: 'parcels.tenant_id', v: 'tenant_alpha' });
  });

  it('delete adds tenant_id WHERE', async () => {
    const { db, recorded } = makeStubDb();
    const q = tenantAwareQuery({ db, eq });
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      q.delete(parcelsTable);
    });
    expect(recorded.where).toEqual({ __op: 'eq', col: 'parcels.tenant_id', v: 'tenant_alpha' });
  });

  it('insert rejects rows that omit tenant_id', async () => {
    const { db } = makeStubDb();
    const q = tenantAwareQuery({ db, eq });
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      expect(() => q.insert(parcelsTable, [{ area: 99 }])).toThrowError(IsolationViolation);
    });
  });

  it('insert rejects rows whose tenant_id differs from context', async () => {
    const { db } = makeStubDb();
    const q = tenantAwareQuery({ db, eq });
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      expect(() =>
        q.insert(parcelsTable, [{ tenant_id: 'tenant_beta', area: 99 }]),
      ).toThrowError(IsolationViolation);
    });
  });

  it('select refuses to run outside a tenant context', () => {
    const { db } = makeStubDb();
    const q = tenantAwareQuery({ db, eq });
    expect(() => q.select(parcelsTable)).toThrowError(IsolationViolation);
  });
});
