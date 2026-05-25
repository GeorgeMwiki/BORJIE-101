/**
 * Public surface integration tests — createStageAdvisor end-to-end
 * via the in-memory db.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createStageAdvisor,
  createInMemoryStageAdvisorDb,
  defaultOrgState,
} from '../index.js';
import type {
  OrgMetrics,
  OrgState,
  PersistedStageState,
  StageTriggerSink,
} from '../types.js';

function metricsFor(over?: Partial<OrgMetrics>): OrgMetrics {
  return {
    tenantId: 'tn-1',
    unitsManaged: 5,
    activeUsers: 2,
    monthlyRevenue: 100_000,
    currency: 'KES',
    ageMonths: 6,
    regionCount: 1,
    tenantChurnRate: 0.04,
    observedAt: '2026-05-24T00:00:00Z',
    ...over,
  };
}

describe('createStageAdvisor — port returns current stage', () => {
  it('returns null when no metrics exist', async () => {
    const db = createInMemoryStageAdvisorDb();
    const advisor = createStageAdvisor({ db });
    const ctx = await advisor.port.getCurrentStage('tn-unknown');
    expect(ctx).toBeNull();
  });

  it('returns context when metrics exist', async () => {
    const db = createInMemoryStageAdvisorDb({
      metrics: { 'tn-1': metricsFor() },
    });
    const advisor = createStageAdvisor({ db });
    const ctx = await advisor.port.getCurrentStage('tn-1');
    expect(ctx?.stage).toBe('seedling');
    expect(ctx?.confidence).toBeGreaterThan(0.5);
  });
});

describe('createStageAdvisor — detectAndPersist', () => {
  it('persists state and computes the transition when stage changes', async () => {
    const initialPrev: PersistedStageState = {
      tenantId: 'tn-1',
      currentStage: 'sprout',
      currentStageSince: '2026-04-01T00:00:00Z',
      candidateStage: 'sapling',
      candidateStageSince: '2026-04-01T00:00:00Z',
    };
    const db = createInMemoryStageAdvisorDb({
      metrics: { 'tn-1': metricsFor({ unitsManaged: 75 }) },
      persistedStates: { 'tn-1': initialPrev },
    });
    const advisor = createStageAdvisor({ db });
    const out = await advisor.detectAndPersist({
      tenantId: 'tn-1',
      nowIso: '2026-05-15T00:00:00Z', // > 30 days since candidate
    });
    expect(out.detection.stage).toBe('sapling');
    expect(out.state.currentStage).toBe('sapling');
    expect(out.transition?.kind).toBe('grow');
    expect(out.transition?.to).toBe('sapling');
  });

  it('throws when there are no metrics to detect from', async () => {
    const db = createInMemoryStageAdvisorDb();
    const advisor = createStageAdvisor({ db });
    await expect(
      advisor.detectAndPersist({ tenantId: 'tn-missing' }),
    ).rejects.toThrow(/no metrics/);
  });
});

describe('createStageAdvisor — getPlaybookView', () => {
  it('returns the right playbook for the org stage', async () => {
    const orgState: OrgState = {
      ...defaultOrgState('tn-1'),
      orgSetupComplete: true,
      propertyCount: 1,
    };
    const db = createInMemoryStageAdvisorDb({
      metrics: { 'tn-1': metricsFor({ unitsManaged: 60 }) },
      orgStates: { 'tn-1': orgState },
    });
    const advisor = createStageAdvisor({ db });
    const view = await advisor.getPlaybookView('tn-1');
    expect(view?.stage).toBe('sapling');
    expect(view?.evaluation.totalTasks).toBeGreaterThanOrEqual(3);
  });
});

describe('createStageAdvisor — getGatingForRole', () => {
  it('returns role-aware gating result', async () => {
    const db = createInMemoryStageAdvisorDb({
      metrics: { 'tn-1': metricsFor({ unitsManaged: 60 }) },
    });
    const advisor = createStageAdvisor({ db });
    const gate = await advisor.getGatingForRole('tn-1', 'admin');
    expect(gate?.unlocked).toContain('procurement-coordination');
  });

  it('tenant role hides ops capabilities', async () => {
    const db = createInMemoryStageAdvisorDb({
      metrics: { 'tn-1': metricsFor({ unitsManaged: 60 }) },
    });
    const advisor = createStageAdvisor({ db });
    const gate = await advisor.getGatingForRole('tn-1', 'tenant');
    expect(gate?.unlocked).not.toContain('procurement-coordination');
  });
});

describe('createStageAdvisor — generateNudges + trigger sink', () => {
  it('emits HIGH urgency nudges through the trigger sink when emit=true', async () => {
    const orgState: OrgState = {
      ...defaultOrgState('tn-1'),
      // leave incomplete to encourage nudges
    };
    const db = createInMemoryStageAdvisorDb({
      metrics: {
        'tn-1': metricsFor({ unitsManaged: 5, tenantChurnRate: 0.2 }),
      },
      orgStates: { 'tn-1': orgState },
    });
    const sink: StageTriggerSink = { emit: vi.fn(async () => {}) };
    const advisor = createStageAdvisor({ db, triggers: sink });
    const nudges = await advisor.generateNudges({
      tenantId: 'tn-1',
      emit: true,
    });
    expect(nudges.length).toBeGreaterThan(0);
    expect(sink.emit).toHaveBeenCalled();
  });

  it('respects dismissals', async () => {
    const orgState: OrgState = defaultOrgState('tn-1');
    const db = createInMemoryStageAdvisorDb({
      metrics: { 'tn-1': metricsFor() },
      orgStates: { 'tn-1': orgState },
    });
    const advisor = createStageAdvisor({ db });
    const first = await advisor.generateNudges({ tenantId: 'tn-1' });
    expect(first.length).toBeGreaterThan(0);
    const target = first[0]!;
    await advisor.dismissNudge({ tenantId: 'tn-1', nudgeId: target.id });
    const second = await advisor.generateNudges({ tenantId: 'tn-1' });
    expect(second.find((n) => n.id === target.id)).toBeUndefined();
  });
});

describe('createStageAdvisor — history', () => {
  it('returns empty history by default', async () => {
    const db = createInMemoryStageAdvisorDb();
    const advisor = createStageAdvisor({ db });
    const hist = await advisor.getHistory('tn-1');
    expect(hist).toEqual([]);
  });

  it('records transitions after detectAndPersist', async () => {
    const initialPrev: PersistedStageState = {
      tenantId: 'tn-1',
      currentStage: 'sprout',
      currentStageSince: '2026-04-01T00:00:00Z',
      candidateStage: 'sapling',
      candidateStageSince: '2026-04-01T00:00:00Z',
    };
    const db = createInMemoryStageAdvisorDb({
      metrics: { 'tn-1': metricsFor({ unitsManaged: 75 }) },
      persistedStates: { 'tn-1': initialPrev },
    });
    const advisor = createStageAdvisor({ db });
    await advisor.detectAndPersist({
      tenantId: 'tn-1',
      nowIso: '2026-05-15T00:00:00Z',
    });
    const hist = await advisor.getHistory('tn-1');
    expect(hist.length).toBe(1);
    expect(hist[0]?.kind).toBe('grow');
  });
});

describe('createStageAdvisor — defaultOrgState', () => {
  it('creates a zeroed state struct', () => {
    const s = defaultOrgState('tn-1');
    expect(s.tenantId).toBe('tn-1');
    expect(s.propertyCount).toBe(0);
    expect(s.orgSetupComplete).toBe(false);
  });
});
