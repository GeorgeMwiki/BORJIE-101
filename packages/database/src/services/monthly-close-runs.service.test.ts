/**
 * Unit tests for createMonthlyCloseRunsService.
 *
 * Stubs the Drizzle DatabaseClient so we can assert createRun, recordStep,
 * findStep, and read paths shape values correctly. Idempotency at the
 * (tenant, period) and (run_id, step_name) levels is enforced by the
 * schema's UNIQUE indexes — those are integration concerns, not covered
 * here. We verify the service threads runId/tenantId correctly and that
 * read paths degrade to safe defaults on DB error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMonthlyCloseRunsService,
  monthlyCloseRunSteps,
  type CreateRunArgs,
  type RecordStepArgs,
} from './monthly-close-runs.service.js';
import type { DatabaseClient } from '../client.js';

interface CapturedInsert {
  table: 'runs' | 'steps';
  values: Record<string, unknown>;
}

interface StubOptions {
  failInsert?: boolean;
  failSelect?: boolean;
  runRow?: Record<string, unknown> | null;
  stepRows?: ReadonlyArray<Record<string, unknown>>;
  stepRow?: Record<string, unknown> | null;
  listRows?: ReadonlyArray<Record<string, unknown>>;
}

function makeStubDb(opts: StubOptions = {}): {
  client: DatabaseClient;
  readonly inserted: CapturedInsert[];
  selectCalls: { current: number };
} {
  const inserted: CapturedInsert[] = [];
  const selectCalls = { current: 0 };
  const client = {
    insert: () => {
      return {
        values: async (v: Record<string, unknown>) => {
          if (opts.failInsert) throw new Error('insert boom');
          // Step rows have stepName / stepIndex; runs have periodYear.
          const table: 'runs' | 'steps' =
            'stepName' in v ? 'steps' : 'runs';
          inserted.push({ table, values: v });
        },
      };
    },
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
    select: () => ({
      from: (target: unknown) => {
        const isSteps = target === monthlyCloseRunSteps;
        return {
          where: () => {
            const limitImpl = () => {
              if (opts.failSelect) {
                const fail = Promise.reject(new Error('select boom'));
                fail.catch(() => undefined);
                return fail;
              }
              if (isSteps) {
                if (opts.stepRow !== undefined) {
                  return Promise.resolve(
                    opts.stepRow ? [opts.stepRow] : [],
                  );
                }
                return Promise.resolve(opts.stepRows ?? []);
              }
              const which = selectCalls.current++;
              // First find call is for createRun -> findRunById; second
              // can be a list. Mock both via runRow / listRows.
              if (opts.runRow !== undefined) {
                return Promise.resolve(opts.runRow ? [opts.runRow] : []);
              }
              return Promise.resolve(opts.listRows ?? []);
            };
            const orderByImpl = () => {
              if (opts.failSelect) {
                const fail = Promise.reject(new Error('select boom'));
                fail.catch(() => undefined);
                return Object.assign(fail, { limit: limitImpl });
              }
              if (isSteps) {
                return Promise.resolve(opts.stepRows ?? []);
              }
              const promise = Promise.resolve(opts.listRows ?? []);
              return Object.assign(promise, { limit: limitImpl });
            };
            return {
              orderBy: orderByImpl,
              limit: limitImpl,
            };
          },
        };
      },
    }),
  } as unknown as DatabaseClient;
  return {
    client,
    selectCalls,
    get inserted() { return inserted; },
  } as never;
}

const baseRunRow = {
  id: 'run1',
  tenantId: 't',
  periodYear: 2026,
  periodMonth: 5,
  periodStart: new Date('2026-05-01T00:00:00Z'),
  periodEnd: new Date('2026-05-31T23:59:59Z'),
  status: 'running',
  trigger: 'cron',
  startedAt: new Date('2026-05-01T02:00:00Z'),
  completedAt: null,
  triggeredBy: 'system',
  reconciledPayments: 0,
  statementsGenerated: 0,
  kraMriTotalMinor: 0,
  disbursementTotalMinor: 0,
  currency: null,
  summaryJson: {},
  lastError: null,
};

const createArgs: CreateRunArgs = {
  tenantId: 't',
  periodYear: 2026,
  periodMonth: 5,
  periodStart: '2026-05-01T00:00:00Z',
  periodEnd: '2026-05-31T23:59:59Z',
  trigger: 'cron',
  triggeredBy: 'system',
};

const recordArgs: RecordStepArgs = {
  runId: 'run1',
  tenantId: 't',
  stepName: 'reconcile_payments',
  stepIndex: 1,
  decision: 'executed',
  actor: 'system',
  policyRule: null,
  startedAt: '2026-05-01T02:00:00Z',
  completedAt: '2026-05-01T02:00:05Z',
  durationMs: 5000,
  resultJson: { matched: 12 },
  errorMessage: null,
};

describe('createMonthlyCloseRunsService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('createRun() inserts a row and returns the persisted state', async () => {
    const stub = makeStubDb({ runRow: baseRunRow });
    const svc = createMonthlyCloseRunsService(stub.client);
    const run = await svc.createRun(createArgs);
    expect(stub.inserted).toHaveLength(1);
    expect(stub.inserted[0]?.table).toBe('runs');
    expect(stub.inserted[0]?.values.tenantId).toBe('t');
    expect(stub.inserted[0]?.values.periodYear).toBe(2026);
    expect(stub.inserted[0]?.values.status).toBe('running');
    expect(run.tenantId).toBe('t');
    expect(run.status).toBe('running');
    expect(run.trigger).toBe('cron');
  });

  it('createRun() validates required fields', async () => {
    const stub = makeStubDb();
    const svc = createMonthlyCloseRunsService(stub.client);
    await expect(svc.createRun({ ...createArgs, tenantId: '' })).rejects.toThrow(
      /requires/,
    );
  });

  it('createRun() bubbles DB errors', async () => {
    const stub = makeStubDb({ failInsert: true });
    const svc = createMonthlyCloseRunsService(stub.client);
    await expect(svc.createRun(createArgs)).rejects.toThrow();
  });

  it('recordStep() inserts the step row and returns its shape', async () => {
    const stub = makeStubDb();
    const svc = createMonthlyCloseRunsService(stub.client);
    const step = await svc.recordStep(recordArgs);
    expect(stub.inserted).toHaveLength(1);
    expect(stub.inserted[0]?.table).toBe('steps');
    expect(stub.inserted[0]?.values.stepName).toBe('reconcile_payments');
    expect(stub.inserted[0]?.values.decision).toBe('executed');
    expect(step.stepName).toBe('reconcile_payments');
    expect(step.decision).toBe('executed');
    expect(step.durationMs).toBe(5000);
  });

  it('recordStep() validates required fields', async () => {
    const stub = makeStubDb();
    const svc = createMonthlyCloseRunsService(stub.client);
    await expect(
      svc.recordStep({ ...recordArgs, runId: '' }),
    ).rejects.toThrow(/requires/);
  });

  it('findRunById() returns null when missing', async () => {
    const stub = makeStubDb({ runRow: null });
    const svc = createMonthlyCloseRunsService(stub.client);
    expect(await svc.findRunById('x', 't')).toBeNull();
  });

  it('findRunById() returns null when ids missing', async () => {
    const stub = makeStubDb({ runRow: baseRunRow });
    const svc = createMonthlyCloseRunsService(stub.client);
    expect(await svc.findRunById('', 't')).toBeNull();
    expect(await svc.findRunById('x', '')).toBeNull();
  });

  it('findStep() finds a step or returns null', async () => {
    const stepRow = {
      id: 's1',
      runId: 'run1',
      tenantId: 't',
      stepName: 'reconcile_payments',
      stepIndex: 1,
      decision: 'executed',
      actor: 'system',
      policyRule: null,
      startedAt: new Date('2026-05-01T02:00:00Z'),
      completedAt: new Date('2026-05-01T02:00:05Z'),
      durationMs: 5000,
      resultJson: { matched: 12 },
      errorMessage: null,
    };
    const stubFound = makeStubDb({ stepRow });
    const svcFound = createMonthlyCloseRunsService(stubFound.client);
    const step = await svcFound.findStep('run1', 'reconcile_payments');
    expect(step?.stepName).toBe('reconcile_payments');

    const stubMissing = makeStubDb({ stepRow: null });
    const svcMissing = createMonthlyCloseRunsService(stubMissing.client);
    expect(await svcMissing.findStep('run1', 'nope')).toBeNull();
  });

  it('listRuns() returns [] when tenantId missing', async () => {
    const stub = makeStubDb();
    const svc = createMonthlyCloseRunsService(stub.client);
    expect(await svc.listRuns('')).toEqual([]);
  });

  it('listRuns() returns [] on DB error', async () => {
    const stub = makeStubDb({ failSelect: true });
    const svc = createMonthlyCloseRunsService(stub.client);
    expect(await svc.listRuns('t')).toEqual([]);
  });

  it('updateRun() validates required fields', async () => {
    const stub = makeStubDb();
    const svc = createMonthlyCloseRunsService(stub.client);
    await expect(svc.updateRun('', 't', {})).rejects.toThrow(/requires/);
    await expect(svc.updateRun('r', '', {})).rejects.toThrow(/requires/);
  });
});
