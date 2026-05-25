import { describe, expect, it } from 'vitest';
import { createVpGrowth } from '../index.js';
import type { ScopeContext } from '../../../../types.js';
import type { OwnerIntent, VpLineWorkerCatalogue } from '../../shared/vp-base.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't1',
  actorUserId: 'owner-1',
  roles: ['owner'],
  personaId: 'owner-advisor',
};

function catalogue(known: ReadonlyArray<string>): VpLineWorkerCatalogue {
  return { has: ({ name }) => known.includes(name) };
}

describe('vp.growth — orchestrate', () => {
  it('routes a renewal intent to lease.coordinator', async () => {
    const vp = createVpGrowth({
      lineWorkerCatalogue: catalogue(['lease.coordinator']),
    });
    const intent: OwnerIntent = {
      kind: 'remediate',
      text: 'Sarah\'s lease is expiring next month — renew her',
      scope: SCOPE,
      correlationId: 'c1',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns).toHaveLength(1);
    expect(plan.spawns[0]?.subMdId).toBe('lease.coordinator');
  });

  it('routes acquisition intents to vacancy.acquisitions-scout', async () => {
    const vp = createVpGrowth({
      lineWorkerCatalogue: catalogue(['vacancy.acquisitions-scout']),
    });
    const intent: OwnerIntent = {
      kind: 'investigate',
      text: 'There is a distressed seller in Kileleshwa',
      scope: SCOPE,
      correlationId: 'c2',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns[0]?.subMdId).toBe('vacancy.acquisitions-scout');
  });

  it('weekly report renders 4 growth KPI cards', async () => {
    const vp = createVpGrowth({ lineWorkerCatalogue: catalogue([]) });
    const report = await vp.draftWeeklyReport({
      scope: SCOPE,
      weekStartingIso: '2026-05-11',
      rollups: [],
    });
    expect(report.cards).toHaveLength(4);
    expect(report.cards.map((c) => c.title)).toContain('Renewal rate');
  });
});
