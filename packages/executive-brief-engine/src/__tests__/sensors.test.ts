import { describe, expect, it } from 'vitest';
import { gatherSignals, groupSignalsBySensor } from '../sensors.js';
import type { SensorBundle, SensorSignal } from '../sensors.js';

const NOW = new Date('2026-05-22T06:00:00.000Z');

function makeBundle(overrides: Partial<SensorBundle> = {}): SensorBundle {
  const empty = async (): Promise<ReadonlyArray<SensorSignal>> => [];
  return {
    ledger: { ledgerHealth: empty },
    arrears: { arrearsTrend: empty },
    complaints: { complaintVolume: empty },
    audit: { anomalies: empty },
    contracts: { upcomingExpirations: empty },
    kpi: { kpiDeltas: empty },
    ...overrides,
  };
}

describe('gatherSignals', () => {
  it('returns empty signals when all sensors return empty', async () => {
    const r = await gatherSignals({
      tenantId: 't',
      periodStart: NOW,
      periodEnd: NOW,
      sensors: makeBundle(),
    });
    expect(r.signals).toEqual([]);
    expect(r.failedSensors).toEqual([]);
  });

  it('combines signals from all sensors', async () => {
    const r = await gatherSignals({
      tenantId: 't',
      periodStart: NOW,
      periodEnd: NOW,
      sensors: makeBundle({
        ledger: {
          async ledgerHealth() {
            return [
              {
                sensor: 'ledger',
                metric: 'collection_rate',
                value: 0.82,
                timestamp: NOW,
                evidenceRefs: [],
              },
            ];
          },
        },
        arrears: {
          async arrearsTrend() {
            return [
              {
                sensor: 'arrears',
                metric: 'overdue_count',
                value: 5,
                timestamp: NOW,
                evidenceRefs: [{ kind: 'entity', id: 'ent_a' }],
              },
            ];
          },
        },
      }),
    });
    expect(r.signals).toHaveLength(2);
    expect(r.failedSensors).toEqual([]);
  });

  it('marks failed sensors without breaking the sweep', async () => {
    const r = await gatherSignals({
      tenantId: 't',
      periodStart: NOW,
      periodEnd: NOW,
      sensors: makeBundle({
        ledger: {
          async ledgerHealth() {
            throw new Error('ledger down');
          },
        },
        arrears: {
          async arrearsTrend() {
            return [
              {
                sensor: 'arrears',
                metric: 'x',
                value: 1,
                timestamp: NOW,
                evidenceRefs: [],
              },
            ];
          },
        },
      }),
    });
    expect(r.signals).toHaveLength(1);
    expect(r.failedSensors).toContain('ledger');
  });
});

describe('groupSignalsBySensor', () => {
  it('buckets signals by their sensor key', () => {
    const g = groupSignalsBySensor([
      { sensor: 'a', metric: 'x', value: 1, timestamp: NOW, evidenceRefs: [] },
      { sensor: 'b', metric: 'y', value: 2, timestamp: NOW, evidenceRefs: [] },
      { sensor: 'a', metric: 'z', value: 3, timestamp: NOW, evidenceRefs: [] },
    ]);
    expect(g.a).toHaveLength(2);
    expect(g.b).toHaveLength(1);
  });
});
