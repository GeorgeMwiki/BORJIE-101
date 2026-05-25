import { describe, expect, it } from 'vitest';
import { createVpRiskCompliance } from '../index.js';
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

describe('vp.risk-compliance — orchestrate', () => {
  it('routes a regulator filing intent to compliance.filing-monitor', async () => {
    const vp = createVpRiskCompliance({
      lineWorkerCatalogue: catalogue(['compliance.filing-monitor']),
    });
    const intent: OwnerIntent = {
      kind: 'investigate',
      text: 'When is our next county regulator filing deadline?',
      scope: SCOPE,
      correlationId: 'c1',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns[0]?.subMdId).toBe('compliance.filing-monitor');
  });

  it('records gap for missing dispute.mediator stub with read-tier suggestion', async () => {
    const vp = createVpRiskCompliance({ lineWorkerCatalogue: catalogue([]) });
    const intent: OwnerIntent = {
      kind: 'remediate',
      text: 'Tenant filed a small claims tribunal dispute',
      scope: SCOPE,
      correlationId: 'c2',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]?.missingLineWorker).toBe('dispute.mediator');
    expect(plan.gaps[0]?.suggestedRiskTier).toBe('read');
  });

  it('weekly report renders 3 risk-compliance KPI cards', async () => {
    const vp = createVpRiskCompliance({ lineWorkerCatalogue: catalogue([]) });
    const report = await vp.draftWeeklyReport({
      scope: SCOPE,
      weekStartingIso: '2026-05-11',
      rollups: [],
    });
    expect(report.cards).toHaveLength(3);
    expect(report.cards.map((c) => c.title)).toContain('Dispute log');
  });
});
