import { describe, expect, it } from 'vitest';
import { createVpFinance } from '../index.js';
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

describe('vp.finance — orchestrate', () => {
  it('routes an arrears intent to arrears.chaser', async () => {
    const vp = createVpFinance({
      lineWorkerCatalogue: catalogue(['arrears.chaser']),
    });
    const intent: OwnerIntent = {
      kind: 'investigate',
      text: 'Show me the overdue tenants',
      scope: SCOPE,
      correlationId: 'c1',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns).toHaveLength(1);
    expect(plan.spawns[0]?.subMdId).toBe('arrears.chaser');
  });

  it('records external-comm risk-tier for missing KRA filing assistant', async () => {
    const vp = createVpFinance({ lineWorkerCatalogue: catalogue([]) });
    const intent: OwnerIntent = {
      kind: 'remediate',
      text: 'Please prepare the KRA MRI filing for this month',
      scope: SCOPE,
      correlationId: 'c2',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]?.missingLineWorker).toBe('kra.filing-assistant');
    expect(plan.gaps[0]?.suggestedRiskTier).toBe('external-comm');
  });

  it('weekly report renders 4 finance KPI cards', async () => {
    const vp = createVpFinance({ lineWorkerCatalogue: catalogue([]) });
    const report = await vp.draftWeeklyReport({
      scope: SCOPE,
      weekStartingIso: '2026-05-11',
      rollups: [
        {
          lineWorker: 'arrears.chaser',
          outcome: 'attention',
          metric: 'open-arrears',
          value: 125_000,
          notes: 'spike vs prior week',
        },
      ],
    });
    expect(report.cards).toHaveLength(4);
    expect(report.cards.map((c) => c.title)).toContain('Arrears');
    expect(report.riskCallouts.length).toBe(1);
  });
});
