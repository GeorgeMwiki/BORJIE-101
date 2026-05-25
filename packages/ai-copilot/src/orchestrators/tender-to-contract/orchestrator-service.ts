/**
 * TenderToContractOrchestrator — drives a procurement flow end-to-end,
 * policy-gating the award step and compensating (rescinding award +
 * re-opening tender) when contract signing fails.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

import {
  TENDER_STEPS,
  type ApproveStepInput,
  type Decision,
  type RunState,
  type Step,
  type StepRecord,
  type TenderToContractOrchestratorDeps,
  type TriggerRunInput,
  type TriggerRunResult,
} from './types.js';

const DEFAULT_MAX_RETRIES = 2;

export class TenderAlreadyCompletedError extends Error {
  readonly code = 'TENDER_ALREADY_COMPLETED';
  readonly runId: string;
  constructor(runId: string) {
    super(`Tender already completed (run ${runId}).`);
    this.runId = runId;
  }
}

export class TenderRunNotFoundError extends Error {
  readonly code = 'TENDER_RUN_NOT_FOUND';
}

export class TenderStepNotGatedError extends Error {
  readonly code = 'TENDER_STEP_NOT_GATED';
}

interface StepOutcome {
  readonly decision: Decision;
  readonly actor: string;
  readonly policyRule: string | null;
  readonly resultJson: Record<string, unknown>;
}

export class TenderToContractOrchestrator {
  private readonly deps: TenderToContractOrchestratorDeps;
  private readonly maxRetries: number;
  private readonly clock: () => Date;
  private readonly idGen: () => string;

  constructor(deps: TenderToContractOrchestratorDeps) {
    this.deps = deps;
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.clock = deps.clock ?? (() => new Date());
    this.idGen =
      deps.idGen ?? (() => `t2c_${Math.random().toString(36).slice(2)}_${Date.now()}`);
  }

  async triggerRun(input: TriggerRunInput): Promise<TriggerRunResult> {
    const existing = await this.deps.store.findRunByKey(
      input.tenantId,
      input.tenderKey,
    );

    if (existing) {
      if (existing.status === 'completed') {
        throw new TenderAlreadyCompletedError(existing.id);
      }
      this.deps.logger.info(
        { runId: existing.id, status: existing.status },
        'tender-to-contract: resuming existing run',
      );
      const resumed = await this.executeRun(existing);
      return { run: resumed, resumed: true };
    }

    const run = await this.deps.store.createRun({
      tenantId: input.tenantId,
      tenderKey: input.tenderKey,
      scope: input.scope,
      budgetMinor: input.budgetMinor,
      currency: input.currency,
      trigger: input.trigger,
      triggeredBy: input.triggeredBy,
    });

    await this.safePublish({
      type: 'TenderStarted',
      tenantId: input.tenantId,
      runId: run.id,
      payload: { tenderKey: input.tenderKey, scope: input.scope },
    });

    const completed = await this.executeRun(run);
    return { run: completed, resumed: false };
  }

  async listRuns(tenantId: string, limit = 20): Promise<readonly RunState[]> {
    return this.deps.store.listRuns(tenantId, Math.min(100, Math.max(1, limit)));
  }

  async getRun(runId: string, tenantId: string): Promise<RunState> {
    const run = await this.deps.store.findRunById(runId, tenantId);
    if (!run) throw new TenderRunNotFoundError(runId);
    return run;
  }

  async approveStep(input: ApproveStepInput): Promise<RunState> {
    const run = await this.deps.store.findRunById(input.runId, input.tenantId);
    if (!run) throw new TenderRunNotFoundError(input.runId);

    const existingStep = await this.deps.store.findStep(run.id, input.stepName);
    if (!existingStep || existingStep.decision !== 'awaiting_approval') {
      throw new TenderStepNotGatedError(
        `Step ${input.stepName} is not awaiting approval (current: ${existingStep?.decision ?? 'none'}).`,
      );
    }

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
      durationMs: now.getTime() - new Date(existingStep.startedAt).getTime(),
      resultJson: {
        ...existingStep.resultJson,
        approvedBy: input.approverUserId,
      },
      errorMessage: null,
      idempotencyKey: existingStep.idempotencyKey,
      retryCount: existingStep.retryCount,
    });

    const refreshed = await this.deps.store.findRunById(run.id, run.tenantId);
    if (!refreshed) throw new TenderRunNotFoundError(run.id);
    return this.executeRun(refreshed);
  }

  // -------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------

  private async executeRun(run: RunState): Promise<RunState> {
    let current = run;
    if (current.status === 'awaiting_approval' || current.status === 'failed') {
      current = await this.deps.store.updateRun(current.id, current.tenantId, {
        status: 'running',
        lastError: null,
      });
    }

    for (let i = 0; i < TENDER_STEPS.length; i++) {
      const stepName = TENDER_STEPS[i];
      const existing = await this.deps.store.findStep(current.id, stepName);
      if (existing && isTerminalDecision(existing.decision)) continue;

      const stepStarted = this.clock();
      const idempotencyKey = existing?.idempotencyKey ?? `${current.id}:${stepName}`;
      const retryCount = existing?.retryCount ?? 0;
      let outcome: StepOutcome;
      let errorMessage: string | null = null;
      let decision: Decision = 'executed';
      let finalRetry = retryCount;
      let sawSigningFailure = false;

      try {
        outcome = await this.runStepWithRetry(stepName, current, existing ?? null, {
          idempotencyKey,
          initialRetry: retryCount,
        });
        decision = outcome.decision;
        finalRetry = (outcome.resultJson._retries as number) ?? retryCount;
      } catch (err) {
        decision = 'failed';
        errorMessage = err instanceof Error ? err.message : String(err);
        outcome = {
          decision: 'failed',
          actor: 'system',
          policyRule: null,
          resultJson: { error: errorMessage },
        };
        if (stepName === 'contract_signed') sawSigningFailure = true;
        this.deps.logger.error(
          { runId: current.id, stepName, err: errorMessage },
          'tender-to-contract: step failed',
        );
      }

      const stepCompleted = this.clock();
      await this.deps.store.recordStep({
        runId: current.id,
        tenantId: current.tenantId,
        stepName,
        stepIndex: i,
        decision,
        actor: outcome.actor,
        policyRule: outcome.policyRule,
        startedAt: stepStarted.toISOString(),
        completedAt: stepCompleted.toISOString(),
        durationMs: stepCompleted.getTime() - stepStarted.getTime(),
        resultJson: outcome.resultJson,
        errorMessage,
        idempotencyKey,
        retryCount: finalRetry,
      });

      if (decision === 'failed') {
        if (sawSigningFailure) {
          // Compensate: rescind the award.
          const compensated = await this.compensateAfterSigningFailure(
            current,
            errorMessage ?? 'signing failed',
          );
          return compensated;
        }
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
        await this.safePublish({
          type: 'TenderAwaitingApproval',
          tenantId: current.tenantId,
          runId: current.id,
          payload: { stepName, policyRule: outcome.policyRule },
        });
        return current;
      }
    }

    current = await this.deps.store.updateRun(current.id, current.tenantId, {
      status: 'completed',
      completedAt: this.clock().toISOString(),
    });

    await this.safePublish({
      type: 'TenderCompleted',
      tenantId: current.tenantId,
      runId: current.id,
      payload: { tenderKey: current.tenderKey },
    });

    return current;
  }

  private async runStepWithRetry(
    stepName: Step,
    run: RunState,
    previous: StepRecord | null,
    opts: { idempotencyKey: string; initialRetry: number },
  ): Promise<StepOutcome> {
    let attempt = opts.initialRetry;
    let lastErr: unknown = null;
    while (attempt <= this.maxRetries) {
      try {
        const outcome = await this.runStep(stepName, run, previous, opts.idempotencyKey);
        return {
          ...outcome,
          resultJson: { ...outcome.resultJson, _retries: attempt },
        };
      } catch (err) {
        lastErr = err;
        attempt += 1;
        if (attempt > this.maxRetries) break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async runStep(
    stepName: Step,
    run: RunState,
    previous: StepRecord | null,
    idempotencyKey: string,
  ): Promise<StepOutcome> {
    switch (stepName) {
      case 'requirement_spec':
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: {
            scope: run.scope,
            budgetMinor: run.budgetMinor,
            frozenAt: this.clock().toISOString(),
          },
        };
      case 'publish_tender': {
        const res = await this.deps.tender.publishTender({
          tenantId: run.tenantId,
          scope: run.scope,
          budgetMinor: run.budgetMinor,
          currency: run.currency,
          idempotencyKey,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { tenderId: res.tenderId, publishedAt: res.publishedAt },
        };
      }
      case 'bids_collected': {
        const pub = await this.deps.store.findStep(run.id, 'publish_tender');
        const tenderId = pub?.resultJson.tenderId;
        if (typeof tenderId !== 'string') throw new Error('tenderId missing');
        const res = await this.deps.tender.collectBids({
          tenantId: run.tenantId,
          tenderId,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { tenderId, bids: res.bids },
        };
      }
      case 'shortlist': {
        const pub = await this.deps.store.findStep(run.id, 'publish_tender');
        const bidsStep = await this.deps.store.findStep(run.id, 'bids_collected');
        const tenderId = pub?.resultJson.tenderId;
        const bids = (bidsStep?.resultJson.bids ??
          []) as ReadonlyArray<{
          vendorId: string;
          amountMinor: number;
          score: number;
        }>;
        if (typeof tenderId !== 'string') throw new Error('tenderId missing');
        if (bids.length === 0) throw new Error('no bids to shortlist');
        const res = await this.deps.tender.shortlist({
          tenantId: run.tenantId,
          tenderId,
          bids,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: {
            shortlistedVendorIds: res.shortlistedVendorIds,
            topPick: res.topPick,
          },
        };
      }
      case 'award':
        return this.stepAward(run, previous, idempotencyKey);
      case 'contract_drafted': {
        const aw = await this.deps.store.findStep(run.id, 'award');
        const awardId = aw?.resultJson.awardId;
        if (typeof awardId !== 'string') throw new Error('awardId missing');
        const res = await this.deps.contract.draftContract({
          tenantId: run.tenantId,
          awardId,
          idempotencyKey,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { contractId: res.contractId, awardId },
        };
      }
      case 'contract_signed': {
        const drft = await this.deps.store.findStep(run.id, 'contract_drafted');
        const contractId = drft?.resultJson.contractId;
        if (typeof contractId !== 'string') throw new Error('contractId missing');
        const res = await this.deps.contract.signContract({
          tenantId: run.tenantId,
          contractId,
          idempotencyKey,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { contractId, signedAt: res.signedAt },
        };
      }
      case 'vendor_onboarded': {
        const sh = await this.deps.store.findStep(run.id, 'shortlist');
        const drft = await this.deps.store.findStep(run.id, 'contract_drafted');
        const topPick = sh?.resultJson.topPick as
          | { vendorId: string; amountMinor: number }
          | undefined;
        const contractId = drft?.resultJson.contractId;
        if (!topPick || typeof contractId !== 'string') {
          throw new Error('topPick or contractId missing');
        }
        const res = await this.deps.onboarding.onboardVendor({
          tenantId: run.tenantId,
          vendorId: topPick.vendorId,
          contractId,
          idempotencyKey,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { vendorProfileId: res.vendorProfileId, vendorId: topPick.vendorId },
        };
      }
    }
  }

  private async stepAward(
    run: RunState,
    previous: StepRecord | null,
    idempotencyKey: string,
  ): Promise<StepOutcome> {
    const sh = await this.deps.store.findStep(run.id, 'shortlist');
    const topPick = sh?.resultJson.topPick as
      | { vendorId: string; amountMinor: number }
      | undefined;
    const pub = await this.deps.store.findStep(run.id, 'publish_tender');
    const tenderId = pub?.resultJson.tenderId as string | undefined;
    if (!topPick || !tenderId) throw new Error('shortlist or tender missing');

    if (previous?.decision === 'approved') {
      return this.executeAward(run, topPick, tenderId, idempotencyKey, previous.actor);
    }

    const policy = await this.deps.autonomy.getPolicy(run.tenantId);
    if (!policy.autonomousModeEnabled) {
      return {
        decision: 'awaiting_approval',
        actor: 'system',
        policyRule: 'master_switch_off',
        resultJson: {
          reason: 'Autonomous mode disabled — award needs approval.',
          topPick,
        },
      };
    }
    if (topPick.amountMinor > policy.procurement.autoAwardUnderMinor) {
      return {
        decision: 'awaiting_approval',
        actor: 'system',
        policyRule: 'procurement.over_auto_award_threshold',
        resultJson: {
          reason: 'Award amount exceeds auto-award threshold — approval required.',
          topPick,
          threshold: policy.procurement.autoAwardUnderMinor,
        },
      };
    }
    return this.executeAward(run, topPick, tenderId, idempotencyKey, 'system');
  }

  private async executeAward(
    run: RunState,
    topPick: { vendorId: string; amountMinor: number },
    tenderId: string,
    idempotencyKey: string,
    actor: string,
  ): Promise<StepOutcome> {
    const res = await this.deps.award.awardContract({
      tenantId: run.tenantId,
      tenderId,
      vendorId: topPick.vendorId,
      amountMinor: topPick.amountMinor,
      idempotencyKey,
    });
    await this.safePublish({
      type: 'TenderAwardSent',
      tenantId: run.tenantId,
      runId: run.id,
      payload: { awardId: res.awardId, vendorId: topPick.vendorId },
    });
    return {
      decision: actor === 'system' ? 'auto_approved' : 'executed',
      actor,
      policyRule: 'procurement.auto_awarded',
      resultJson: {
        awardId: res.awardId,
        vendorId: topPick.vendorId,
        amountMinor: topPick.amountMinor,
      },
    };
  }

  private async compensateAfterSigningFailure(
    run: RunState,
    reason: string,
  ): Promise<RunState> {
    const compensations: Array<{ action: string; ok: boolean }> = [];
    const aw = await this.deps.store.findStep(run.id, 'award');
    const awardId = aw?.resultJson.awardId;
    if (typeof awardId === 'string') {
      try {
        await this.deps.award.rescindAward({ tenantId: run.tenantId, awardId });
        compensations.push({ action: 'rescind_award', ok: true });
      } catch (err) {
        compensations.push({ action: 'rescind_award', ok: false });
        this.deps.logger.warn(
          {
            runId: run.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'tender-to-contract: rescind_award failed (non-fatal)',
        );
      }
    }
    const updated = await this.deps.store.updateRun(run.id, run.tenantId, {
      status: 'compensated',
      completedAt: this.clock().toISOString(),
      lastError: reason,
      summary: { compensations, reason },
    });
    await this.safePublish({
      type: 'TenderCompensated',
      tenantId: run.tenantId,
      runId: run.id,
      payload: { compensations, reason },
    });
    return updated;
  }

  private async safePublish(event: {
    readonly type:
      | 'TenderStarted'
      | 'TenderAwardSent'
      | 'TenderCompleted'
      | 'TenderCompensated'
      | 'TenderAwaitingApproval';
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
        'tender-to-contract: event publish failed (non-fatal)',
      );
    }
  }
}

function isTerminalDecision(decision: Decision): boolean {
  return (
    decision === 'executed' ||
    decision === 'auto_approved' ||
    decision === 'skipped' ||
    decision === 'compensated'
  );
}
