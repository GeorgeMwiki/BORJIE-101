/**
 * MonthlyCloseOrchestrator — runs the end-of-month bookkeeping close
 * autonomously, within per-tenant autonomy-policy guardrails.
 *
 * Wave 28 Phase A Agent PhA2.
 *
 * Lifecycle:
 *   1. `triggerRun` either resumes the existing (tenant, period) run or
 *      creates a fresh one (idempotency guard — a second trigger for an
 *      in-progress run returns `resumed=true`; a trigger for an already-
 *      completed run bubbles up as an error the router maps to 409).
 *   2. `executeRun` walks each step in order. Each step is wrapped in a
 *      try/catch; the per-step persistence records a `decision` so the
 *      run history is a perfect audit trail.
 *   3. Gated steps (propose_disbursement_batch in particular) check the
 *      tenant's autonomy policy. When the batch exceeds the finance
 *      `autoApproveRefundsMinorUnits` threshold, the step is parked as
 *      `awaiting_approval` and the overall run status flips to
 *      `awaiting_approval` too. The human then POSTs `approveStep` to
 *      unblock — the orchestrator picks the run back up from that step.
 *
 * The orchestrator deliberately does NOT import from payments-ledger /
 * domain-services directly — it calls port interfaces the api-gateway
 * composition root fulfils at wire time. That keeps ai-copilot free of
 * heavy transitive deps.
 */

import {
  MONTHLY_CLOSE_STEPS,
  type ApproveStepInput,
  type Decision,
  type DisbursementProposal,
  type KraMriLineItem,
  type MonthlyCloseOrchestratorDeps,
  type RunState,
  type Step,
  type StepRecord,
  type Trigger,
  type TriggerRunInput,
  type TriggerRunResult,
} from './types.js';

const DEFAULT_PLATFORM_FEE_PCT = 10;
const DEFAULT_KRA_MRI_RATE_PCT = 7.5;

/**
 * Thrown when the caller triggers a run for a period that already has a
 * completed run. The router maps this to HTTP 409 CONFLICT.
 */
export class MonthlyCloseAlreadyCompletedError extends Error {
  readonly code = 'MONTHLY_CLOSE_ALREADY_COMPLETED';
  readonly runId: string;
  constructor(runId: string) {
    super(`Monthly close already completed for this period (run ${runId}).`);
    this.runId = runId;
  }
}

export class MonthlyCloseRunNotFoundError extends Error {
  readonly code = 'MONTHLY_CLOSE_RUN_NOT_FOUND';
}

export class MonthlyCloseStepNotGatedError extends Error {
  readonly code = 'MONTHLY_CLOSE_STEP_NOT_GATED';
}

export class MonthlyCloseOrchestrator {
  private readonly deps: MonthlyCloseOrchestratorDeps;
  private readonly platformFeePct: number;
  private readonly kraMriRatePct: number;
  private readonly clock: () => Date;
  private readonly idGen: () => string;

  constructor(deps: MonthlyCloseOrchestratorDeps) {
    this.deps = deps;
    this.platformFeePct = deps.platformFeePct ?? DEFAULT_PLATFORM_FEE_PCT;
    this.kraMriRatePct = deps.kraMriRatePct ?? DEFAULT_KRA_MRI_RATE_PCT;
    this.clock = deps.clock ?? (() => new Date());
    this.idGen = deps.idGen ?? (() => `mc_${Math.random().toString(36).slice(2)}_${Date.now()}`);
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  async triggerRun(input: TriggerRunInput): Promise<TriggerRunResult> {
    const { periodYear, periodMonth } = this.resolvePeriod(
      input.periodYear,
      input.periodMonth,
    );

    const existing = await this.deps.store.findRunByPeriod(
      input.tenantId,
      periodYear,
      periodMonth,
    );

    if (existing) {
      if (existing.status === 'completed') {
        // Hard conflict — router returns 409.
        throw new MonthlyCloseAlreadyCompletedError(existing.id);
      }
      // running / awaiting_approval / failed / skipped → resume.
      this.deps.logger.info(
        { runId: existing.id, status: existing.status },
        'monthly-close: resuming existing run',
      );
      const resumed = await this.executeRun(existing);
      return { run: resumed, resumed: true };
    }

    const { periodStart, periodEnd } = this.computePeriodWindow(
      periodYear,
      periodMonth,
    );

    const run = await this.deps.store.createRun({
      tenantId: input.tenantId,
      periodYear,
      periodMonth,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      trigger: input.trigger,
      triggeredBy: input.triggeredBy,
    });

    this.deps.logger.info(
      { runId: run.id, tenantId: input.tenantId, periodYear, periodMonth },
      'monthly-close: run created',
    );

    const completed = await this.executeRun(run);
    return { run: completed, resumed: false };
  }

  async listRuns(tenantId: string, limit = 20): Promise<readonly RunState[]> {
    return this.deps.store.listRuns(tenantId, Math.min(100, Math.max(1, limit)));
  }

  async getRun(runId: string, tenantId: string): Promise<RunState> {
    const run = await this.deps.store.findRunById(runId, tenantId);
    if (!run) throw new MonthlyCloseRunNotFoundError(runId);
    return run;
  }

  async approveStep(input: ApproveStepInput): Promise<RunState> {
    const run = await this.deps.store.findRunById(input.runId, input.tenantId);
    if (!run) throw new MonthlyCloseRunNotFoundError(input.runId);

    const existingStep = await this.deps.store.findStep(run.id, input.stepName);
    if (!existingStep || existingStep.decision !== 'awaiting_approval') {
      throw new MonthlyCloseStepNotGatedError(
        `Step ${input.stepName} is not awaiting approval (current: ${existingStep?.decision ?? 'none'}).`,
      );
    }

    // Mark the step as approved and resume.
    const now = this.clock();
    await this.deps.store.recordStep({
      runId: run.id,
      tenantId: run.tenantId,
      stepName: input.stepName,
      stepIndex: existingStep.stepIndex,
      decision: 'approved',
      actor: input.approverUserId,
      policyRule: existingStep.policyRule,
      startedAt: existingStep.startedAt,
      completedAt: now.toISOString(),
      durationMs:
        now.getTime() - new Date(existingStep.startedAt).getTime(),
      resultJson: { ...existingStep.resultJson, approvedBy: input.approverUserId },
      errorMessage: null,
    });

    this.deps.logger.info(
      { runId: run.id, stepName: input.stepName, approverUserId: input.approverUserId },
      'monthly-close: step approved — resuming run',
    );

    // Resume run from the approved step onward.
    const refreshed = await this.deps.store.findRunById(run.id, run.tenantId);
    if (!refreshed) throw new MonthlyCloseRunNotFoundError(run.id);
    return this.executeRun(refreshed);
  }

  // ---------------------------------------------------------------------
  // Run execution — walks the step graph
  // ---------------------------------------------------------------------

  private async executeRun(run: RunState): Promise<RunState> {
    let current = run;

    // Flip status back to running if we're resuming.
    if (current.status === 'awaiting_approval' || current.status === 'failed') {
      current = await this.deps.store.updateRun(current.id, current.tenantId, {
        status: 'running',
        lastError: null,
      });
    }

    for (let i = 0; i < MONTHLY_CLOSE_STEPS.length; i++) {
      const stepName = MONTHLY_CLOSE_STEPS[i];
      if (stepName === undefined) continue;

      // Skip already-executed steps (idempotent re-entry).
      const existing = await this.deps.store.findStep(current.id, stepName);
      if (existing && isTerminalDecision(existing.decision)) {
        continue;
      }

      const stepStarted = this.clock();
      let decision: Decision = 'executed';
      let actor = 'system';
      let policyRule: string | null = null;
      let resultJson: Record<string, unknown> = {};
      let errorMessage: string | null = null;

      try {
        const outcome = await this.runStep(stepName, current, existing ?? null);
        decision = outcome.decision;
        actor = outcome.actor;
        policyRule = outcome.policyRule;
        resultJson = outcome.resultJson;
        current = outcome.runPatch
          ? await this.deps.store.updateRun(
              current.id,
              current.tenantId,
              outcome.runPatch,
            )
          : current;
      } catch (err) {
        decision = 'failed';
        errorMessage = err instanceof Error ? err.message : String(err);
        this.deps.logger.error(
          { runId: current.id, stepName, err: errorMessage },
          'monthly-close: step failed',
        );
      }

      const stepCompleted = this.clock();
      await this.deps.store.recordStep({
        runId: current.id,
        tenantId: current.tenantId,
        stepName,
        stepIndex: i,
        decision,
        actor,
        policyRule,
        startedAt: stepStarted.toISOString(),
        completedAt: stepCompleted.toISOString(),
        durationMs: stepCompleted.getTime() - stepStarted.getTime(),
        resultJson,
        errorMessage,
      });

      if (decision === 'failed') {
        current = await this.deps.store.updateRun(current.id, current.tenantId, {
          status: 'failed',
          lastError: errorMessage,
          completedAt: this.clock().toISOString(),
        });
        return current;
      }

      if (decision === 'awaiting_approval') {
        current = await this.deps.store.updateRun(current.id, current.tenantId, {
          status: 'awaiting_approval',
        });
        // Emit event so the exception inbox + process miner pick it up.
        await this.safePublish({
          type: 'MonthlyCloseAwaitingApproval',
          tenantId: current.tenantId,
          runId: current.id,
          payload: { stepName, policyRule },
        });
        return current;
      }
    }

    // All steps executed — mark completed.
    current = await this.deps.store.updateRun(current.id, current.tenantId, {
      status: 'completed',
      completedAt: this.clock().toISOString(),
    });

    return current;
  }

  // ---------------------------------------------------------------------
  // Step runners
  // ---------------------------------------------------------------------

  private async runStep(
    stepName: Step,
    run: RunState,
    previous: StepRecord | null,
  ): Promise<{
    decision: Decision;
    actor: string;
    policyRule: string | null;
    resultJson: Record<string, unknown>;
    runPatch: Parameters<MonthlyCloseOrchestratorDeps['store']['updateRun']>[2] | null;
  }> {
    switch (stepName) {
      case 'freeze_period':
        return this.stepFreezePeriod(run);
      case 'reconcile_payments':
        return this.stepReconcilePayments(run);
      case 'generate_statements':
        return this.stepGenerateStatements(run);
      case 'compute_kra_mri':
        return this.stepComputeKraMri(run);
      case 'compute_disbursements':
        return this.stepComputeDisbursements(run);
      case 'propose_disbursement_batch':
        return this.stepProposeDisbursementBatch(run, previous);
      case 'email_statements':
        return this.stepEmailStatements(run);
      case 'emit_completed_event':
        return this.stepEmitCompletedEvent(run);
    }
  }

  private async stepFreezePeriod(run: RunState) {
    // The period window was already fixed at run creation time; this step
    // is explicit so the audit trail shows the freeze-point.
    return {
      decision: 'executed' as Decision,
      actor: 'system',
      policyRule: null,
      resultJson: {
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        frozenAt: this.clock().toISOString(),
      },
      runPatch: null,
    };
  }

  private async stepReconcilePayments(run: RunState) {
    const res = await this.deps.reconciliation.reconcileForPeriod({
      tenantId: run.tenantId,
      periodStart: new Date(run.periodStart),
      periodEnd: new Date(run.periodEnd),
    });
    return {
      decision: 'executed' as Decision,
      actor: 'system',
      policyRule: null,
      resultJson: {
        reconciled: res.reconciled,
        unmatched: res.unmatched,
        grossRentMinor: res.grossRentMinor,
        currency: res.currency,
      },
      runPatch: {
        reconciledPayments: res.reconciled,
        currency: res.currency,
      },
    };
  }

  private async stepGenerateStatements(run: RunState) {
    const res = await this.deps.statements.generateOwnerStatementsForPeriod({
      tenantId: run.tenantId,
      year: run.periodYear,
      month: run.periodMonth,
    });
    const currency = res.statements[0]?.currency ?? run.currency ?? null;
    return {
      decision: 'executed' as Decision,
      actor: 'system',
      policyRule: null,
      resultJson: {
        statements: res.statements.map((s) => ({
          ownerId: s.ownerId,
          statementId: s.statementId,
          grossRentMinor: s.grossRentMinor,
          currency: s.currency,
        })),
      },
      runPatch: {
        statementsGenerated: res.statements.length,
        currency,
        summary: {
          ...run.summary,
          statementOwnerIds: res.statements.map((s) => s.ownerId),
        },
      },
    };
  }

  private async stepComputeKraMri(run: RunState) {
    // Step name is preserved for historical DB-record continuity; the
    // underlying computation is jurisdiction-aware when the
    // `withholdingTax` port is injected (Wave-Z TaxRegimePort dispatch).
    // Kenya-pilot deploys + tests that don't pass the port fall back to
    // the flat `kraMriRatePct` (default 7.5%).
    const prevStatementsStep = await this.deps.store.findStep(
      run.id,
      'generate_statements',
    );
    const statements = readStatementsFromStep(prevStatementsStep);
    const port = this.deps.withholdingTax;

    let lineItems: KraMriLineItem[];
    let regimeMeta: {
      readonly ratePct: number | null;
      readonly regimeLabels: readonly string[];
      readonly requiresManualConfig: boolean;
      readonly regulatorRefs: readonly (string | null)[];
    };

    if (port) {
      // Dispatch per owner — each owner's withholding is computed
      // against the jurisdiction resolved by the port (usually tenant
      // country, but callers may override on per-property basis).
      const resolved = await Promise.all(
        statements.map(async (s) => {
          const res = await port.computeForTenantAndOwner({
            tenantId: run.tenantId,
            ownerId: s.ownerId,
            grossRentMinor: s.grossRentMinor,
            currency: s.currency,
            period: { year: run.periodYear, month: run.periodMonth },
          });
          return { statement: s, result: res };
        }),
      );
      lineItems = resolved.map(({ statement, result }) => ({
        ownerId: statement.ownerId,
        grossRentMinor: statement.grossRentMinor,
        withholdingMinor: result.withholdingMinor,
        currency: statement.currency,
      }));
      // If every owner resolves to the same rate (common when one
      // tenant operates one jurisdiction) we surface it; otherwise null.
      const uniqueRates = Array.from(
        new Set(resolved.map((r) => r.result.ratePct).filter((r) => r !== null)),
      );
      regimeMeta = {
        ratePct: uniqueRates.length === 1 ? (uniqueRates[0] ?? null) : null,
        regimeLabels: Array.from(
          new Set(resolved.map((r) => r.result.regimeLabel)),
        ),
        requiresManualConfig: resolved.some((r) => r.result.requiresManualConfig),
        regulatorRefs: Array.from(
          new Set(resolved.map((r) => r.result.regulatorRef).filter(Boolean)),
        ),
      };
    } else {
      // Backward-compat flat-rate path (Kenya pilot + legacy tests).
      const rate = this.kraMriRatePct / 100;
      lineItems = statements.map((s) => ({
        ownerId: s.ownerId,
        grossRentMinor: s.grossRentMinor,
        withholdingMinor: Math.round(s.grossRentMinor * rate),
        currency: s.currency,
      }));
      regimeMeta = {
        ratePct: this.kraMriRatePct,
        regimeLabels: ['Kenya MRI (fallback)'],
        requiresManualConfig: false,
        regulatorRefs: ['KRA'],
      };
    }

    const total = lineItems.reduce((sum, li) => sum + li.withholdingMinor, 0);
    const csv = buildKraMriCsv(lineItems, run.periodYear, run.periodMonth);

    return {
      decision: 'executed' as Decision,
      actor: 'system',
      policyRule: null,
      resultJson: {
        lineItems,
        totalWithholdingMinor: total,
        csv,
        ratePct: regimeMeta.ratePct,
        regimeLabels: regimeMeta.regimeLabels,
        regulatorRefs: regimeMeta.regulatorRefs,
        requiresManualConfig: regimeMeta.requiresManualConfig,
        dispatchedVia: port ? 'global_tax_regime_port' : 'legacy_flat_rate',
        // Follow-up WAVE-34 (#33): submit CSV via per-jurisdiction filing adapter
        // (KRA eTIMS for KE, Finanzamt ELSTER for DE, HMRC for GB, etc.)
        submissionStatus: 'pending_filing_adapter',
      },
      runPatch: {
        kraMriTotalMinor: total,
      },
    };
  }

  private async stepComputeDisbursements(run: RunState) {
    const statementsStep = await this.deps.store.findStep(
      run.id,
      'generate_statements',
    );
    const mriStep = await this.deps.store.findStep(run.id, 'compute_kra_mri');
    const statements = readStatementsFromStep(statementsStep);
    const mriByOwner = readMriMap(mriStep);
    const feeRate = this.platformFeePct / 100;

    const proposals: DisbursementProposal[] = [];
    for (const s of statements) {
      const breakdown = await this.deps.disbursement.computeBreakdown({
        tenantId: run.tenantId,
        ownerId: s.ownerId,
        periodStart: new Date(run.periodStart),
        periodEnd: new Date(run.periodEnd),
      });
      const mriMinor = mriByOwner.get(s.ownerId) ?? 0;
      // Platform fee recalculated from gross (authoritative). Maintenance
      // + MRI are subtracted last; `net` is clamped at zero.
      const platformFeeMinor = Math.round(breakdown.grossRentMinor * feeRate);
      const maintenanceMinor = breakdown.maintenanceMinor;
      const netMinor = Math.max(
        0,
        breakdown.grossRentMinor - mriMinor - platformFeeMinor - maintenanceMinor,
      );
      proposals.push({
        ownerId: s.ownerId,
        grossRentMinor: breakdown.grossRentMinor,
        kraMriMinor: mriMinor,
        platformFeeMinor,
        maintenanceMinor,
        netMinor,
        currency: breakdown.currency,
        destination: breakdown.destination,
      });
    }

    const total = proposals.reduce((sum, p) => sum + p.netMinor, 0);

    return {
      decision: 'executed' as Decision,
      actor: 'system',
      policyRule: null,
      resultJson: {
        proposals,
        totalNetMinor: total,
      },
      runPatch: {
        disbursementTotalMinor: total,
      },
    };
  }

  private async stepProposeDisbursementBatch(
    run: RunState,
    previous: StepRecord | null,
  ) {
    // If caller already approved this step (decision='approved'), execute
    // the batch.
    if (previous?.decision === 'approved') {
      return this.executeDisbursementBatch(run, previous.actor);
    }

    const computeStep = await this.deps.store.findStep(
      run.id,
      'compute_disbursements',
    );
    const proposals = readProposalsFromStep(computeStep);
    const total = proposals.reduce((sum, p) => sum + p.netMinor, 0);

    const policy = await this.deps.autonomy.getPolicy(run.tenantId);

    // Policy gate: autonomous mode off OR total > finance ceiling → hold.
    if (!policy.autonomousModeEnabled) {
      return {
        decision: 'awaiting_approval' as Decision,
        actor: 'system',
        policyRule: 'master_switch_off',
        resultJson: {
          totalNetMinor: total,
          proposalsCount: proposals.length,
          reason: 'Autonomous mode disabled — head approval required.',
        },
        runPatch: null,
      };
    }
    if (total > policy.finance.autoApproveRefundsMinorUnits) {
      return {
        decision: 'awaiting_approval' as Decision,
        actor: 'system',
        policyRule: 'finance.batch_over_threshold',
        resultJson: {
          totalNetMinor: total,
          proposalsCount: proposals.length,
          threshold: policy.finance.autoApproveRefundsMinorUnits,
          reason: 'Disbursement batch exceeds finance auto-approve threshold.',
        },
        runPatch: null,
      };
    }

    return this.executeDisbursementBatch(run, 'system', {
      policyRule: 'finance.batch_auto_approved',
    });
  }

  private async executeDisbursementBatch(
    run: RunState,
    actor: string,
    opts: { policyRule?: string } = {},
  ) {
    const computeStep = await this.deps.store.findStep(
      run.id,
      'compute_disbursements',
    );
    const proposals = readProposalsFromStep(computeStep);

    const results: Array<{
      ownerId: string;
      disbursementId: string;
      status: string;
      amountMinor: number;
    }> = [];

    for (const p of proposals) {
      if (p.netMinor <= 0) continue;
      const idempotencyKey = `${run.id}:${p.ownerId}`;
      try {
        const r = await this.deps.disbursement.executeDisbursement({
          tenantId: run.tenantId,
          ownerId: p.ownerId,
          amountMinor: p.netMinor,
          currency: p.currency,
          destination: p.destination,
          idempotencyKey,
        });
        results.push({
          ownerId: p.ownerId,
          disbursementId: r.disbursementId,
          status: r.status,
          amountMinor: p.netMinor,
        });
      } catch (err) {
        results.push({
          ownerId: p.ownerId,
          disbursementId: '',
          status: 'failed',
          amountMinor: p.netMinor,
        });
        this.deps.logger.warn(
          {
            runId: run.id,
            ownerId: p.ownerId,
            err: err instanceof Error ? err.message : String(err),
          },
          'monthly-close: disbursement failed',
        );
      }
    }

    return {
      decision: (actor === 'system' ? 'auto_approved' : 'executed') as Decision,
      actor,
      policyRule: opts.policyRule ?? null,
      resultJson: {
        executed: results.length,
        results,
      },
      runPatch: null,
    };
  }

  private async stepEmailStatements(run: RunState) {
    const statementsStep = await this.deps.store.findStep(
      run.id,
      'generate_statements',
    );
    const statements = readStatementsFromStep(statementsStep);
    const dispatched: Array<{ ownerId: string; dispatchId: string }> = [];

    for (const s of statements) {
      try {
        const r = await this.deps.notifications.sendStatementEmail({
          tenantId: run.tenantId,
          ownerId: s.ownerId,
          statementId: s.statementId,
        });
        dispatched.push({ ownerId: s.ownerId, dispatchId: r.dispatchId });
      } catch (err) {
        this.deps.logger.warn(
          {
            runId: run.id,
            ownerId: s.ownerId,
            err: err instanceof Error ? err.message : String(err),
          },
          'monthly-close: statement email failed',
        );
      }
    }

    return {
      decision: 'executed' as Decision,
      actor: 'system',
      policyRule: null,
      resultJson: {
        dispatched,
        dispatchedCount: dispatched.length,
      },
      runPatch: null,
    };
  }

  private async stepEmitCompletedEvent(run: RunState) {
    await this.safePublish({
      type: 'MonthlyCloseCompleted',
      tenantId: run.tenantId,
      runId: run.id,
      payload: {
        periodYear: run.periodYear,
        periodMonth: run.periodMonth,
        statementsGenerated: run.statementsGenerated,
        kraMriTotalMinor: run.kraMriTotalMinor,
        disbursementTotalMinor: run.disbursementTotalMinor,
        currency: run.currency,
      },
    });
    return {
      decision: 'executed' as Decision,
      actor: 'system',
      policyRule: null,
      resultJson: { emittedAt: this.clock().toISOString() },
      runPatch: null,
    };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private resolvePeriod(
    year?: number,
    month?: number,
  ): { periodYear: number; periodMonth: number } {
    if (year != null && month != null) {
      return { periodYear: year, periodMonth: month };
    }
    // Default: previous month (today minus 1 month) in UTC.
    const now = this.clock();
    const m = now.getUTCMonth(); // 0-11
    const y = now.getUTCFullYear();
    if (m === 0) {
      return { periodYear: y - 1, periodMonth: 12 };
    }
    return { periodYear: y, periodMonth: m };
  }

  private computePeriodWindow(
    year: number,
    month: number,
  ): { periodStart: Date; periodEnd: Date } {
    return {
      periodStart: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
      periodEnd: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    };
  }

  private async safePublish(event: {
    readonly type: 'MonthlyCloseCompleted' | 'MonthlyCloseAwaitingApproval';
    readonly tenantId: string;
    readonly runId: string;
    readonly payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.deps.eventBus.publish(event);
    } catch (err) {
      this.deps.logger.warn(
        {
          runId: event.runId,
          eventType: event.type,
          err: err instanceof Error ? err.message : String(err),
        },
        'monthly-close: event publish failed (non-fatal)',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — shaped for testability
// ---------------------------------------------------------------------------

export function buildKraMriCsv(
  lineItems: readonly KraMriLineItem[],
  year: number,
  month: number,
): string {
  const header =
    'period,owner_id,gross_rent_minor,withholding_rate_pct,withholding_minor,currency';
  const periodTag = `${year}-${String(month).padStart(2, '0')}`;
  const body = lineItems.map((li) => {
    const ratePct =
      li.grossRentMinor > 0
        ? ((li.withholdingMinor / li.grossRentMinor) * 100).toFixed(2)
        : '0.00';
    return [
      periodTag,
      escapeCsv(li.ownerId),
      String(li.grossRentMinor),
      ratePct,
      String(li.withholdingMinor),
      escapeCsv(li.currency),
    ].join(',');
  });
  const totalWithholding = lineItems.reduce(
    (sum, li) => sum + li.withholdingMinor,
    0,
  );
  const totalGross = lineItems.reduce((sum, li) => sum + li.grossRentMinor, 0);
  const totalsLine = `${periodTag},TOTAL,${totalGross},,${totalWithholding},${escapeCsv(
    lineItems[0]?.currency ?? '',
  )}`;
  return [header, ...body, totalsLine].join('\n');
}

function escapeCsv(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function isTerminalDecision(decision: Decision): boolean {
  // `approved` is NOT terminal — it is the signal that a human has
  // unblocked a gated step. When the run resumes, the step runner picks
  // up the `approved` record and executes the batched action. Once that
  // work is done the step is re-recorded as `executed` (or `failed`).
  return (
    decision === 'executed' ||
    decision === 'auto_approved' ||
    decision === 'skipped'
  );
}

interface StatementSummary {
  readonly ownerId: string;
  readonly statementId: string;
  readonly grossRentMinor: number;
  readonly currency: string;
}

function readStatementsFromStep(
  step: StepRecord | null,
): readonly StatementSummary[] {
  if (!step) return [];
  const raw = step.resultJson?.statements;
  if (!Array.isArray(raw)) return [];
  const out: StatementSummary[] = [];
  for (const r of raw) {
    if (
      r &&
      typeof r === 'object' &&
      typeof (r as { ownerId?: unknown }).ownerId === 'string' &&
      typeof (r as { statementId?: unknown }).statementId === 'string' &&
      typeof (r as { grossRentMinor?: unknown }).grossRentMinor === 'number' &&
      typeof (r as { currency?: unknown }).currency === 'string'
    ) {
      const rec = r as {
        ownerId: string;
        statementId: string;
        grossRentMinor: number;
        currency: string;
      };
      out.push({
        ownerId: rec.ownerId,
        statementId: rec.statementId,
        grossRentMinor: rec.grossRentMinor,
        currency: rec.currency,
      });
    }
  }
  return out;
}

function readMriMap(step: StepRecord | null): Map<string, number> {
  const map = new Map<string, number>();
  if (!step) return map;
  const raw = step.resultJson?.lineItems;
  if (!Array.isArray(raw)) return map;
  for (const r of raw) {
    if (
      r &&
      typeof r === 'object' &&
      typeof (r as { ownerId?: unknown }).ownerId === 'string' &&
      typeof (r as { withholdingMinor?: unknown }).withholdingMinor === 'number'
    ) {
      const rec = r as { ownerId: string; withholdingMinor: number };
      map.set(rec.ownerId, rec.withholdingMinor);
    }
  }
  return map;
}

function readProposalsFromStep(
  step: StepRecord | null,
): readonly DisbursementProposal[] {
  if (!step) return [];
  const raw = step.resultJson?.proposals;
  if (!Array.isArray(raw)) return [];
  const out: DisbursementProposal[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Partial<DisbursementProposal>;
    if (
      typeof rec.ownerId === 'string' &&
      typeof rec.grossRentMinor === 'number' &&
      typeof rec.kraMriMinor === 'number' &&
      typeof rec.platformFeeMinor === 'number' &&
      typeof rec.maintenanceMinor === 'number' &&
      typeof rec.netMinor === 'number' &&
      typeof rec.currency === 'string' &&
      typeof rec.destination === 'string'
    ) {
      out.push(rec as DisbursementProposal);
    }
  }
  return out;
}
