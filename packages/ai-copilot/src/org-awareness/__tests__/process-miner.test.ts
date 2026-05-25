import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessObservationStore,
  createProcessMiner,
  percentile,
  buildStageStats,
} from '../index.js';

describe('process-miner', () => {
  let store: InMemoryProcessObservationStore;
  let miner: ReturnType<typeof createProcessMiner>;
  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';

  beforeEach(() => {
    store = new InMemoryProcessObservationStore();
    miner = createProcessMiner({ store });
  });

  it('percentile helper returns correct p50/p95', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBeGreaterThanOrEqual(50);
    expect(percentile(values, 95)).toBeGreaterThanOrEqual(95);
  });

  it('buildStageStats computes avg and variance', () => {
    const s = buildStageStats('triaged', [1000, 2000, 3000]);
    expect(s.avgMs).toBe(2000);
    expect(s.p50Ms).toBe(2000);
    expect(s.sampleSize).toBe(3);
    expect(s.varianceMs).toBeGreaterThan(0);
  });

  it('aggregates stats for a synthetic maintenance stream', async () => {
    const durations = [
      1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 50_000,
    ];
    for (let i = 0; i < durations.length; i++) {
      await miner.observe({
        tenantId: tenantA,
        processKind: 'maintenance_case',
        processInstanceId: `case-${i}`,
        stage: 'triaged',
        previousStage: 'reported',
        actorKind: 'human',
        durationMsFromPrevious: durations[i],
      });
    }
    const stats = await miner.getProcessStats(tenantA, 'maintenance_case');
    expect(stats.totalObservations).toBe(durations.length);
    expect(stats.stages.length).toBe(1);
    const [stage] = stats.stages;
    expect(stage.sampleSize).toBe(durations.length);
    expect(stage.p95Ms).toBeGreaterThan(stage.p50Ms);
    expect(stage.p99Ms).toBeGreaterThanOrEqual(stage.p95Ms);
  });

  it('tracks reopen rate per distinct instance', async () => {
    for (let i = 0; i < 10; i++) {
      await miner.observe({
        tenantId: tenantA,
        processKind: 'maintenance_case',
        processInstanceId: `case-${i}`,
        stage: 'resolved',
        actorKind: 'human',
      });
    }
    await miner.observe({
      tenantId: tenantA,
      processKind: 'maintenance_case',
      processInstanceId: 'case-0',
      stage: 'reopened',
      actorKind: 'tenant',
      isReopen: true,
    });
    const stats = await miner.getProcessStats(tenantA, 'maintenance_case');
    expect(stats.distinctInstances).toBe(10);
    expect(stats.reopenRate).toBeCloseTo(0.1, 5);
  });

  it('counts stuck instances separately from variant distribution', async () => {
    await miner.observe({
      tenantId: tenantA,
      processKind: 'maintenance_case',
      processInstanceId: 'case-stuck',
      stage: 'assigned',
      actorKind: 'human',
      isStuck: true,
      variant: 'stuck_path',
    });
    await miner.observe({
      tenantId: tenantA,
      processKind: 'maintenance_case',
      processInstanceId: 'case-ok',
      stage: 'assigned',
      actorKind: 'human',
    });
    const stats = await miner.getProcessStats(tenantA, 'maintenance_case');
    expect(stats.stuckInstances).toBe(1);
    expect(stats.variantDistribution.stuck_path).toBe(1);
    expect(stats.variantDistribution.standard).toBe(1);
  });

  it('returns zeroed stats when no observations exist', async () => {
    const stats = await miner.getProcessStats(tenantA, 'lease_renewal');
    expect(stats.totalObservations).toBe(0);
    expect(stats.distinctInstances).toBe(0);
    expect(stats.reopenRate).toBe(0);
    expect(stats.stages).toEqual([]);
  });

  it('isolates tenants strictly', async () => {
    await miner.observe({
      tenantId: tenantA,
      processKind: 'maintenance_case',
      processInstanceId: 'case-a',
      stage: 'resolved',
      actorKind: 'human',
    });
    await miner.observe({
      tenantId: tenantB,
      processKind: 'maintenance_case',
      processInstanceId: 'case-b',
      stage: 'resolved',
      actorKind: 'human',
    });
    const statsA = await miner.getProcessStats(tenantA, 'maintenance_case');
    const statsB = await miner.getProcessStats(tenantB, 'maintenance_case');
    expect(statsA.distinctInstances).toBe(1);
    expect(statsB.distinctInstances).toBe(1);
  });

  it('detects emergency variant from instance metadata', async () => {
    await miner.observe({
      tenantId: tenantA,
      processKind: 'maintenance_case',
      processInstanceId: 'case-fire',
      stage: 'reported',
      actorKind: 'tenant',
      metadata: { priority: 'emergency' },
    });
    const variant = await miner.detectVariant(
      tenantA,
      'maintenance_case',
      'case-fire',
    );
    expect(variant).toBe('emergency');
  });

  it('falls back to standard variant when no signal present', async () => {
    await miner.observe({
      tenantId: tenantA,
      processKind: 'maintenance_case',
      processInstanceId: 'case-regular',
      stage: 'reported',
      actorKind: 'tenant',
    });
    const variant = await miner.detectVariant(
      tenantA,
      'maintenance_case',
      'case-regular',
    );
    expect(variant).toBe('standard');
  });
});
