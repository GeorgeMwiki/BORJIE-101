/**
 * MoveOutOrchestrator — drives lease move-out: inspection → damage →
 * deduction → refund → close, with dispute compensation.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

import {
  MOVE_OUT_STEPS,
  type ApproveStepInput,
  type Decision,
  type MoveOutOrchestratorDeps,
  type RunState,
  type Step,
  type StepRecord,
  type TriggerRunInput,
  type TriggerRunResult,
} from './types.js';

const DEFAULT_MAX_RETRIES = 2;

export class MoveOutAlreadyCompletedError extends Error {
  readonly code = 'MOVE_OUT_ALREADY_COMPLETED';
  readonly runId: string;
  constructor(runId: string) {
    super(`Move-out already completed for this lease (run ${runId}).`);
    this.runId = runId;
  }
}

export class MoveOutRunNotFoundError extends Error {
  readonly code = 'MOVE_OUT_RUN_NOT_FOUND';
}

export class MoveOutStepNotGatedError extends Error {
  readonly code = 'MOVE_OUT_STEP_NOT_GATED';
}

interface StepOutcome {
  readonly decision: Decision;
  readonly actor: string;
  readonly policyRule: string | null;
  readonly resultJson: Record<string, unknown>;
}

export class MoveOutOrchestrator {
  private readonly deps: MoveOutOrchestratorDeps;
  private readonly maxRetries: number;
  private readonly clock: () => Date;
  private readonly idGen: () => string;

  constructor(deps: MoveOutOrchestratorDeps) {
    this.deps = deps;
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.clock = deps.clock ?? (() => new Date());
    this.idGen =
      deps.idGen ?? (() => `mo_${Math.random().toString(36).slice(2)}_${Date.now()}`);
  }

  async triggerRun(input: TriggerRunInput): Promise<TriggerRunResult> {
    const existing = await this.deps.store.findRunByLease(
      input.tenantId,
      input.leaseId,
    );

    if (existing) {
      if (existing.status === 'completed') {
        throw new MoveOutAlreadyCompletedError(existing.id);
      }
      this.deps.logger.info(
        { runId: existing.id, status: existing.status },
        'move-out: resuming existing run',
      );
      const resumed = await this.executeRun(existing);
      return { run: resumed, resumed: true };
    }

    const run = await this.deps.store.createRun({
      tenantId: input.tenantId,
      leaseId: input.leaseId,
      unitId: input.unitId,
      depositMinor: input.depositMinor,
      currency: input.currency,
      trigger: input.trigger,
      triggeredBy: input.triggeredBy,
    });

    await this.safePublish({
      type: 'MoveOutStarted',
      tenantId: input.tenantId,
      runId: run.id,
      payload: { leaseId: input.leaseId, unitId: input.unitId },
    });

    const completed = await this.executeRun(run);
    return { run: completed, resumed: false };
  }

  async listRuns(tenantId: string, limit = 20): Promise<readonly RunState[]> {
    return this.deps.store.listRuns(tenantId, Math.min(100, Math.max(1, limit)));
  }

  async getRun(runId: string, tenantId: string): Promise<RunState> {
    const run = await this.deps.store.findRunById(runId, tenantId);
    if (!run) throw new MoveOutRunNotFoundError(runId);
    return run;
  }

  async approveStep(input: ApproveStepInput): Promise<RunState> {
    const run = await this.deps.store.findRunById(input.runId, input.tenantId);
    if (!run) throw new MoveOutRunNotFoundError(input.runId);

    const existingStep = await this.deps.store.findStep(run.id, input.stepName);
    if (!existingStep || existingStep.decision !== 'awaiting_approval') {
      throw new MoveOutStepNotGatedError(
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
    if (!refreshed) throw new MoveOutRunNotFoundError(run.id);
    return this.executeRun(refreshed);
  }

  /**
   * Public compensation hook — reverses refund + damage assessment when a
   * dispute arrives after the run has already executed the payout.
   */
  async reopenOnDispute(runId: string, tenantId: string): Promise<RunState> {
    const run = await this.deps.store.findRunById(runId, tenantId);
    if (!run) throw new MoveOutRunNotFoundError(runId);

    const refundStep = await this.deps.store.findStep(run.id, 'refund_issued');
    const damageStep = await this.deps.store.findStep(run.id, 'damage_assessed');
    const compensations: Array<{ step: Step; action: string; ok: boolean }> = [];

    if (refundStep) {
      const refundId = refundStep.resultJson.refundId;
      if (typeof refundId === 'string') {
        try {
          await this.deps.refund.reverseRefund({ tenantId, refundId });
          compensations.push({
            step: 'refund_issued',
            action: 'reverse_refund',
            ok: true,
          });
        } catch (err) {
          compensations.push({
            step: 'refund_issued',
            action: 'reverse_refund',
            ok: false,
          });
          this.deps.logger.warn(
            {
              runId: run.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'move-out: refund reversal failed (non-fatal)',
          );
        }
      }
    }

    if (damageStep) {
      const assessmentId = damageStep.resultJson.assessmentId;
      if (typeof assessmentId === 'string') {
        try {
          await this.deps.damageAssessment.reverseAssessment({
            tenantId,
            assessmentId,
          });
          compensations.push({
            step: 'damage_assessed',
            action: 'reverse_assessment',
            ok: true,
          });
        } catch (err) {
          compensations.push({
            step: 'damage_assessed',
            action: 'reverse_assessment',
            ok: false,
          });
        }
      }
    }

    const updated = await this.deps.store.updateRun(run.id, tenantId, {
      status: 'disputed',
      summary: { compensations, reopenedAt: this.clock().toISOString() },
    });

    await this.safePublish({
      type: 'MoveOutDisputed',
      tenantId,
      runId: run.id,
      payload: { compensations },
    });

    return updated;
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

    for (let i = 0; i < MOVE_OUT_STEPS.length; i++) {
      const stepName = MOVE_OUT_STEPS[i];
      const existing = await this.deps.store.findStep(current.id, stepName);
      if (existing && isTerminalDecision(existing.decision)) continue;

      // Mid-run dispute check: only after deduction_computed (index 4)
      // does a dispute make sense; before that there's nothing to dispute.
      if (i >= MOVE_OUT_STEPS.indexOf('refund_calculated')) {
        const disputed = await this.deps.disputes.hasActiveDispute({
          tenantId: current.tenantId,
          leaseId: current.leaseId,
        });
        if (disputed) {
          const compensated = await this.reopenOnDispute(current.id, current.tenantId);
          return compensated;
        }
      }

      const stepStarted = this.clock();
      const idempotencyKey = existing?.idempotencyKey ?? `${current.id}:${stepName}`;
      const retryCount = existing?.retryCount ?? 0;
      let outcome: StepOutcome;
      let errorMessage: string | null = null;
      let decision: Decision = 'executed';
      let finalRetry = retryCount;

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
          type: 'MoveOutAwaitingApproval',
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
      type: 'MoveOutCompleted',
      tenantId: current.tenantId,
      runId: current.id,
      payload: { leaseId: current.leaseId },
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
      case 'notice_received':
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { noticeAt: this.clock().toISOString() },
        };
      case 'final_inspection_scheduled': {
        const res = await this.deps.inspection.scheduleInspection({
          tenantId: run.tenantId,
          unitId: run.unitId,
          idempotencyKey,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { inspectionId: res.inspectionId, scheduledFor: res.scheduledFor },
        };
      }
      case 'inspection_completed': {
        const sched = await this.deps.store.findStep(run.id, 'final_inspection_scheduled');
        const inspectionId = sched?.resultJson.inspectionId;
        if (typeof inspectionId !== 'string') {
          throw new Error('inspectionId not found in scheduled step');
        }
        const res = await this.deps.inspection.completeInspection({
          tenantId: run.tenantId,
          inspectionId,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: {
            completedAt: res.completedAt,
            damageCount: res.damageCount,
            inspectionId,
          },
        };
      }
      case 'damage_assessed': {
        const sched = await this.deps.store.findStep(run.id, 'final_inspection_scheduled');
        const inspectionId = sched?.resultJson.inspectionId;
        if (typeof inspectionId !== 'string') {
          throw new Error('inspectionId not found');
        }
        const res = await this.deps.damageAssessment.assess({
          tenantId: run.tenantId,
          inspectionId,
          idempotencyKey,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: {
            assessmentId: res.assessmentId,
            totalDamageMinor: res.totalDamageMinor,
          },
        };
      }
      case 'deduction_computed': {
        const dmg = await this.deps.store.findStep(run.id, 'damage_assessed');
        const damageMinor = (dmg?.resultJson.totalDamageMinor as number) ?? 0;
        const res = await this.deps.deduction.compute({
          tenantId: run.tenantId,
          leaseId: run.leaseId,
          damageMinor,
          depositMinor: run.depositMinor,
          idempotencyKey,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { deductionMinor: res.deductionMinor },
        };
      }
      case 'refund_calculated': {
        const ded = await this.deps.store.findStep(run.id, 'deduction_computed');
        const deductionMinor = (ded?.resultJson.deductionMinor as number) ?? 0;
        const res = await this.deps.refund.calculate({
          tenantId: run.tenantId,
          depositMinor: run.depositMinor,
          deductionMinor,
        });
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { refundMinor: res.refundMinor, deductionMinor },
        };
      }
      case 'refund_issued':
        return this.stepRefundIssued(run, previous, idempotencyKey);
      case 'case_closed':
        return {
          decision: 'executed',
          actor: 'system',
          policyRule: null,
          resultJson: { closedAt: this.clock().toISOString() },
        };
    }
  }

  private async stepRefundIssued(
    run: RunState,
    previous: StepRecord | null,
    idempotencyKey: string,
  ): Promise<StepOutcome> {
    const calc = await this.deps.store.findStep(run.id, 'refund_calculated');
    const refundMinor = (calc?.resultJson.refundMinor as number) ?? 0;

    if (refundMinor <= 0) {
      return {
        decision: 'executed',
        actor: 'system',
        policyRule: 'refund.zero_skipped',
        resultJson: { refundMinor: 0, skipped: true },
      };
    }

    if (previous?.decision === 'approved') {
      return this.executeRefund(run, refundMinor, idempotencyKey, previous.actor);
    }

    const policy = await this.deps.autonomy.getPolicy(run.tenantId);
    if (!policy.autonomousModeEnabled) {
      return {
        decision: 'awaiting_approval',
        actor: 'system',
        policyRule: 'master_switch_off',
        resultJson: {
          reason: 'Autonomous mode disabled — refund needs approval.',
          refundMinor,
        },
      };
    }
    if (refundMinor > policy.refunds.autoIssueUnderMinor) {
      return {
        decision: 'awaiting_approval',
        actor: 'system',
        policyRule: 'refund.over_auto_issue_threshold',
        resultJson: {
          reason: 'Refund exceeds auto-issue threshold — approval required.',
          refundMinor,
          threshold: policy.refunds.autoIssueUnderMinor,
        },
      };
    }
    return this.executeRefund(run, refundMinor, idempotencyKey, 'system');
  }

  private async executeRefund(
    run: RunState,
    refundMinor: number,
    idempotencyKey: string,
    actor: string,
  ): Promise<StepOutcome> {
    const res = await this.deps.refund.issueRefund({
      tenantId: run.tenantId,
      leaseId: run.leaseId,
      refundMinor,
      currency: run.currency,
      idempotencyKey,
    });
    return {
      decision: actor === 'system' ? 'auto_approved' : 'executed',
      actor,
      policyRule: 'refund.auto_issued',
      resultJson: { refundId: res.refundId, status: res.status, refundMinor },
    };
  }

  private async safePublish(event: {
    readonly type:
      | 'MoveOutStarted'
      | 'MoveOutCompleted'
      | 'MoveOutDisputed'
      | 'MoveOutAwaitingApproval';
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
        'move-out: event publish failed (non-fatal)',
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
