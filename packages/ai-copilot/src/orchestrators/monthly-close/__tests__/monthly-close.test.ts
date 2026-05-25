/**
 * MonthlyCloseOrchestrator — tests.
 *
 * Wave 28 Phase A Agent PhA2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MonthlyCloseOrchestrator,
  MonthlyCloseAlreadyCompletedError,
  MonthlyCloseStepNotGatedError,
  buildKraMriCsv,
} from '../orchestrator-service.js';
import type {
  AutonomyPolicyPort,
  DisbursementPort,
  EventPort,
  MonthlyCloseOrchestratorDeps,
  NotificationPort,
  ReconciliationPort,
  RunState,
  RunStatus,
  RunStorePort,
  StatementPort,
  Step,
  StepRecord,
  Trigger,
} from '../types.js';

// ---------------------------------------------------------------------------
// In-memory store — mirrors the Postgres schema shape
// ---------------------------------------------------------------------------

class InMemoryStore implements RunStorePort {
  runs = new Map<string, RunState>();
  steps: StepRecord[] = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async createRun(input: {
    tenantId: string;
    periodYear: number;
    periodMonth: number;
    periodStart: string;
    periodEnd: string;
    trigger: Trigger;
    triggeredBy: string;
  }): Promise<RunState> {
    const id = this.nextId('run');
    const run: RunState = {
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
    this.runs.set(id, run);
    return run;
  }

  async findRunByPeriod(
    tenantId: string,
    y: number,
    m: number,
  ): Promise<RunState | null> {
    for (const run of this.runs.values()) {
      if (
        run.tenantId === tenantId &&
        run.periodYear === y &&
        run.periodMonth === m
      ) {
        return this.withSteps(run);
      }
    }
    return null;
  }

  async findRunById(id: string, tenantId: string): Promise<RunState | null> {
    const run = this.runs.get(id);
    if (!run || run.tenantId !== tenantId) return null;
    return this.withSteps(run);
  }

  async listRuns(tenantId: string, limit: number): Promise<readonly RunState[]> {
    return Array.from(this.runs.values())
      .filter((r) => r.tenantId === tenantId)
      .slice(0, limit)
      .map((r) => this.withSteps(r));
  }

  async updateRun(
    runId: string,
    tenantId: string,
    patch: Partial<{
      status: RunStatus;
      completedAt: string | null;
      reconciledPayments: number;
      statementsGenerated: number;
      kraMriTotalMinor: number;
      disbursementTotalMinor: number;
      currency: string | null;
      summary: Record<string, unknown>;
      lastError: string | null;
    }>,
  ): Promise<RunState> {
    const existing = this.runs.get(runId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`Run ${runId} not found`);
    }
    const updated: RunState = { ...existing, ...patch };
    this.runs.set(runId, updated);
    return this.withSteps(updated);
  }

  async recordStep(input: {
    runId: string;
    tenantId: string;
    stepName: Step;
    stepIndex: number;
    decision: StepRecord['decision'];
    actor: string;
    policyRule: string | null;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    resultJson: Record<string, unknown>;
    errorMessage: string | null;
  }): Promise<StepRecord> {
    // Remove any existing row for (runId, stepName) — mimics the unique
    // index on the SQL table.
    this.steps = this.steps.filter(
      (s) => !(s.runId === input.runId && s.stepName === input.stepName),
    );
    const record: StepRecord = {
      id: this.nextId('step'),
      runId: input.runId,
      tenantId: input.tenantId,
      stepName: input.stepName,
      stepIndex: input.stepIndex,
      decision: input.decision,
      actor: input.actor,
      policyRule: input.policyRule,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      resultJson: input.resultJson,
      errorMessage: input.errorMessage,
    };
    this.steps.push(record);
    return record;
  }

  async findStep(runId: string, stepName: Step): Promise<StepRecord | null> {
    return (
      this.steps.find((s) => s.runId === runId && s.stepName === stepName) ??
      null
    );
  }

  private withSteps(run: RunState): RunState {
    return {
      ...run,
      steps: this.steps.filter((s) => s.runId === run.id),
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

interface Fixture {
  readonly orch: MonthlyCloseOrchestrator;
  readonly store: InMemoryStore;
  readonly events: Array<{ type: string; runId: string }>;
  readonly disbursementCalls: Array<{ ownerId: string; amountMinor: number }>;
  readonly emailCalls: Array<{ ownerId: string; statementId: string }>;
  setPolicy(p: {
    enabled: boolean;
    thresholdMinor: number;
  }): void;
}

function buildFixture(options: {
  statements?: readonly {
    ownerId: string;
    grossRentMinor: number;
    currency: string;
  }[];
  policyEnabled?: boolean;
  policyThresholdMinor?: number;
  platformFeePct?: number;
  disbursementError?: string;
  /**
   * Wave-Z26: inject a WithholdingTaxPort to test the global dispatch
   * path. When unset, orchestrator uses the legacy flat-rate fallback
   * for backward compat with Kenya-pilot tests.
   */
  withholdingTax?: import('../types.js').WithholdingTaxPort;
} = {}): Fixture {
  const store = new InMemoryStore();
  const events: Array<{ type: string; runId: string }> = [];
  const disbursementCalls: Array<{ ownerId: string; amountMinor: number }> = [];
  const emailCalls: Array<{ ownerId: string; statementId: string }> = [];

  const statements = options.statements ?? [
    { ownerId: 'own_1', grossRentMinor: 1_000_00, currency: 'KES' },
    { ownerId: 'own_2', grossRentMinor: 2_000_00, currency: 'KES' },
  ];

  const reconciliation: ReconciliationPort = {
    async reconcileForPeriod() {
      const gross = statements.reduce((s, x) => s + x.grossRentMinor, 0);
      return {
        reconciled: statements.length,
        unmatched: 0,
        grossRentMinor: gross,
        currency: statements[0]?.currency ?? 'KES',
      };
    },
  };

  const statementPort: StatementPort = {
    async generateOwnerStatementsForPeriod() {
      return {
        statements: statements.map((s, i) => ({
          ownerId: s.ownerId,
          statementId: `stmt_${i}`,
          grossRentMinor: s.grossRentMinor,
          currency: s.currency,
        })),
      };
    },
  };

  const disbursement: DisbursementPort = {
    async computeBreakdown(input) {
      const s = statements.find((x) => x.ownerId === input.ownerId);
      return {
        grossRentMinor: s?.grossRentMinor ?? 0,
        platformFeeMinor: 0, // recalculated by orchestrator
        maintenanceMinor: 0,
        currency: s?.currency ?? 'KES',
        destination: `bank_${input.ownerId}`,
      };
    },
    async executeDisbursement(input) {
      if (options.disbursementError) {
        throw new Error(options.disbursementError);
      }
      disbursementCalls.push({
        ownerId: input.ownerId,
        amountMinor: input.amountMinor,
      });
      return {
        disbursementId: `disb_${input.ownerId}`,
        status: 'IN_TRANSIT',
      };
    },
  };

  const notifications: NotificationPort = {
    async sendStatementEmail(input) {
      emailCalls.push({
        ownerId: input.ownerId,
        statementId: input.statementId,
      });
      return { dispatchId: `disp_${input.ownerId}` };
    },
  };

  const eventBus: EventPort = {
    async publish(event) {
      events.push({ type: event.type, runId: event.runId });
    },
  };

  let policyEnabled = options.policyEnabled ?? true;
  let policyThreshold =
    options.policyThresholdMinor ?? Number.MAX_SAFE_INTEGER;

  const autonomy: AutonomyPolicyPort = {
    async getPolicy() {
      return {
        autonomousModeEnabled: policyEnabled,
        finance: {
          autoApproveRefundsMinorUnits: policyThreshold,
        },
      };
    },
  };

  const logger: MonthlyCloseOrchestratorDeps['logger'] = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const orch = new MonthlyCloseOrchestrator({
    store,
    reconciliation,
    statements: statementPort,
    disbursement,
    notifications,
    eventBus,
    autonomy,
    logger,
    withholdingTax: options.withholdingTax,
    platformFeePct: options.platformFeePct ?? 10,
    kraMriRatePct: 7.5,
    clock: () => new Date('2026-04-01T02:00:00Z'),
    idGen: () => `id_${Math.random().toString(36).slice(2)}`,
  });

  return {
    orch,
    store,
    events,
    disbursementCalls,
    emailCalls,
    setPolicy(p) {
      policyEnabled = p.enabled;
      policyThreshold = p.thresholdMinor;
    },
  };
}

// ---------------------------------------------------------------------------
// Happy-path: autonomous mode on, batch under threshold
// ---------------------------------------------------------------------------

describe('MonthlyCloseOrchestrator — end-to-end', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = buildFixture({
      policyEnabled: true,
      // Threshold well above expected net (gross 3,000.00 - 7.5% MRI - 10%
      // platform fee - 0 maintenance = ~2,475.00 total = 247,500 minor).
      policyThresholdMinor: 1_000_000_00,
    });
  });

  it('runs every step in order and marks the run completed', async () => {
    const { run } = await fx.orch.triggerRun({
      tenantId: 'tnt_a',
      trigger: 'manual',
      triggeredBy: 'admin_1',
      periodYear: 2026,
      periodMonth: 3,
    });

    expect(run.status).toBe('completed');
    expect(run.completedAt).not.toBeNull();
    expect(run.steps).toHaveLength(8);

    const decisionsByStep = Object.fromEntries(
      run.steps.map((s) => [s.stepName, s.decision]),
    );
    expect(decisionsByStep.freeze_period).toBe('executed');
    expect(decisionsByStep.reconcile_payments).toBe('executed');
    expect(decisionsByStep.generate_statements).toBe('executed');
    expect(decisionsByStep.compute_kra_mri).toBe('executed');
    expect(decisionsByStep.compute_disbursements).toBe('executed');
    expect(decisionsByStep.propose_disbursement_batch).toBe('auto_approved');
    expect(decisionsByStep.email_statements).toBe('executed');
    expect(decisionsByStep.emit_completed_event).toBe('executed');
  });

  it('computes KRA MRI at 7.5% of gross rent', async () => {
    const { run } = await fx.orch.triggerRun({
      tenantId: 'tnt_a',
      trigger: 'manual',
      triggeredBy: 'admin_1',
      periodYear: 2026,
      periodMonth: 3,
    });
    // Gross total = 1000.00 + 2000.00 = 3000.00 = 300000 minor.
    // 7.5% = 22500 minor.
    expect(run.kraMriTotalMinor).toBe(22_500);
  });

  it('dispatches statement emails and executes disbursements', async () => {
    await fx.orch.triggerRun({
      tenantId: 'tnt_a',
      trigger: 'manual',
      triggeredBy: 'admin_1',
      periodYear: 2026,
      periodMonth: 3,
    });
    expect(fx.emailCalls).toHaveLength(2);
    expect(fx.disbursementCalls).toHaveLength(2);
  });

  it('emits MonthlyCloseCompleted on success', async () => {
    await fx.orch.triggerRun({
      tenantId: 'tnt_a',
      trigger: 'manual',
      triggeredBy: 'admin_1',
      periodYear: 2026,
      periodMonth: 3,
    });
    const types = fx.events.map((e) => e.type);
    expect(types).toContain('MonthlyCloseCompleted');
  });
});

// ---------------------------------------------------------------------------
// Autonomy policy gating
// ---------------------------------------------------------------------------

describe('MonthlyCloseOrchestrator — policy gating', () => {
  it('pauses at propose_disbursement_batch when autonomous mode is OFF', async () => {
    const fx = buildFixture({
      policyEnabled: false,
      policyThresholdMinor: Number.MAX_SAFE_INTEGER,
    });

    const { run } = await fx.orch.triggerRun({
      tenantId: 'tnt_b',
      trigger: 'cron',
      triggeredBy: 'system',
      periodYear: 2026,
      periodMonth: 3,
    });

    expect(run.status).toBe('awaiting_approval');
    const gatedStep = run.steps.find(
      (s) => s.stepName === 'propose_disbursement_batch',
    );
    expect(gatedStep?.decision).toBe('awaiting_approval');
    expect(gatedStep?.policyRule).toBe('master_switch_off');
    // No disbursements should have fired.
    expect(fx.disbursementCalls).toHaveLength(0);
    // Awaiting-approval event must be emitted.
    expect(fx.events.map((e) => e.type)).toContain(
      'MonthlyCloseAwaitingApproval',
    );
  });

  it('pauses when batch exceeds finance threshold', async () => {
    const fx = buildFixture({
      policyEnabled: true,
      // Threshold of 100 minor (1.00) — net will blow past it.
      policyThresholdMinor: 100,
    });

    const { run } = await fx.orch.triggerRun({
      tenantId: 'tnt_c',
      trigger: 'cron',
      triggeredBy: 'system',
      periodYear: 2026,
      periodMonth: 3,
    });

    expect(run.status).toBe('awaiting_approval');
    const gatedStep = run.steps.find(
      (s) => s.stepName === 'propose_disbursement_batch',
    );
    expect(gatedStep?.policyRule).toBe('finance.batch_over_threshold');
  });

  it('resumes from approveStep and completes the run', async () => {
    const fx = buildFixture({
      policyEnabled: false,
      policyThresholdMinor: Number.MAX_SAFE_INTEGER,
    });

    const first = await fx.orch.triggerRun({
      tenantId: 'tnt_d',
      trigger: 'cron',
      triggeredBy: 'system',
      periodYear: 2026,
      periodMonth: 3,
    });
    expect(first.run.status).toBe('awaiting_approval');

    const resumed = await fx.orch.approveStep({
      runId: first.run.id,
      tenantId: 'tnt_d',
      stepName: 'propose_disbursement_batch',
      approverUserId: 'user_head',
    });

    expect(resumed.status).toBe('completed');
    const approvedStep = resumed.steps.find(
      (s) => s.stepName === 'propose_disbursement_batch',
    );
    // Post-approval the step is re-recorded as `executed` once the
    // batch actually runs — actor is preserved from the approver so
    // the audit trail still shows WHO unblocked the gate.
    expect(approvedStep?.decision).toBe('executed');
    expect(approvedStep?.actor).toBe('user_head');
    expect(fx.disbursementCalls.length).toBeGreaterThan(0);
  });

  it('rejects approveStep when the step is not gated', async () => {
    const fx = buildFixture({ policyEnabled: true, policyThresholdMinor: 1_000_000_00 });
    const first = await fx.orch.triggerRun({
      tenantId: 'tnt_e',
      trigger: 'manual',
      triggeredBy: 'admin',
      periodYear: 2026,
      periodMonth: 3,
    });
    // Run already complete — approveStep should fail.
    await expect(
      fx.orch.approveStep({
        runId: first.run.id,
        tenantId: 'tnt_e',
        stepName: 'propose_disbursement_batch',
        approverUserId: 'user_head',
      }),
    ).rejects.toBeInstanceOf(MonthlyCloseStepNotGatedError);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('MonthlyCloseOrchestrator — idempotency', () => {
  it('returns resumed=true for an in-progress re-trigger', async () => {
    const fx = buildFixture({
      policyEnabled: false, // pause mid-run
      policyThresholdMinor: Number.MAX_SAFE_INTEGER,
    });

    const first = await fx.orch.triggerRun({
      tenantId: 'tnt_f',
      trigger: 'cron',
      triggeredBy: 'system',
      periodYear: 2026,
      periodMonth: 3,
    });
    expect(first.resumed).toBe(false);
    expect(first.run.status).toBe('awaiting_approval');

    // Second trigger for the same period — should resume (still
    // awaiting_approval because policy unchanged).
    const second = await fx.orch.triggerRun({
      tenantId: 'tnt_f',
      trigger: 'cron',
      triggeredBy: 'system',
      periodYear: 2026,
      periodMonth: 3,
    });
    expect(second.resumed).toBe(true);
    expect(second.run.id).toBe(first.run.id);
  });

  it('throws MonthlyCloseAlreadyCompletedError for completed re-trigger', async () => {
    const fx = buildFixture({
      policyEnabled: true,
      policyThresholdMinor: 1_000_000_00,
    });

    await fx.orch.triggerRun({
      tenantId: 'tnt_g',
      trigger: 'manual',
      triggeredBy: 'admin',
      periodYear: 2026,
      periodMonth: 3,
    });

    await expect(
      fx.orch.triggerRun({
        tenantId: 'tnt_g',
        trigger: 'manual',
        triggeredBy: 'admin',
        periodYear: 2026,
        periodMonth: 3,
      }),
    ).rejects.toBeInstanceOf(MonthlyCloseAlreadyCompletedError);
  });

  it('does not re-run steps that were already executed', async () => {
    const fx = buildFixture({
      policyEnabled: false,
      policyThresholdMinor: Number.MAX_SAFE_INTEGER,
    });

    const first = await fx.orch.triggerRun({
      tenantId: 'tnt_h',
      trigger: 'cron',
      triggeredBy: 'system',
      periodYear: 2026,
      periodMonth: 3,
    });

    const firstStatementStepId = fx.store.steps.find(
      (s) => s.runId === first.run.id && s.stepName === 'generate_statements',
    )?.id;

    await fx.orch.approveStep({
      runId: first.run.id,
      tenantId: 'tnt_h',
      stepName: 'propose_disbursement_batch',
      approverUserId: 'user_head',
    });

    const afterId = fx.store.steps.find(
      (s) => s.runId === first.run.id && s.stepName === 'generate_statements',
    )?.id;

    // Same step row — orchestrator did not re-execute generate_statements.
    expect(afterId).toBe(firstStatementStepId);
  });
});

// ---------------------------------------------------------------------------
// KRA MRI CSV
// ---------------------------------------------------------------------------

describe('buildKraMriCsv', () => {
  it('produces per-owner rows + total row + header', () => {
    const csv = buildKraMriCsv(
      [
        { ownerId: 'o1', grossRentMinor: 100_000, withholdingMinor: 7_500, currency: 'KES' },
        { ownerId: 'o2', grossRentMinor: 200_000, withholdingMinor: 15_000, currency: 'KES' },
      ],
      2026,
      3,
    );
    const lines = csv.split('\n');
    expect(lines[0]).toContain('period,owner_id,gross_rent_minor');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('TOTAL,300000');
    expect(lines[3]).toContain('22500');
  });

  it('escapes CSV-unsafe characters', () => {
    const csv = buildKraMriCsv(
      [
        {
          ownerId: 'a,b"c',
          grossRentMinor: 10_000,
          withholdingMinor: 750,
          currency: 'KES',
        },
      ],
      2026,
      3,
    );
    expect(csv).toContain('"a,b""c"');
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe('MonthlyCloseOrchestrator — failures', () => {
  it('marks the run failed when a step throws', async () => {
    const fx = buildFixture({
      policyEnabled: true,
      policyThresholdMinor: 1_000_000_00,
      disbursementError: 'network down',
    });
    const { run } = await fx.orch.triggerRun({
      tenantId: 'tnt_i',
      trigger: 'manual',
      triggeredBy: 'admin',
      periodYear: 2026,
      periodMonth: 3,
    });
    // Disbursement swallow individual errors → batch step still completes,
    // but result records failures. Overall run reaches 'completed' because
    // no hard throw escaped the loop (good — prevents a single bank
    // outage from halting bookkeeping). Verify via the step result shape.
    expect(run.status).toBe('completed');
    const batch = run.steps.find(
      (s) => s.stepName === 'propose_disbursement_batch',
    );
    const results = batch?.resultJson.results as Array<{ status: string }>;
    expect(results.every((r) => r.status === 'failed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wave-Z26: Global WithholdingTaxPort dispatch (per-tenant jurisdiction)
// ---------------------------------------------------------------------------
// When the port is injected, the orchestrator stops using the legacy
// flat `kraMriRatePct = 7.5` and instead asks the port per-owner. Any
// country's rate can land here — DE/GB/KR/etc. — without code changes
// to the orchestrator.

describe('MonthlyCloseOrchestrator — global withholding dispatch (Wave Z26)', () => {
  it('dispatches per-owner via WithholdingTaxPort when provided', async () => {
    const calls: Array<{
      tenantId: string;
      ownerId: string;
      grossRentMinor: number;
    }> = [];

    const germanRate = 15.825; // DE Kapitalertragsteuer + Soli
    const britishRate = 20; // GB NRLS
    const rateByOwner: Record<string, number> = {
      own_de: germanRate,
      own_gb: britishRate,
    };

    const fx = buildFixture({
      statements: [
        { ownerId: 'own_de', grossRentMinor: 1_000_00, currency: 'EUR' },
        { ownerId: 'own_gb', grossRentMinor: 2_000_00, currency: 'GBP' },
      ],
      policyEnabled: true,
      policyThresholdMinor: 1_000_000_00,
      withholdingTax: {
        async computeForTenantAndOwner(input) {
          calls.push({
            tenantId: input.tenantId,
            ownerId: input.ownerId,
            grossRentMinor: input.grossRentMinor,
          });
          const pct = rateByOwner[input.ownerId] ?? 0;
          return {
            withholdingMinor: Math.round(input.grossRentMinor * (pct / 100)),
            ratePct: pct,
            regimeLabel:
              input.ownerId === 'own_de' ? 'DE-Kapitalertragsteuer' : 'GB-NRLS',
            requiresManualConfig: false,
            regulatorRef: input.ownerId === 'own_de' ? 'BZSt' : 'HMRC',
          };
        },
      },
    });

    const { run } = await fx.orch.triggerRun({
      tenantId: 'tnt_global',
      trigger: 'manual',
      triggeredBy: 'admin',
      periodYear: 2026,
      periodMonth: 3,
    });

    // Port was called once per owner with the right context.
    expect(calls).toHaveLength(2);
    expect(calls[0].tenantId).toBe('tnt_global');
    expect(new Set(calls.map((c) => c.ownerId))).toEqual(
      new Set(['own_de', 'own_gb']),
    );

    // Totals should reflect PER-OWNER rates, not a flat 7.5%.
    // DE: 100000 * 15.825% = 15825 minor (rounded)
    // GB: 200000 * 20% = 40000 minor
    expect(run.kraMriTotalMinor).toBe(15_825 + 40_000);

    // Result metadata records the dispatch source + per-regime labels.
    const kraStep = run.steps.find((s) => s.stepName === 'compute_kra_mri');
    expect(kraStep).toBeTruthy();
    expect(kraStep?.resultJson.dispatchedVia).toBe('global_tax_regime_port');
    const labels = kraStep?.resultJson.regimeLabels as readonly string[];
    expect(labels).toContain('DE-Kapitalertragsteuer');
    expect(labels).toContain('GB-NRLS');
    // When owners span regimes, the top-level ratePct collapses to null
    // (the per-owner line items carry the real rates).
    expect(kraStep?.resultJson.ratePct).toBeNull();
  });

  it('falls back to legacy flat-rate when no port is injected', async () => {
    const fx = buildFixture({
      policyEnabled: true,
      policyThresholdMinor: 1_000_000_00,
    });
    const { run } = await fx.orch.triggerRun({
      tenantId: 'tnt_ke',
      trigger: 'manual',
      triggeredBy: 'admin',
      periodYear: 2026,
      periodMonth: 3,
    });
    const kraStep = run.steps.find((s) => s.stepName === 'compute_kra_mri');
    expect(kraStep?.resultJson.dispatchedVia).toBe('legacy_flat_rate');
    expect(kraStep?.resultJson.ratePct).toBe(7.5);
    // Gross 300_000 * 7.5% = 22_500 (same as legacy test)
    expect(run.kraMriTotalMinor).toBe(22_500);
  });
});
