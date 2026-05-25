import { describe, expect, it } from 'vitest';
import { createVpPeople } from '../index.js';
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

describe('vp.people — orchestrate', () => {
  it('routes vendor intents to vendor.onboarding', async () => {
    const vp = createVpPeople({
      lineWorkerCatalogue: catalogue(['vendor.onboarding']),
    });
    const intent: OwnerIntent = {
      kind: 'remediate',
      text: 'Onboard a new plumbing contractor',
      scope: SCOPE,
      correlationId: 'c1',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns[0]?.subMdId).toBe('vendor.onboarding');
  });

  it('records gap for missing employee-coordinator stub', async () => {
    const vp = createVpPeople({ lineWorkerCatalogue: catalogue([]) });
    const intent: OwnerIntent = {
      kind: 'remediate',
      text: 'Hire a new caretaker employee',
      scope: SCOPE,
      correlationId: 'c2',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]?.missingLineWorker).toBe('employee-coordinator');
  });

  it('weekly report renders 3 people KPI cards', async () => {
    const vp = createVpPeople({ lineWorkerCatalogue: catalogue([]) });
    const report = await vp.draftWeeklyReport({
      scope: SCOPE,
      weekStartingIso: '2026-05-11',
      rollups: [],
    });
    expect(report.cards).toHaveLength(3);
    expect(report.cards.map((c) => c.title)).toContain('Payroll on-time');
  });
});
