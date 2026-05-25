/**
 * ArrearsLadderOrchestrator — walks an arrears case through the
 * escalation ladder, with idempotency, retry, compensation, and
 * policy-gated escalation + write-off.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

import {
  ARREARS_LADDER_STEPS,
  type ApproveStepInput,
  type ArrearsLadderOrchestratorDeps,
  type Decision,
  type RunState,
  type Step,
  type StepRecord,
  type TriggerRunInput,
  type TriggerRunResult,
} from './types.js';

const DEFAULT_MAX_RETRIES = 2;

export class ArrearsLadderAlreadyCompletedError extends Error {
  readonly code = 'ARREARS_LADDER_ALREADY_COMPLETED';
  readonly runId: string;
  constructor(runId: string) {
    super(`Arrears ladder already completed for this lease (run ${runId}).`);
    this.runId = runId;
  }
}

export class ArrearsLadderRunNotFoundError extends Error {
  readonly code = 'ARREARS_LADDER_RUN_NOT_FOUND';
}

export class ArrearsLadderStepNotGatedError extends Error {
  readonly code = 'ARREARS_LADDER_STEP_NOT_GATED';
}

interface StepOutcome {
  readonly decision: Decision;
  readonly actor: string;
  readonly policyRule: string | null;
  readonly resultJson: Record<string, unknown>;
}

export class ArrearsLadderOrchestrator {
  private readonly deps: ArrearsLadderOrchestratorDeps;
  private readonly maxRetries: number;
  private readonly clock: () => Date;
  private readonly idGen: () => string;

  constructor(deps: ArrearsLadderOrchestratorDeps) {
    this.deps = deps;
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.clock = deps.clock ?? (() => new Date());
    this.idGen =
      deps.idGen ?? (() => `al_${Math.random().toString(36).slice(2)}_${Date.now()}`);
  }

  async triggerRun(input: TriggerRunInput): Promise<TriggerRunResult> {
    const existing = await this.deps.store.findRunByLease(
      input.tenantId,
      input.leaseId,
    );

    if (existing) {
      if (existing.status === 'completed' || existing.status === 'compensated') {
        throw new ArrearsLadderAlreadyCompletedError(existing.id);
      }
      this.deps.logger.info(
        { runId: existing.id, status: existing.status },
        'arrears-ladder: resuming existing run',
      );
      const resumed = await this.executeRun(existing);
      return { run: resumed, resumed: true };
    }

    const run = await this.deps.store.createRun({
      tenantId: input.tenantId,
      leaseId: input.leaseId,
      tenantPartyId: input.tenantPartyId,
      outstandingMinor: input.outstandingMinor,
      currency: input.currency,
      trigger: input.trigger,
      triggeredBy: input.triggeredBy,
    });

    await this.safePublish({
      type: 'ArrearsLadderStarted',
      tenantId: input.tenantId,
      runId: run.id,
      payload: {
        leaseId: input.leaseId,
        outstandingMinor: input.outstandingMinor,
        currency: input.currency,
      },
    });

    const completed = await this.executeRun(run);
    return { run: completed, resumed: false };
  }

  async listRuns(tenantId: string, limit = 20): Promise<readonly RunState[]> {
    return this.deps.store.listRuns(tenantId, Math.min(100, Math.max(1, limit)));
  }

  async getRun(runId: string, tenantId: string): Promise<RunState> {
    const run = await this.deps.store.findRunById(runId, tenantId);
    if (!run) throw new ArrearsLadderRunNotFoundError(runId);
    return run;
  }

  async approveStep(input: ApproveStepInput): Promise<RunState> {
    const run = await this.deps.store.findRunById(input.runId, input.tenantId);
    if (!run) throw new ArrearsLadderRunNotFoundError(input.runId);

    const existingStep = await this.deps.store.findStep(run.id, input.stepName);
    if (!existingStep || existingStep.decision !== 'awaiting_approval') {
      throw new ArrearsLadderStepNotGatedError(
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
      durationMs:
        now.getTime() - new Date(existingStep.startedAt).getTime(),
      resultJson: {
        ...existingStep.resultJson,
        approvedBy: input.approverUserId,
      },
      errorMessage: null,
      idempotencyKey: existingStep.idempotencyKey,
      retryCount: existingStep.retryCount,
    });

    const refreshed = await this.deps.store.findRunById(run.id, run.tenantId);
    if (!refreshed) throw new ArrearsLadderRunNotFoundError(run.id);
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

    for (let i = 0; i < ARREARS_LADDER_STEPS.length; i++) {
      const stepName = ARREARS_LADDER_STEPS[i];
      const existing = await this.deps.store.findStep(current.id, stepName);
      if (existing && isTerminalDecision(existing.decision)) {
        continue;
      }

      // Between-steps compensation check: if the tenant paid, run
      // compensation + close the ladder.
      if (i > 0) {
        const paid = await this.deps.payments.hasSettledSince({
          tenantId: current.tenantId,
          leaseId: current.leaseId,
          since: current.startedAt,
        });
        if (paid) {
          const compensated = await this.compensate(current);
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
        finalRetry = outcome.resultJson._retries as number ?? retryCount;
      } catch (err) {
        decision = 'failed';
        errorMessage = err instanceof Error ? err.message : String(err);
        outcome = {
          decision: 'failed',
          actor: 'system',
          policyRule: null,
          resultJson: { error: errorMessage },
        };
        this.deps.logger.error(
          { runId: current.id, stepName, err: errorMessage },
          'arrears-ladder: step failed',
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
          type: 'ArrearsLadderAwaitingApproval',
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
      type: 'ArrearsLadderCompleted',
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
        this.deps.logger.warn(
          {
            runId: run.id,
            stepName,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'arrears-ladder: step retrying',
        );
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
      case 'soft_reminder':
        return this.stepReminder(run, idempotencyKey, 'soft');
      case 'firm_reminder':
        return this.stepReminder(run, idempotencyKey, 'firm');
      case 'final_notice':
        return this.stepReminder(run, idempotencyKey, 'final');
      case 'case_escalation':
        return this.stepEscalation(run, previous, idempotencyKey);
      case 'settlement_offer':
        return this.stepSettlementOffer(run, idempotencyKey);
      case 'write_off_decision':
        return this.stepWriteOffDecision(run, previous, idempotencyKey);
    }
  }

  private async stepReminder(
    run: RunState,
    idempotencyKey: string,
    severity: 'soft' | 'firm' | 'final',
  ): Promise<StepOutcome> {
    const res = await this.deps.notices.sendReminder({
      tenantId: run.tenantId,
      leaseId: run.leaseId,
      tenantPartyId: run.tenantPartyId,
      outstandingMinor: run.outstandingMinor,
      currency: run.currency,
      severity,
      idempotencyKey,
    });
    return {
      decision: 'executed',
      actor: 'system',
      policyRule: null,
      resultJson: {
        dispatchId: res.dispatchId,
        scheduledFor: res.scheduledFor,
        severity,
      },
    };
  }

  private async stepEscalation(
    run: RunState,
    previous: StepRecord | null,
    idempotencyKey: string,
  ): Promise<StepOutcome> {
    if (previous?.decision === 'approved') {
      return this.executeEscalation(run, idempotencyKey, previous.actor);
    }
    const policy = await this.deps.autonomy.getPolicy(run.tenantId);
    if (!policy.autonomousModeEnabled) {
      return {
        decision: 'awaiting_approval',
        actor: 'system',
        policyRule: 'master_switch_off',
        resultJson: {
          reason: 'Autonomous mode disabled — approval required to escalate.',
          outstandingMinor: run.outstandingMinor,
        },
      };
    }
    if (run.outstandingMinor < policy.arrears.autoEscalateOverMinor) {
      return {
        decision: 'awaiting_approval',
        actor: 'system',
        policyRule: 'arrears.below_auto_escalate_threshold',
        resultJson: {
          reason: 'Outstanding under auto-escalate threshold — approval required.',
          outstandingMinor: run.outstandingMinor,
          threshold: policy.arrears.autoEscalateOverMinor,
        },
      };
    }
    return this.executeEscalation(run, idempotencyKey, 'system');
  }

  private async executeEscalation(
    run: RunState,
    idempotencyKey: string,
    actor: string,
  ): Promise<StepOutcome> {
    const res = await this.deps.escalation.escalateToLegal({
      tenantId: run.tenantId,
      leaseId: run.leaseId,
      outstandingMinor: run.outstandingMinor,
      idempotencyKey,
    });
    return {
      decision: actor === 'system' ? 'auto_approved' : 'executed',
      actor,
      policyRule: 'arrears.auto_escalated',
      resultJson: { caseId: res.caseId },
    };
  }

  private async stepSettlementOffer(
    run: RunState,
    idempotencyKey: string,
  ): Promise<StepOutcome> {
    const res = await this.deps.settlement.createOffer({
      tenantId: run.tenantId,
      leaseId: run.leaseId,
      outstandingMinor: run.outstandingMinor,
      currency: run.currency,
      idempotencyKey,
    });
    return {
      decision: 'executed',
      actor: 'system',
      policyRule: null,
      resultJson: {
        offerId: res.offerId,
        discountPct: res.discountPct,
        instalments: res.instalments,
      },
    };
  }

  private async stepWriteOffDecision(
    run: RunState,
    previous: StepRecord | null,
    idempotencyKey: string,
  ): Promise<StepOutcome> {
    if (previous?.decision === 'approved') {
      return this.executeWriteOff(run, idempotencyKey, previous.actor, 'write_off');
    }
    const policy = await this.deps.autonomy.getPolicy(run.tenantId);
    if (!policy.autonomousModeEnabled) {
      return {
        decision: 'awaiting_approval',
        actor: 'system',
        policyRule: 'master_switch_off',
        resultJson: { reason: 'Autonomous mode disabled — write-off needs approval.' },
      };
    }
    if (run.outstandingMinor <= policy.arrears.autoWriteOffUnderMinor) {
      return this.executeWriteOff(run, idempotencyKey, 'system', 'write_off');
    }
    return {
      decision: 'awaiting_approval',
      actor: 'system',
      policyRule: 'arrears.write_off_over_threshold',
      resultJson: {
        reason: 'Outstanding over auto-write-off threshold — approval required.',
        outstandingMinor: run.outstandingMinor,
        threshold: policy.arrears.autoWriteOffUnderMinor,
      },
    };
  }

  private async executeWriteOff(
    run: RunState,
    idempotencyKey: string,
    actor: string,
    decisionKind: 'write_off' | 'continue_litigation',
  ): Promise<StepOutcome> {
    const res = await this.deps.writeOff.recordDecision({
      tenantId: run.tenantId,
      leaseId: run.leaseId,
      outstandingMinor: run.outstandingMinor,
      decision: decisionKind,
      idempotencyKey,
    });
    return {
      decision: actor === 'system' ? 'auto_approved' : 'executed',
      actor,
      policyRule: 'arrears.write_off_recorded',
      resultJson: {
        decisionKind,
        journalEntryId: res.journalEntryId,
      },
    };
  }

  // -------------------------------------------------------------------
  // Compensation — cancel scheduled notices + rescind escalation
  // -------------------------------------------------------------------

  private async compensate(run: RunState): Promise<RunState> {
    const compensations: Array<{ step: Step; action: string; ok: boolean }> = [];
    const tenantId = run.tenantId;

    for (const stepName of ARREARS_LADDER_STEPS) {
      const step = await this.deps.store.findStep(run.id, stepName);
      if (!step) continue;
      if (stepName === 'firm_reminder' || stepName === 'final_notice') {
        const dispatchId = step.resultJson.dispatchId;
        if (typeof dispatchId === 'string') {
          try {
            await this.deps.notices.cancelReminder({ tenantId, dispatchId });
            compensations.push({ step: stepName, action: 'cancel_reminder', ok: true });
          } catch (err) {
            compensations.push({ step: stepName, action: 'cancel_reminder', ok: false });
            this.deps.logger.warn(
              {
                runId: run.id,
                stepName,
                err: err instanceof Error ? err.message : String(err),
              },
              'arrears-ladder: compensation failed (non-fatal)',
            );
          }
        }
      }
      if (stepName === 'case_escalation') {
        const caseId = step.resultJson.caseId;
        if (typeof caseId === 'string') {
          try {
            await this.deps.escalation.rescindEscalation({ tenantId, caseId });
            compensations.push({ step: stepName, action: 'rescind_escalation', ok: true });
          } catch (err) {
            compensations.push({ step: stepName, action: 'rescind_escalation', ok: false });
            this.deps.logger.warn(
              {
                runId: run.id,
                stepName,
                err: err instanceof Error ? err.message : String(err),
              },
              'arrears-ladder: compensation failed (non-fatal)',
            );
          }
        }
      }
    }

    const updated = await this.deps.store.updateRun(run.id, tenantId, {
      status: 'compensated',
      completedAt: this.clock().toISOString(),
      summary: { compensations },
    });

    await this.safePublish({
      type: 'ArrearsLadderCompensated',
      tenantId,
      runId: run.id,
      payload: { compensations },
    });

    return updated;
  }

  private async safePublish(event: {
    readonly type:
      | 'ArrearsLadderStarted'
      | 'ArrearsLadderCompleted'
      | 'ArrearsLadderCompensated'
      | 'ArrearsLadderAwaitingApproval';
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
        'arrears-ladder: event publish failed (non-fatal)',
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
