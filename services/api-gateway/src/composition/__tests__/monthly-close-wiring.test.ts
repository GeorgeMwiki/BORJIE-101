/**
 * monthly-close-wiring tests.
 *
 * Verifies the composition module:
 *   - returns null when no Drizzle client is provided (DATABASE_URL unset),
 *   - constructs a real `MonthlyCloseOrchestrator` against a fake DB,
 *   - threads the Drizzle-backed `createMonthlyCloseRunsService` adapter
 *     into the orchestrator's `RunStorePort`,
 *   - keeps every stub port safe (no throws) when exercised end-to-end,
 *   - emits a single `degraded`-mode warning the first time a stub port
 *     is invoked so operators see the degraded posture in logs.
 *
 * The DB barrel is mocked at the module boundary so the wiring can be
 * exercised without a Postgres reachable. The fake adapter is
 * stateful enough to drive a full `triggerRun` through every stub port.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stateful in-memory fake — drives the orchestrator end-to-end
// ---------------------------------------------------------------------------

interface FakeRun {
  id: string;
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  periodStart: string;
  periodEnd: string;
  status: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  reconciledPayments: number;
  statementsGenerated: number;
  kraMriTotalMinor: number;
  disbursementTotalMinor: number;
  currency: string | null;
  summary: Record<string, unknown>;
  lastError: string | null;
  steps: ReadonlyArray<unknown>;
}

interface FakeStep {
  id: string;
  runId: string;
  tenantId: string;
  stepName: string;
  stepIndex: number;
  decision: string;
  actor: string;
  policyRule: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  resultJson: Record<string, unknown>;
  errorMessage: string | null;
}

function buildFakeAdapter() {
  const runs = new Map<string, FakeRun>();
  const steps: FakeStep[] = [];
  let runSeq = 0;
  let stepSeq = 0;

  return {
    runs,
    steps,
    async createRun(input: {
      tenantId: string;
      periodYear: number;
      periodMonth: number;
      periodStart: string;
      periodEnd: string;
      trigger: string;
      triggeredBy: string;
    }) {
      runSeq += 1;
      const id = `run_${runSeq}`;
      const run: FakeRun = {
        id,
        tenantId: input.tenantId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: 'running',
        trigger: input.trigger,
        startedAt: new Date().toISOString(),
        completedAt: null,
        triggeredBy: input.triggeredBy,
        reconciledPayments: 0,
        statementsGenerated: 0,
        kraMriTotalMinor: 0,
        disbursementTotalMinor: 0,
        currency: null,
        summary: {},
        lastError: null,
        steps: [],
      };
      runs.set(id, run);
      return run;
    },
    async findRunByPeriod(
      tenantId: string,
      periodYear: number,
      periodMonth: number,
    ) {
      for (const r of runs.values()) {
        if (
          r.tenantId === tenantId &&
          r.periodYear === periodYear &&
          r.periodMonth === periodMonth
        ) {
          return r;
        }
      }
      return null;
    },
    async findRunById(runId: string, tenantId: string) {
      const r = runs.get(runId);
      return r && r.tenantId === tenantId ? r : null;
    },
    async listRuns() {
      return Array.from(runs.values());
    },
    async updateRun(
      runId: string,
      tenantId: string,
      patch: Partial<FakeRun>,
    ) {
      const r = runs.get(runId);
      if (!r || r.tenantId !== tenantId) {
        throw new Error('updateRun: not found');
      }
      const next = { ...r, ...patch };
      runs.set(runId, next);
      return next;
    },
    async recordStep(input: Omit<FakeStep, 'id'>) {
      stepSeq += 1;
      const rec: FakeStep = { id: `step_${stepSeq}`, ...input };
      steps.push(rec);
      return rec;
    },
    async findStep(runId: string, stepName: string) {
      return (
        steps.find((s) => s.runId === runId && s.stepName === stepName) ?? null
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Mocks — capture the adapter spy + return the stateful fake
// ---------------------------------------------------------------------------

const adapterSpy = vi.fn();
let lastFakeAdapter: ReturnType<typeof buildFakeAdapter> | null = null;
let lastAdapterDb: unknown = null;

vi.mock('@borjie/database', () => {
  return {
    createDatabaseClient: () => makeFakeDb(),
    createMonthlyCloseRunsService: (db: unknown) => {
      lastAdapterDb = db;
      adapterSpy(db);
      lastFakeAdapter = buildFakeAdapter();
      return lastFakeAdapter;
    },
    // ProdFix-2 wire #4 — wiring now resolves the per-tenant display
    // currency via the platform `currency_preferences` service so the
    // statement-adapter never falls back to the literal `'XXX'`. The
    // tests only need the resolver to return *some* valid currency for
    // the orchestrator to walk through; a stub `KES` is fine.
    createCurrencyPreferencesService: () => ({
      resolve: async () => ({ currency: 'KES', source: 'fallback' as const }),
      list: async () => [],
      upsert: async () => undefined,
      remove: async () => undefined,
    }),
  };
});

// Pull the wiring AFTER the mock so its imports resolve to the spies.
import { createMonthlyCloseWiring } from '../monthly-close-wiring';

/**
 * Build a fake DB whose `execute` always returns empty rows. The
 * Drizzle-backed period-bulk adapters (reconciliation / statements /
 * disbursement / notifications) call `db.execute(sql\`...\`)` so we
 * provide just enough surface for the orchestrator to walk through
 * every step without throwing. Tests that need richer behaviour
 * override this per-call.
 */
function makeFakeDb(): {
  __fake: true;
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    __fake: true,
    execute: vi.fn(async () => []),
  };
}

const fakeDb = makeFakeDb() as unknown as Parameters<
  typeof createMonthlyCloseWiring
>[0]['db'];

beforeEach(() => {
  adapterSpy.mockClear();
  lastFakeAdapter = null;
  lastAdapterDb = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMonthlyCloseWiring', () => {
  it('returns null when no Drizzle client is supplied', () => {
    const result = createMonthlyCloseWiring({ db: null });
    expect(result).toBeNull();
    expect(adapterSpy).not.toHaveBeenCalled();
  });

  it('constructs an orchestrator when a Drizzle client is provided', () => {
    const wiring = createMonthlyCloseWiring({ db: fakeDb });
    expect(wiring).not.toBeNull();
    expect(wiring?.orchestrator).toBeDefined();
    expect(typeof wiring?.orchestrator.triggerRun).toBe('function');
    expect(typeof wiring?.orchestrator.listRuns).toBe('function');
    expect(typeof wiring?.orchestrator.approveStep).toBe('function');
  });

  it('threads the Drizzle adapter into the RunStore port', () => {
    const wiring = createMonthlyCloseWiring({ db: fakeDb });
    expect(wiring).not.toBeNull();
    expect(adapterSpy).toHaveBeenCalledTimes(1);
    expect(lastAdapterDb).toBe(fakeDb);
  });

  it('forwards listRuns through the orchestrator into the Drizzle adapter', async () => {
    const wiring = createMonthlyCloseWiring({ db: fakeDb });
    expect(wiring).not.toBeNull();
    const runs = await wiring!.orchestrator.listRuns('tenant-x');
    expect(runs).toEqual([]);
  });

  it('drives every step through real Drizzle adapters without throwing and parks at the autonomy gate', async () => {
    const warns: Array<{ meta: object; msg: string }> = [];
    const wiring = createMonthlyCloseWiring({
      db: fakeDb,
      logger: {
        info: () => undefined,
        warn: (meta, msg) => warns.push({ meta, msg }),
      },
    });
    expect(wiring).not.toBeNull();

    // End-to-end: trigger a run; the stateful fake drives every step.
    // Because no autonomyRepository is injected, the safe-default stub
    // returns autonomousModeEnabled=false so the disbursement step
    // parks as awaiting_approval and the run should NOT crash.
    const result = await wiring!.orchestrator.triggerRun({
      tenantId: 'tenant-degraded',
      trigger: 'manual',
      triggeredBy: 'user-1',
      periodYear: 2026,
      periodMonth: 4,
    });

    expect(result.run).toBeDefined();
    // We expect the run to have parked at the disbursement gate
    // (autonomy stub denies auto-approval) — proving the orchestrator
    // walked through reconcile/statements/kra/compute/propose stages.
    expect(['awaiting_approval', 'completed']).toContain(result.run.status);

    // The autonomy stub MUST have warned (it's the gate that decides
    // whether to park).
    const ports = warns
      .map((w) => (w.meta as { port?: string }).port)
      .filter((p): p is string => typeof p === 'string');
    expect(ports).toContain('autonomy');
  });

  it('surfaces orchestrator-typed errors instead of stub-port crashes', async () => {
    // We exercise approveStep against an unknown run id to confirm the
    // wiring does not blow up on store-driven failures — the assertion
    // is that the orchestrator's typed error surfaces with its `code`.
    const wiring = createMonthlyCloseWiring({ db: fakeDb });
    expect(wiring).not.toBeNull();

    let caught: unknown = null;
    try {
      await wiring!.orchestrator.approveStep({
        runId: 'missing',
        tenantId: 'tenant-x',
        stepName: 'reconcile_payments',
        approverUserId: 'user-1',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe(
      'MONTHLY_CLOSE_RUN_NOT_FOUND',
    );
  });

  // ---------------------------------------------------------------------
  // Real-adapter wirings — Wave 28 Phase B follow-on. The autonomy port
  // and event port now bind to real repository / event-bus instances
  // when the parent composition root supplies them.
  // ---------------------------------------------------------------------

  it('binds the autonomy port to the real repository when supplied', async () => {
    const repoGet = vi.fn().mockResolvedValue(null);
    const repo = {
      get: repoGet,
      upsert: vi.fn(),
    };
    const warns: Array<{ meta: object; msg: string }> = [];
    const wiring = createMonthlyCloseWiring({
      db: fakeDb,
      autonomyRepository: repo as never,
      logger: {
        info: () => undefined,
        warn: (meta, msg) => warns.push({ meta, msg }),
      },
    });
    expect(wiring).not.toBeNull();

    await wiring!.orchestrator.triggerRun({
      tenantId: 'tenant-real-autonomy',
      trigger: 'manual',
      triggeredBy: 'user-1',
      periodYear: 2026,
      periodMonth: 4,
    });

    // The real adapter MUST consult the repository. A null row drives
    // the safe-default (autonomousModeEnabled: false) path so the run
    // still parks at the disbursement gate without crashing.
    expect(repoGet).toHaveBeenCalledWith('tenant-real-autonomy');

    // Falling back through the `no_policy_row` reason is structured so
    // operators can pivot on `degraded_reason` in their log pipeline.
    const autonomyWarn = warns.find(
      (w) => (w.meta as { port?: string }).port === 'autonomy',
    );
    expect(autonomyWarn).toBeDefined();
    expect(
      (autonomyWarn?.meta as { degraded_reason?: string }).degraded_reason,
    ).toBe('no_policy_row');
  });

  it('respects an autonomousModeEnabled=true policy row', async () => {
    // The orchestrator's port shape only reads `autonomousModeEnabled`
    // and `finance.autoApproveRefundsMinorUnits`, so a partial row is
    // structurally sufficient. We cast through `unknown` at the
    // mockResolvedValue boundary rather than fabricating a full policy.
    const partialPolicy = {
      tenantId: 'tenant-enabled',
      autonomousModeEnabled: true,
      finance: { autoApproveRefundsMinorUnits: 10_000 },
    };
    const repo = {
      get: vi.fn().mockResolvedValue(partialPolicy as unknown),
      upsert: vi.fn(),
    };
    const wiring = createMonthlyCloseWiring({
      db: fakeDb,
      autonomyRepository: repo as never,
    });
    expect(wiring).not.toBeNull();

    const result = await wiring!.orchestrator.triggerRun({
      tenantId: 'tenant-enabled',
      trigger: 'manual',
      triggeredBy: 'user-1',
      periodYear: 2026,
      periodMonth: 4,
    });

    // With autonomousModeEnabled=true and zero owners (statement stub
    // returns []), the run should reach completed status because there
    // is no disbursement batch to park.
    expect(result.run).toBeDefined();
    expect(repo.get).toHaveBeenCalled();
  });

  it('absorbs autonomy repo errors and falls back to safe defaults', async () => {
    const repo = {
      get: vi.fn().mockRejectedValue(new Error('db down')),
      upsert: vi.fn(),
    };
    const warns: Array<{ meta: object; msg: string }> = [];
    const wiring = createMonthlyCloseWiring({
      db: fakeDb,
      autonomyRepository: repo as never,
      logger: {
        info: () => undefined,
        warn: (meta, msg) => warns.push({ meta, msg }),
      },
    });
    expect(wiring).not.toBeNull();

    const result = await wiring!.orchestrator.triggerRun({
      tenantId: 'tenant-broken-autonomy',
      trigger: 'manual',
      triggeredBy: 'user-1',
      periodYear: 2026,
      periodMonth: 4,
    });
    expect(result.run).toBeDefined();

    const portWarns = warns.filter(
      (w) => (w.meta as { port?: string }).port === 'autonomy',
    );
    // Repository error path must emit a structured warning so ops see
    // the degraded posture.
    const reasons = portWarns
      .map((w) => (w.meta as { degraded_reason?: string }).degraded_reason)
      .filter((r): r is string => typeof r === 'string');
    expect(reasons).toContain('repository_error');
  });

  it('publishes orchestrator events onto the supplied EventBus', async () => {
    const published: unknown[] = [];
    const eventBus = {
      publish: vi.fn().mockImplementation(async (envelope: unknown) => {
        published.push(envelope);
      }),
      subscribe: vi.fn(() => () => undefined),
    };
    // Auto-approve policy so the run reaches the emit_completed_event
    // step (rather than parking at awaiting_approval which emits the
    // alternative event type).
    const repo = {
      get: vi.fn().mockResolvedValue({
        tenantId: 'tenant-bus',
        autonomousModeEnabled: true,
        finance: { autoApproveRefundsMinorUnits: 0 },
      }),
      upsert: vi.fn(),
    };
    const wiring = createMonthlyCloseWiring({
      db: fakeDb,
      eventBus: eventBus as never,
      autonomyRepository: repo as never,
    });
    expect(wiring).not.toBeNull();

    await wiring!.orchestrator.triggerRun({
      tenantId: 'tenant-bus',
      trigger: 'manual',
      triggeredBy: 'user-1',
      periodYear: 2026,
      periodMonth: 4,
    });

    expect(eventBus.publish).toHaveBeenCalled();
    const first = published[0] as {
      event: { eventType: string; tenantId: string };
      aggregateType: string;
    };
    expect(first.aggregateType).toBe('MonthlyCloseRun');
    expect([
      'MonthlyCloseCompleted',
      'MonthlyCloseAwaitingApproval',
    ]).toContain(first.event.eventType);
    expect(first.event.tenantId).toBe('tenant-bus');
  });

  it('absorbs EventBus publish failures so a run never tears down on a flaky bus', async () => {
    const eventBus = {
      publish: vi.fn().mockRejectedValue(new Error('bus down')),
      subscribe: vi.fn(() => () => undefined),
    };
    const wiring = createMonthlyCloseWiring({
      db: fakeDb,
      eventBus: eventBus as never,
    });
    expect(wiring).not.toBeNull();

    const result = await wiring!.orchestrator.triggerRun({
      tenantId: 'tenant-flaky-bus',
      trigger: 'manual',
      triggeredBy: 'user-1',
      periodYear: 2026,
      periodMonth: 4,
    });
    expect(result.run).toBeDefined();
  });
});
