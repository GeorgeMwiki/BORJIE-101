import { describe, it, expect } from 'vitest';
import { createProgressTracker } from '../progress/progress-tracker.js';
import { createInMemoryObjectiveProgressRepository } from '../repositories/objective-progress-repository.js';
import type { NorthStar } from '../types.js';

function makeTracker(startMs = 1_800_000_000_000) {
  const repo = createInMemoryObjectiveProgressRepository();
  let nowMs = startMs;
  const tracker = createProgressTracker({
    repo,
    now: () => new Date(nowMs),
  });
  return {
    repo,
    tracker,
    advanceDays: (d: number) => (nowMs += d * 24 * 60 * 60 * 1000),
    setNowMs: (ms: number) => (nowMs = ms),
  };
}

const baseObjective: NorthStar = Object.freeze({
  id: 'obj-1',
  tenantId: 't1',
  scopeId: 'tenant_root',
  title: 'Royalty revenue ≥ 1B TZS by 2026-09-30',
  description: 'Quarterly target',
  metricName: 'royalty_revenue_tzs',
  targetValue: 1_000_000_000,
  // 100 days after the test-start clock.
  targetAt: new Date(1_800_000_000_000 + 100 * 24 * 60 * 60 * 1000).toISOString(),
  status: 'active',
  ownerUserId: 'owner-1',
  createdAt: new Date(1_800_000_000_000).toISOString(),
  updatedAt: new Date(1_800_000_000_000).toISOString(),
  auditHash: 'h0'.padEnd(64, '0'),
  prevHash: null,
});

describe('ProgressTracker — observe + drift signal', () => {
  it('records an observation and surfaces it through `latest`', async () => {
    const { repo, tracker } = makeTracker();
    const row = await tracker.observe({
      tenantId: 't1',
      objectiveId: 'obj-1',
      observedValue: 250_000_000,
      evidence: { source: 'royalty_ledger', cite: 'evidence-001' },
    });
    expect(row.observedValue).toBe(250_000_000);
    expect(row.auditHash.length).toBe(64);
    const latest = await repo.latest('t1', 'obj-1');
    expect(latest?.id).toBe(row.id);
  });

  it('returns `on_track` when velocity comfortably closes the gap', async () => {
    const { tracker, advanceDays } = makeTracker();
    // 0% complete at day 0, 50% at day 30 — projected to close at day 60,
    // well inside the 100-day target horizon.
    await tracker.observe({
      tenantId: 't1',
      objectiveId: 'obj-1',
      observedValue: 0,
    });
    advanceDays(30);
    await tracker.observe({
      tenantId: 't1',
      objectiveId: 'obj-1',
      observedValue: 500_000_000,
    });
    const signal = await tracker.driftSignal('t1', baseObjective);
    expect(signal).toBe('on_track');
  });

  it('returns `off_track` when velocity is too slow to meet target', async () => {
    const { tracker, advanceDays } = makeTracker();
    // 5% complete at day 0 + 50, projected to close many quarters later.
    await tracker.observe({
      tenantId: 't1',
      objectiveId: 'obj-1',
      observedValue: 10_000_000,
    });
    advanceDays(50);
    await tracker.observe({
      tenantId: 't1',
      objectiveId: 'obj-1',
      observedValue: 50_000_000,
    });
    const signal = await tracker.driftSignal('t1', baseObjective);
    // remaining = 950M, vel = 40M/50d = 800k/day, daysNeeded ≈ 1187,
    // daysAvailable = 50, ratio ≈ 23.7 → off_track.
    expect(signal).toBe('off_track');
  });

  it('returns `off_track` when the velocity goes negative', async () => {
    const { tracker, advanceDays } = makeTracker();
    await tracker.observe({
      tenantId: 't1',
      objectiveId: 'obj-1',
      observedValue: 600_000_000,
    });
    advanceDays(10);
    await tracker.observe({
      tenantId: 't1',
      objectiveId: 'obj-1',
      observedValue: 500_000_000,
    });
    const signal = await tracker.driftSignal('t1', baseObjective);
    expect(signal).toBe('off_track');
  });
});
