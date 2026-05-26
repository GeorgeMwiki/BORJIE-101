import { describe, it, expect } from 'vitest';
import { createObjectiveManager } from '../objectives/objective-manager.js';
import { createInMemoryNorthStarObjectivesRepository } from '../repositories/north-star-objectives-repository.js';
import { InvalidStateTransition } from '../types.js';

function makeManager(clockMs = 1_800_000_000_000) {
  const repo = createInMemoryNorthStarObjectivesRepository();
  let nowMs = clockMs;
  const manager = createObjectiveManager({
    repo,
    now: () => new Date(nowMs),
  });
  return { repo, manager, advance: (ms: number) => (nowMs += ms) };
}

const baseInput = {
  tenantId: 't1',
  scopeId: 'tenant_root',
  title: 'Royalty revenue ≥ TZS 2.0B by Q3',
  description: 'Quarterly royalty revenue target for the Geita licence.',
  metricName: 'royalty_revenue_tzs',
  targetValue: 2_000_000_000,
  targetAt: '2026-09-30T23:59:59.000Z',
  ownerUserId: '11111111-1111-1111-1111-111111111111',
};

describe('ObjectiveManager — lifecycle', () => {
  it('creates an objective in `proposed` status with a chained audit hash', async () => {
    const { manager } = makeManager();
    const obj = await manager.create(baseInput);
    expect(obj.status).toBe('proposed');
    expect(obj.tenantId).toBe('t1');
    expect(obj.title).toBe(baseInput.title);
    expect(obj.auditHash.length).toBe(64);
    expect(obj.prevHash).toBeNull();
  });

  it('activates a `proposed` objective and updates the audit hash chain', async () => {
    const { manager, advance } = makeManager();
    const created = await manager.create(baseInput);
    advance(1_000);
    const activated = await manager.activate('t1', created.id);
    expect(activated.status).toBe('active');
    expect(activated.prevHash).toBe(created.auditHash);
    expect(activated.auditHash).not.toBe(created.auditHash);
  });

  it('refuses an illegal transition (proposed → met)', async () => {
    const { manager } = makeManager();
    const created = await manager.create(baseInput);
    await expect(manager.markMet('t1', created.id)).rejects.toBeInstanceOf(
      InvalidStateTransition,
    );
  });

  it('marks an active objective as `met`, terminates the state machine', async () => {
    const { manager, advance } = makeManager();
    const created = await manager.create(baseInput);
    advance(1_000);
    await manager.activate('t1', created.id);
    advance(1_000);
    const met = await manager.markMet('t1', created.id);
    expect(met.status).toBe('met');
    // From a terminal state every transition is rejected.
    await expect(manager.retire('t1', created.id)).rejects.toBeInstanceOf(
      InvalidStateTransition,
    );
  });

  it('lists only active objectives per tenant', async () => {
    const { manager } = makeManager();
    const a = await manager.create({ ...baseInput, title: 'A' });
    const b = await manager.create({ ...baseInput, title: 'B' });
    await manager.activate('t1', a.id);
    await manager.create({ ...baseInput, tenantId: 't2', title: 'cross-tenant' });
    const active = await manager.listActive('t1');
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(a.id);
    // `b` is still proposed and must not appear.
    expect(active.find((o) => o.id === b.id)).toBeUndefined();
  });
});
