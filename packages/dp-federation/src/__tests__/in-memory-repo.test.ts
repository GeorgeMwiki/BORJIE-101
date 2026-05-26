import { describe, expect, it } from 'vitest';
import { createInMemoryDpChargesRepository } from '../repositories/dp-charges-repository.js';
import type { DpCharge } from '../types.js';

function charge(
  overrides: Partial<DpCharge> = {},
): DpCharge {
  return Object.freeze({
    id: overrides.id ?? 'c-1',
    tenantId: overrides.tenantId ?? 'tenant-a',
    periodStart: overrides.periodStart ?? '2026-04-01',
    epsilonDelta: overrides.epsilonDelta ?? 0.5,
    operation: overrides.operation ?? 'dp-mean',
    opId: overrides.opId ?? 'op-1',
    recordedAt: overrides.recordedAt ?? '2026-05-26T10:00:00Z',
    auditHash: overrides.auditHash ?? 'h',
  });
}

describe('createInMemoryDpChargesRepository', () => {
  it('sums epsilon across charges in the same period', async () => {
    const repo = createInMemoryDpChargesRepository();
    await repo.insert(charge({ id: 'c1', opId: 'op-1', epsilonDelta: 0.5 }));
    await repo.insert(charge({ id: 'c2', opId: 'op-2', epsilonDelta: 0.3 }));
    await repo.insert(charge({ id: 'c3', opId: 'op-3', epsilonDelta: 0.2 }));
    const total = await repo.sumForPeriod('tenant-a', '2026-04-01');
    expect(total).toBeCloseTo(1.0, 9);
  });

  it('isolates tenants', async () => {
    const repo = createInMemoryDpChargesRepository();
    await repo.insert(charge({ id: 'c1', tenantId: 'tenant-a', opId: 'op-1', epsilonDelta: 0.5 }));
    await repo.insert(charge({ id: 'c2', tenantId: 'tenant-b', opId: 'op-2', epsilonDelta: 0.7 }));
    const a = await repo.sumForPeriod('tenant-a', '2026-04-01');
    const b = await repo.sumForPeriod('tenant-b', '2026-04-01');
    expect(a).toBeCloseTo(0.5, 9);
    expect(b).toBeCloseTo(0.7, 9);
  });

  it('is idempotent on duplicate op_id (silent no-op)', async () => {
    const repo = createInMemoryDpChargesRepository();
    await repo.insert(charge({ id: 'c1', opId: 'op-1', epsilonDelta: 0.5 }));
    await repo.insert(
      charge({ id: 'c2', opId: 'op-1', epsilonDelta: 0.9 }),
    );
    const total = await repo.sumForPeriod('tenant-a', '2026-04-01');
    expect(total).toBeCloseTo(0.5, 9);
  });
});
