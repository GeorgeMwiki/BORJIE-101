import { describe, expect, it } from 'vitest';
import { createVpOperations } from '../index.js';
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
  return {
    has: ({ name }) => known.includes(name),
  };
}

describe('vp.operations — orchestrate', () => {
  it('routes a maintenance complaint to maintenance.dispatch', async () => {
    const vp = createVpOperations({
      lineWorkerCatalogue: catalogue(['maintenance.dispatch']),
    });
    const intent: OwnerIntent = {
      kind: 'remediate',
      text: 'There is a leak in unit 3B',
      scope: SCOPE,
      correlationId: 'c1',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns).toHaveLength(1);
    expect(plan.spawns[0]?.subMdId).toBe('maintenance.dispatch');
    expect(plan.gaps).toHaveLength(0);
  });

  it('records a capability gap when the needed line-worker is missing', async () => {
    const vp = createVpOperations({
      lineWorkerCatalogue: catalogue([]), // nothing registered
    });
    const intent: OwnerIntent = {
      kind: 'remediate',
      text: 'Tenant is angry about noise',
      scope: SCOPE,
      correlationId: 'c2',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns).toHaveLength(0);
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]?.missingLineWorker).toBe('complaint.triage');
  });

  it('fans out to every line-worker on a status check when no keyword matches', async () => {
    const vp = createVpOperations({
      lineWorkerCatalogue: catalogue([
        'maintenance.dispatch',
        'complaint.triage',
        'tenant.onboarding-officer',
        'inspections.scheduler',
      ]),
    });
    const intent: OwnerIntent = {
      kind: 'status-check',
      text: 'How are we doing?',
      scope: SCOPE,
      correlationId: 'c3',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns.length).toBe(4);
  });

  it('renders a summary when no operational signal is present', async () => {
    const vp = createVpOperations({
      lineWorkerCatalogue: catalogue(['maintenance.dispatch']),
    });
    const intent: OwnerIntent = {
      kind: 'investigate',
      text: 'Tell me about the weather',
      scope: SCOPE,
      correlationId: 'c4',
    };
    const plan = await vp.orchestrate(intent);
    expect(plan.spawns).toHaveLength(0);
    expect(plan.summary).toMatch(/did not find/i);
  });
});

describe('vp.operations — weekly report', () => {
  it('renders 4 KPI cards and surfaces breached rollups as risk callouts', async () => {
    const vp = createVpOperations({
      lineWorkerCatalogue: catalogue([]),
    });
    const report = await vp.draftWeeklyReport({
      scope: SCOPE,
      weekStartingIso: '2026-05-11',
      rollups: [
        {
          lineWorker: 'maintenance.dispatch',
          outcome: 'on-track',
          metric: 'sla-hit-rate',
          value: 92,
          notes: 'within target',
        },
        {
          lineWorker: 'complaint.triage',
          outcome: 'breached',
          metric: 'avg-resolution-hours',
          value: 48,
          notes: 'doubled vs last week',
        },
      ],
    });
    expect(report.cards).toHaveLength(4);
    expect(report.riskCallouts.length).toBeGreaterThan(0);
    expect(report.reportsTo).toBe('owner');
  });
});
