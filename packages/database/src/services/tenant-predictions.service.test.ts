/**
 * Unit tests for createTenantPredictionsService.
 *
 * Covers insertPrediction, insertOpportunity, list* read paths, status
 * parsing, and graceful degradation on DB errors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTenantPredictionsService,
  type InterventionOpportunityShape,
  type TenantPredictionShape,
} from './tenant-predictions.service.js';
import type { DatabaseClient } from '../client.js';

interface StubOptions {
  failInsert?: boolean;
  failSelect?: boolean;
  selectRows?: ReadonlyArray<unknown>;
}

interface CapturedInsert {
  table: 'predictions' | 'opportunities';
  values: Record<string, unknown>;
}

function makeStubDb(opts: StubOptions = {}): {
  client: DatabaseClient;
  readonly inserted: CapturedInsert[];
} {
  const inserted: CapturedInsert[] = [];
  let nextTable: 'predictions' | 'opportunities' = 'predictions';
  const client = {
    insert: (target: { _: { name?: string } } | unknown) => {
      const tableName =
        (target as { _?: { name?: string } })?._?.name ?? '';
      nextTable = tableName.includes('predictive_intervention')
        ? 'opportunities'
        : 'predictions';
      return {
        values: async (v: Record<string, unknown>) => {
          if (opts.failInsert) throw new Error('insert boom');
          inserted.push({ table: nextTable, values: v });
        },
      };
    },
    select: () => ({
      from: () => ({
        where: () => {
          const orderByImpl = () => {
            if (opts.failSelect) {
              const fail = Promise.reject(new Error('select boom'));
              fail.catch(() => undefined);
              return Object.assign(fail, {
                limit: () => {
                  const innerFail = Promise.reject(new Error('select boom'));
                  innerFail.catch(() => undefined);
                  return innerFail;
                },
              });
            }
            const promise = Promise.resolve(opts.selectRows ?? []);
            return Object.assign(promise, {
              limit: () => Promise.resolve(opts.selectRows ?? []),
            });
          };
          return { orderBy: orderByImpl };
        },
      }),
    }),
  } as unknown as DatabaseClient;
  return { client, get inserted() { return inserted; } } as never;
}

const samplePrediction: TenantPredictionShape = {
  id: 'tp1',
  tenantId: 't',
  customerId: 'c',
  horizonDays: 60,
  probPayOnTime: 0.6,
  probPayLate: 0.2,
  probDefault: 0.1,
  probChurn: 0.05,
  probDispute: 0.05,
  modelVersion: 'v1',
  confidence: 0.8,
  explanation: 'mostly stable; recent late payment',
  featureSnapshot: { arrearsDays: 5 },
  promptHash: null,
  computedAt: '2026-05-08T00:00:00Z',
};

const sampleOpportunity: InterventionOpportunityShape = {
  id: 'pio1',
  tenantId: 't',
  customerId: 'c',
  predictionId: 'tp1',
  signalType: 'high_default_risk',
  signalStrength: 0.78,
  suggestedAction: 'send a payment-plan offer',
  status: 'open',
  metadata: {},
  createdAt: '2026-05-08T00:00:00Z',
};

describe('createTenantPredictionsService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('insertPrediction() persists with correct shape and returns input', async () => {
    const stub = makeStubDb();
    const svc = createTenantPredictionsService(stub.client);
    const out = await svc.insertPrediction(samplePrediction);
    expect(stub.inserted).toHaveLength(1);
    expect(stub.inserted[0]?.values.id).toBe('tp1');
    expect(stub.inserted[0]?.values.horizonDays).toBe(60);
    expect(out.confidence).toBeCloseTo(0.8);
  });

  it('insertOpportunity() persists with correct shape and returns input', async () => {
    const stub = makeStubDb();
    const svc = createTenantPredictionsService(stub.client);
    const out = await svc.insertOpportunity(sampleOpportunity);
    expect(stub.inserted).toHaveLength(1);
    expect(stub.inserted[0]?.values.signalType).toBe('high_default_risk');
    expect(out.suggestedAction).toContain('payment-plan');
  });

  it('insert*() validate required fields', async () => {
    const stub = makeStubDb();
    const svc = createTenantPredictionsService(stub.client);
    await expect(
      svc.insertPrediction({ ...samplePrediction, id: '' }),
    ).rejects.toThrow(/requires/);
    await expect(
      svc.insertOpportunity({ ...sampleOpportunity, customerId: '' }),
    ).rejects.toThrow(/requires/);
  });

  it('insert*() rethrow DB errors', async () => {
    const stub = makeStubDb({ failInsert: true });
    const svc = createTenantPredictionsService(stub.client);
    await expect(svc.insertPrediction(samplePrediction)).rejects.toThrow();
    await expect(svc.insertOpportunity(sampleOpportunity)).rejects.toThrow();
  });

  it('listRecentPredictions() returns [] when args missing', async () => {
    const stub = makeStubDb();
    const svc = createTenantPredictionsService(stub.client);
    expect(await svc.listRecentPredictions('', 'c')).toEqual([]);
    expect(await svc.listRecentPredictions('t', '')).toEqual([]);
  });

  it('listRecentPredictions() returns [] on DB error', async () => {
    const stub = makeStubDb({ failSelect: true });
    const svc = createTenantPredictionsService(stub.client);
    expect(await svc.listRecentPredictions('t', 'c')).toEqual([]);
  });

  it('listRecentPredictions() coerces numerics and parses horizon', async () => {
    const stub = makeStubDb({
      selectRows: [
        {
          id: 'tp2',
          tenantId: 't',
          customerId: 'c',
          horizonDays: 30,
          probPayOnTime: '0.7',
          probPayLate: '0.15',
          probDefault: '0.1',
          probChurn: '0.03',
          probDispute: '0.02',
          modelVersion: 'v1',
          confidence: '0.9',
          explanation: null,
          featureSnapshot: { x: 1 },
          promptHash: null,
          computedAt: new Date('2026-05-08T00:00:00Z'),
        },
      ],
    });
    const svc = createTenantPredictionsService(stub.client);
    const rows = await svc.listRecentPredictions('t', 'c');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.probPayOnTime).toBeCloseTo(0.7);
    expect(rows[0]?.horizonDays).toBe(30);
    expect(rows[0]?.explanation).toBe('');
  });

  it('listOpenOpportunities() parses status and returns rows', async () => {
    const stub = makeStubDb({
      selectRows: [
        {
          id: 'pio2',
          tenantId: 't',
          customerId: 'c',
          predictionId: 'tp2',
          signalType: 'high_churn_risk',
          signalStrength: 0.66,
          suggestedAction: 'reach out',
          status: 'open',
          metadata: {},
          createdAt: '2026-05-08T00:00:00Z',
        },
      ],
    });
    const svc = createTenantPredictionsService(stub.client);
    const rows = await svc.listOpenOpportunities('t');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('open');
    expect(rows[0]?.signalType).toBe('high_churn_risk');
  });

  it('listOpenOpportunities() returns [] when tenantId missing', async () => {
    const stub = makeStubDb();
    const svc = createTenantPredictionsService(stub.client);
    expect(await svc.listOpenOpportunities('')).toEqual([]);
  });
});
