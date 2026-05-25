import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryBottleneckStore,
  InMemoryProcessObservationStore,
  createBottleneckDetector,
  createProcessMiner,
} from '../index.js';

describe('bottleneck-detector', () => {
  const tenant = 'tenant-alpha';
  let obsStore: InMemoryProcessObservationStore;
  let btnStore: InMemoryBottleneckStore;
  let detector: ReturnType<typeof createBottleneckDetector>;

  beforeEach(() => {
    obsStore = new InMemoryProcessObservationStore();
    btnStore = new InMemoryBottleneckStore();
    const miner = createProcessMiner({ store: obsStore });
    detector = createBottleneckDetector({
      observationStore: obsStore,
      bottleneckStore: btnStore,
      miner,
    });
  });

  it('identifies a chronic-slow stage when p95 > 3× p50', async () => {
    const durations = [
      1000, 1200, 1100, 1300, 900, 1000, 1050, 1100, 1000, 100_000,
    ];
    for (let i = 0; i < durations.length; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'assigned',
        actorKind: 'human',
        durationMsFromPrevious: durations[i],
      });
    }
    const surfaced = await detector.detectForTenant(tenant);
    expect(
      surfaced.some(
        (b) =>
          b.bottleneckKind === 'chronic_slow' && b.stage === 'assigned',
      ),
    ).toBe(true);
  });

  it('ranks severity P1 when p95 is more than 5× p50', async () => {
    const durations = [
      1000, 1000, 1100, 1000, 1000, 1000, 1000, 1000, 1000, 200_000,
    ];
    for (let i = 0; i < durations.length; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'assigned',
        actorKind: 'human',
        durationMsFromPrevious: durations[i],
      });
    }
    const surfaced = await detector.detectForTenant(tenant);
    const chronic = surfaced.find((b) => b.bottleneckKind === 'chronic_slow');
    expect(chronic?.severity).toBe('P1');
  });

  it('detects stalled hand-offs past 48h', async () => {
    const now = new Date('2026-04-18T10:00:00Z');
    const stalledAt = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    await obsStore.append({
      tenantId: tenant,
      processKind: 'approval_decision',
      processInstanceId: 'a-1',
      stage: 'pending_signoff',
      actorKind: 'human',
      observedAt: stalledAt,
    });
    const miner = createProcessMiner({ store: obsStore });
    const localDetector = createBottleneckDetector({
      observationStore: obsStore,
      bottleneckStore: btnStore,
      miner,
      now: () => now,
    });
    const findings = await localDetector.detectForProcess(
      tenant,
      'approval_decision',
    );
    expect(
      findings.some((f) => f.bottleneckKind === 'stalled_handoff'),
    ).toBe(true);
  });

  it('flags high re-open rate as a bottleneck', async () => {
    for (let i = 0; i < 10; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'resolved',
        actorKind: 'human',
      });
    }
    for (let i = 0; i < 4; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'reopened',
        actorKind: 'tenant',
        isReopen: true,
      });
    }
    const surfaced = await detector.detectForTenant(tenant);
    const reopen = surfaced.find(
      (b) => b.bottleneckKind === 'high_reopen_rate',
    );
    expect(reopen).toBeDefined();
    expect(reopen?.severity === 'P1' || reopen?.severity === 'P2').toBe(true);
  });

  it('respects cooldown on repeated detection (upsert on open signature)', async () => {
    for (let i = 0; i < 10; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'assigned',
        actorKind: 'human',
        durationMsFromPrevious: i === 9 ? 100_000 : 1000,
      });
    }
    await detector.detectForTenant(tenant);
    const before = await btnStore.listOpen(tenant);
    await detector.detectForTenant(tenant);
    const after = await btnStore.listOpen(tenant);
    expect(after.length).toBe(before.length);
  });

  it('returns empty list when insufficient samples', async () => {
    await obsStore.append({
      tenantId: tenant,
      processKind: 'maintenance_case',
      processInstanceId: 'c-1',
      stage: 'assigned',
      actorKind: 'human',
      durationMsFromPrevious: 1000,
    });
    const findings = await detector.detectForProcess(
      tenant,
      'maintenance_case',
    );
    expect(findings.filter((f) => f.bottleneckKind === 'chronic_slow'))
      .toHaveLength(0);
  });

  it('isolates bottlenecks per tenant', async () => {
    const other = 'tenant-beta';
    for (let i = 0; i < 10; i++) {
      await obsStore.append({
        tenantId: tenant,
        processKind: 'maintenance_case',
        processInstanceId: `c-${i}`,
        stage: 'assigned',
        actorKind: 'human',
        durationMsFromPrevious: i === 9 ? 200_000 : 1000,
      });
    }
    await detector.detectForTenant(tenant);
    const list = await btnStore.listOpen(other);
    expect(list).toHaveLength(0);
  });
});
