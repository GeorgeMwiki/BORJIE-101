import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryImprovementSnapshotStore,
  createImprovementTracker,
} from '../index.js';

describe('improvement-tracker', () => {
  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';
  let store: InMemoryImprovementSnapshotStore;
  let tracker: ReturnType<typeof createImprovementTracker>;

  beforeEach(() => {
    store = new InMemoryImprovementSnapshotStore();
    tracker = createImprovementTracker({ store });
  });

  it('records and retrieves a baseline snapshot', async () => {
    const snap = await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'arrears_ratio',
      periodKind: 'monthly',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
      value: 0.25,
      isBaseline: true,
      sampleSize: 100,
    });
    expect(snap.isBaseline).toBe(true);
    const baseline = await store.getBaseline(tenantA, 'arrears_ratio');
    expect(baseline?.value).toBe(0.25);
  });

  it('rejects non-finite values', async () => {
    await expect(
      tracker.recordSnapshot({
        tenantId: tenantA,
        metric: 'arrears_ratio',
        periodKind: 'monthly',
        periodStart: new Date(),
        periodEnd: new Date(),
        value: Number.NaN,
      }),
    ).rejects.toThrow();
  });

  it('diffs baseline vs latest into a report', async () => {
    await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'arrears_ratio',
      periodKind: 'monthly',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
      value: 0.3,
      isBaseline: true,
    });
    await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'arrears_ratio',
      periodKind: 'monthly',
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-04-30T23:59:59Z'),
      value: 0.2,
    });
    const report = await tracker.getImprovementReport(tenantA);
    expect(report.deltas).toHaveLength(1);
    const [delta] = report.deltas;
    expect(delta.metric).toBe('arrears_ratio');
    expect(delta.baselineValue).toBe(0.3);
    expect(delta.currentValue).toBe(0.2);
    expect(delta.direction).toBe('down');
    expect(delta.isBetter).toBe(true);
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it('treats downward change on higher-is-better metric as worse', async () => {
    await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'occupancy_rate',
      periodKind: 'monthly',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
      value: 0.9,
      isBaseline: true,
    });
    await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'occupancy_rate',
      periodKind: 'monthly',
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-04-30T23:59:59Z'),
      value: 0.85,
    });
    const report = await tracker.getImprovementReport(tenantA);
    const delta = report.deltas.find((d) => d.metric === 'occupancy_rate');
    expect(delta?.isBetter).toBe(false);
  });

  it('returns empty deltas when only a baseline exists', async () => {
    await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'arrears_ratio',
      periodKind: 'monthly',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
      value: 0.3,
      isBaseline: true,
    });
    const report = await tracker.getImprovementReport(tenantA);
    expect(report.deltas).toHaveLength(0);
    expect(report.baselineKind).toBe('none');
  });

  it('isolates per-tenant snapshots', async () => {
    await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'renewal_rate',
      periodKind: 'monthly',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-31T23:59:59Z'),
      value: 0.6,
      isBaseline: true,
    });
    await tracker.recordSnapshot({
      tenantId: tenantA,
      metric: 'renewal_rate',
      periodKind: 'monthly',
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-04-30T23:59:59Z'),
      value: 0.75,
    });
    const reportB = await tracker.getImprovementReport(tenantB);
    expect(reportB.deltas).toHaveLength(0);
  });

  it('buildPeriod produces sensible monthly windows', () => {
    const now = new Date('2026-04-18T10:00:00Z');
    const { periodStart, periodEnd } = tracker.buildPeriod(now, 'monthly');
    expect(periodStart.toISOString().startsWith('2026-04-01')).toBe(true);
    expect(periodEnd.getUTCDate()).toBeGreaterThanOrEqual(28);
  });
});
