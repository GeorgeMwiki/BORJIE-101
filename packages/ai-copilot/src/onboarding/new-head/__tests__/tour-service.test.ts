import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryTourRepository,
  NewHeadTourService,
  TOUR_STEPS_TOTAL,
  TOUR_STEP_ORDER,
  composeTour,
} from '../index.js';
import type { TourComposerInputs } from '../index.js';
import type { Exception } from '../../../autonomy/exception-inbox.js';
import type { PortfolioHealth } from '../../../autonomy/briefing-generator.js';

const TENANT = 'tenant_tour_1';
const HEAD = 'user_head_1';

function fixtureHealth(): PortfolioHealth {
  return {
    occupancyPct: 92.1,
    collectionsPct: 94.5,
    arrearsRatioPct: 12.2,
    maintenanceSpendMinorUnits: 450_000,
    satisfactionScore: 0.78,
  };
}

function fixtureException(id: string, priority: Exception['priority']): Exception {
  return {
    id,
    tenantId: TENANT,
    domain: 'finance',
    kind: 'refund_big',
    priority,
    title: `Exception ${id}`,
    description: 'fixture',
    amountMinorUnits: null,
    dueAt: null,
    strategicWeight: 0,
    recommendedAction: null,
    evidenceRefs: [],
    status: 'open',
    resolutionDecision: null,
    resolutionNote: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  };
}

function makeService() {
  const repo = new InMemoryTourRepository();
  const service = new NewHeadTourService({
    repository: repo,
    clock: () => new Date('2026-04-21T12:00:00.000Z'),
  });
  return { repo, service };
}

function fixtureInputs(overrides: Partial<TourComposerInputs> = {}): TourComposerInputs {
  return {
    portfolioHealth: fixtureHealth(),
    pendingInbox: [fixtureException('e1', 'P1'), fixtureException('e2', 'P2')],
    pendingInboxTotal: 7,
    ...overrides,
  };
}

describe('NewHeadTourService', () => {
  it('startTour() creates a 5-step tour with payload', async () => {
    const { service } = makeService();
    const state = await service.startTour(TENANT, HEAD, fixtureInputs());
    expect(state.steps).toHaveLength(TOUR_STEPS_TOTAL);
    expect(state.currentStepId).toBe(TOUR_STEP_ORDER[0]);
    expect(state.payload?.pendingInboxCount).toBe(7);
    expect(state.payload?.portfolioHealth).not.toBeNull();
    expect(state.completedAt).toBeNull();
  });

  it('startTour() resumes an in-progress tour instead of creating a new one', async () => {
    const { service } = makeService();
    const first = await service.startTour(TENANT, HEAD, fixtureInputs());
    const second = await service.startTour(TENANT, HEAD, fixtureInputs());
    expect(second.id).toBe(first.id);
  });

  it('advanceStep() walks through all 5 steps and marks completed', async () => {
    const { service } = makeService();
    const start = await service.startTour(TENANT, HEAD, fixtureInputs());
    let last = start;
    for (const stepId of TOUR_STEP_ORDER) {
      const res = await service.advanceStep(TENANT, start.id, stepId, 'viewed');
      last = res.state;
    }
    expect(last.completedAt).not.toBeNull();
    expect(last.steps.every((s) => s.status !== 'pending')).toBe(true);
  });

  it('advanceStep() can skip optional steps but rejects skipping required ones', async () => {
    const { service } = makeService();
    const start = await service.startTour(TENANT, HEAD, fixtureInputs());
    // portfolio_summary is required.
    await expect(
      service.advanceStep(TENANT, start.id, 'portfolio_summary', 'skipped'),
    ).rejects.toThrow(/cannot skip/);
    // first_week_tasks is optional.
    const res = await service.advanceStep(TENANT, start.id, 'first_week_tasks', 'skipped');
    const skippedStep = res.state.steps.find((s) => s.id === 'first_week_tasks');
    expect(skippedStep?.status).toBe('skipped');
  });

  it('resumes mid-tour: advancing step 2 still advances toward step 3', async () => {
    const { service } = makeService();
    const start = await service.startTour(TENANT, HEAD, fixtureInputs());
    await service.advanceStep(TENANT, start.id, 'portfolio_summary', 'viewed');
    const resumed = await service.getTour(TENANT, HEAD);
    expect(resumed?.currentStepId).toBe('pending_inbox');
  });

  it('completeTour() marks remaining pending required as completed + optional as skipped', async () => {
    const { service } = makeService();
    const start = await service.startTour(TENANT, HEAD, fixtureInputs());
    // View just step 1, then force-complete.
    await service.advanceStep(TENANT, start.id, 'portfolio_summary', 'viewed');
    const done = await service.completeTour(TENANT, start.id);
    expect(done.state.completedAt).not.toBeNull();
    expect(done.outcome).toBe('completed');
    const required = done.state.steps.find((s) => s.id === 'pending_inbox');
    expect(required?.status).toBe('completed');
    const optional = done.state.steps.find((s) => s.id === 'first_week_tasks');
    expect(optional?.status).toBe('skipped');
  });

  it('composeTour() falls back to a placeholder summary when no portfolio health is known', () => {
    const payload = composeTour({
      portfolioHealth: null,
      pendingInbox: [],
      pendingInboxTotal: 0,
    });
    expect(payload.portfolioSummary).toMatch(/Gathering/);
    expect(payload.firstWeekTasks.length).toBeGreaterThan(0);
    expect(payload.delegationMatrix.totalCells).toBe(66);
  });
});
