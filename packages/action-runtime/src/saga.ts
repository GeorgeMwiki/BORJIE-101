/**
 * @borjie/action-runtime — saga.ts
 *
 * Forward execution + reverse compensation in one place. The saga is
 * the runtime contract:
 *
 *   for each step in plan.steps (ordered by stepIndex):
 *     1. check preconditions → fail-closed
 *     2. mark RUNNING + write audit row + start span
 *     3. invoke step handler
 *     4. on SUCCEEDED: mark SUCCEEDED + write audit row + advance budget
 *     5. on FAILED: drive compensation in REVERSE order over prior SUCCEEDED steps
 *
 * The saga itself is pure orchestration. All IO is delegated to ports
 * so the same code runs in tests (in-memory ports) and prod (Temporal
 * activities wrapping real ports).
 */

import { randomUUID } from 'node:crypto';
import {
  ActionRuntimeError,
  type ActionPlan,
  type ActionStep,
  type PersistedActionStep,
  type StepStatus,
} from './types.js';
import {
  evaluatePreconditions,
  type PreconditionPorts,
} from './preconditions.js';
import {
  type StepHandlerRegistry,
  type StepHandlerContext,
} from './step-handlers/index.js';
import {
  type CompensationContext,
  type CompensationRegistry,
} from './compensation-registry.js';
import { type AuditChainWriter } from './audit-chain.js';
import { STEP_BUDGET_DEFAULTS_MICROS } from './budget-defaults.js';

// ─────────────────────────────────────────────────────────────────────
// Persistence port — the saga's read/write surface for action_steps + plan
// ─────────────────────────────────────────────────────────────────────

export interface SagaPersistencePort {
  /** Load plan row + steps. */
  loadPlan: (planId: string, tenantId: string) => Promise<{
    readonly tenantId: string;
    readonly personaId: string;
    readonly status: string;
    readonly budgetMicros: number;
    readonly budgetUsedMicros: number;
    readonly expiresAt: Date;
    readonly steps: ReadonlyArray<PersistedActionStep>;
  } | null>;
  /** Update plan status + bump budget_used + write updatedAt. */
  updatePlanStatus: (args: {
    readonly planId: string;
    readonly tenantId: string;
    readonly status: string;
    readonly budgetUsedDelta?: number;
    readonly auditChainLink?: string;
  }) => Promise<void>;
  /** Update a step row — used between RUNNING / SUCCEEDED / FAILED transitions. */
  updateStep: (args: {
    readonly stepId: string;
    readonly tenantId: string;
    readonly patch: Partial<{
      status: StepStatus;
      attempts: number;
      startedAt: Date;
      finishedAt: Date;
      lastError: string | null;
      auditChainId: string;
      otelSpanId: string;
      payloadJsonb: Readonly<Record<string, unknown>>;
      compensationStepIndex: number;
    }>;
  }) => Promise<void>;
  /** Read the latest step row (for compensation, audit). */
  readStep: (
    stepId: string,
    tenantId: string,
  ) => Promise<PersistedActionStep | null>;
  /** Update quota counters. */
  bumpQuota: (args: {
    readonly tenantId: string;
    readonly personaId: string;
    readonly delta: Partial<{
      plansApproved: number;
      plansExecuted: number;
      moneyMicros: number;
      budgetMicrosUsed: number;
    }>;
  }) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Saga config
// ─────────────────────────────────────────────────────────────────────

export interface SagaConfig {
  readonly handlerRegistry: StepHandlerRegistry;
  readonly compensationRegistry: CompensationRegistry;
  readonly preconditionPorts: PreconditionPorts;
  readonly persistence: SagaPersistencePort;
  readonly auditChain: AuditChainWriter;
  /** Optional logger; defaults to no-op. */
  readonly logger?: {
    info: (meta: object, msg: string) => void;
    warn: (meta: object, msg: string) => void;
    error: (meta: object, msg: string) => void;
  };
  /** OTel span id supplier. Returns null in tests. */
  readonly nextSpanId?: () => string;
}

export interface ExecutePlanArgs {
  readonly plan: ActionPlan;
  /** Set by the caller — typically the plan id from persistence. */
  readonly planId: string;
}

export interface ExecutePlanResult {
  readonly planId: string;
  readonly finalStatus:
    | 'COMPLETED'
    | 'PARTIAL'
    | 'FAILED'
    | 'COMPENSATED'
    | 'COMPENSATION_FAILED';
  readonly succeededSteps: ReadonlyArray<number>;
  readonly failedStep: number | null;
  readonly compensatedSteps: ReadonlyArray<number>;
  readonly failure?: { readonly code: string; readonly message: string };
}

// ─────────────────────────────────────────────────────────────────────
// Saga entry
// ─────────────────────────────────────────────────────────────────────

export async function executePlan(
  args: ExecutePlanArgs,
  cfg: SagaConfig,
): Promise<ExecutePlanResult> {
  const log = cfg.logger;
  const { plan, planId } = args;
  const succeeded: number[] = [];
  let failedStepIdx: number | null = null;
  let failure: { code: string; message: string } | undefined;

  // ── Plan-level audit root ─────────────────────────────────────────
  const turnId = `plan:${planId}`;
  const planRoot = await cfg.auditChain.appendRow({
    tenantId: plan.tenantId,
    action: 'action_plan.execute_started',
    payload: {
      planId,
      personaId: plan.personaId,
      intent: plan.intent,
      stepCount: plan.steps.length,
    },
    turnId,
  });
  await cfg.persistence.updatePlanStatus({
    planId,
    tenantId: plan.tenantId,
    status: 'EXECUTING',
    auditChainLink: planRoot.id,
  });

  // ── Forward execution ─────────────────────────────────────────────
  for (const step of plan.steps) {
    const handler = cfg.handlerRegistry[step.kind];
    if (!handler) {
      failedStepIdx = step.stepIndex;
      failure = {
        code: 'NO_HANDLER',
        message: `no handler registered for step kind ${step.kind}`,
      };
      break;
    }

    const preCtx = {
      tenantId: plan.tenantId,
      personaId: plan.personaId,
      planId,
      stepIndex: step.stepIndex,
      stepKind: step.kind,
      toolCallRef: step.toolCallRef ?? null,
      requiredMicros: STEP_BUDGET_DEFAULTS_MICROS[step.kind],
      succeededStepIndices: succeeded.slice(),
    };
    const preResult = await evaluatePreconditions({
      preconditions: step.preconditions,
      context: preCtx,
      ports: cfg.preconditionPorts,
    });
    if (!preResult.ok) {
      const first = preResult.failures[0];
      failedStepIdx = step.stepIndex;
      failure = {
        code: 'PRECONDITION_FAILED',
        message: first?.message ?? 'precondition failed',
      };
      await writeStepFailureAudit(step, planId, plan.tenantId, failure, cfg);
      break;
    }

    const startedAt = new Date();
    const spanId = cfg.nextSpanId?.() ?? `span_${randomUUID().slice(0, 16)}`;
    const stepId = step.id ?? `as_${planId.slice(3, 11)}_${step.stepIndex}`;

    await cfg.persistence.updateStep({
      stepId,
      tenantId: plan.tenantId,
      patch: { status: 'RUNNING', startedAt, otelSpanId: spanId },
    });

    const startedRow = await cfg.auditChain.appendRow({
      tenantId: plan.tenantId,
      action: `action_step.${step.kind.toLowerCase()}.started`,
      payload: {
        planId,
        stepId,
        stepIndex: step.stepIndex,
        kind: step.kind,
        toolCallRef: step.toolCallRef,
        spanId,
      },
      turnId,
    });

    let attempts = 1;
    const handlerCtx: StepHandlerContext = {
      tenantId: plan.tenantId,
      personaId: plan.personaId,
      planId,
      stepId,
      toolCallRef: step.toolCallRef ?? null,
      otelSpanId: spanId,
      startedAtIso: startedAt.toISOString(),
    };

    let result;
    try {
      result = await handler(step, handlerCtx);
    } catch (err) {
      result = {
        status: 'FAILED' as const,
        error: {
          code: 'HANDLER_THREW',
          message: err instanceof Error ? err.message : 'handler threw',
        },
      };
    }

    const finishedAt = new Date();

    if (result.status === 'SUCCEEDED') {
      const resultPayload = result.resultPayload ?? {};
      // Persist the result payload back onto the step so the compensation
      // handler can find the journalId / fileId / messageId etc.
      const mergedPayload = {
        ...step.payload,
        __result__: resultPayload,
      };
      await cfg.persistence.updateStep({
        stepId,
        tenantId: plan.tenantId,
        patch: {
          status: 'SUCCEEDED',
          finishedAt,
          attempts,
          auditChainId: startedRow.id,
          payloadJsonb: mergedPayload,
        },
      });
      await cfg.auditChain.appendRow({
        tenantId: plan.tenantId,
        action: `action_step.${step.kind.toLowerCase()}.succeeded`,
        payload: {
          planId,
          stepId,
          stepIndex: step.stepIndex,
          result: resultPayload,
        },
        turnId,
      });
      const stepCost = STEP_BUDGET_DEFAULTS_MICROS[step.kind];
      await cfg.persistence.updatePlanStatus({
        planId,
        tenantId: plan.tenantId,
        status: 'EXECUTING',
        budgetUsedDelta: stepCost,
      });
      await cfg.persistence.bumpQuota({
        tenantId: plan.tenantId,
        personaId: plan.personaId,
        delta: {
          budgetMicrosUsed: stepCost,
          ...(step.kind === 'POST_LEDGER'
            ? { moneyMicros: computeMoneyMicrosForStep(step) }
            : {}),
        },
      });
      succeeded.push(step.stepIndex);
      log?.info({ planId, stepIndex: step.stepIndex, kind: step.kind }, 'step succeeded');
    } else {
      failedStepIdx = step.stepIndex;
      failure = result.error ?? {
        code: 'STEP_FAILED',
        message: 'step failed without error',
      };
      await cfg.persistence.updateStep({
        stepId,
        tenantId: plan.tenantId,
        patch: {
          status: 'FAILED',
          finishedAt,
          attempts,
          lastError: failure.message,
          auditChainId: startedRow.id,
        },
      });
      await cfg.auditChain.appendRow({
        tenantId: plan.tenantId,
        action: `action_step.${step.kind.toLowerCase()}.failed`,
        payload: {
          planId,
          stepId,
          stepIndex: step.stepIndex,
          error: failure,
          attempts,
        },
        turnId,
      });
      log?.warn(
        { planId, stepIndex: step.stepIndex, kind: step.kind, error: failure },
        'step failed',
      );
      break;
    }
  }

  // ── Compensation drive on failure ─────────────────────────────────
  if (failedStepIdx !== null) {
    const { compensatedSteps, compensationFailed } = await driveCompensation({
      planId,
      plan,
      succeededIndices: succeeded,
      failureReason: failure?.message ?? 'unknown',
      cfg,
      turnId,
    });
    const finalStatus = compensationFailed
      ? 'COMPENSATION_FAILED'
      : compensatedSteps.length > 0
        ? 'COMPENSATED'
        : 'FAILED';
    await cfg.persistence.updatePlanStatus({
      planId,
      tenantId: plan.tenantId,
      status: finalStatus,
    });
    await cfg.auditChain.appendRow({
      tenantId: plan.tenantId,
      action: 'action_plan.execute_finalised',
      payload: {
        planId,
        finalStatus,
        failedStep: failedStepIdx,
        compensatedSteps,
      },
      turnId,
    });
    return {
      planId,
      finalStatus,
      succeededSteps: succeeded,
      failedStep: failedStepIdx,
      compensatedSteps,
      ...(failure ? { failure } : {}),
    };
  }

  // ── Happy path ────────────────────────────────────────────────────
  await cfg.persistence.updatePlanStatus({
    planId,
    tenantId: plan.tenantId,
    status: 'COMPLETED',
  });
  await cfg.persistence.bumpQuota({
    tenantId: plan.tenantId,
    personaId: plan.personaId,
    delta: { plansExecuted: 1 },
  });
  await cfg.auditChain.appendRow({
    tenantId: plan.tenantId,
    action: 'action_plan.execute_completed',
    payload: { planId, stepCount: plan.steps.length },
    turnId,
  });
  log?.info({ planId, stepCount: plan.steps.length }, 'plan completed');
  return {
    planId,
    finalStatus: 'COMPLETED',
    succeededSteps: succeeded,
    failedStep: null,
    compensatedSteps: [],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Compensation drive — reverse order over SUCCEEDED steps
// ─────────────────────────────────────────────────────────────────────

interface DriveCompensationArgs {
  readonly planId: string;
  readonly plan: ActionPlan;
  readonly succeededIndices: ReadonlyArray<number>;
  readonly failureReason: string;
  readonly cfg: SagaConfig;
  readonly turnId: string;
}

async function driveCompensation(
  args: DriveCompensationArgs,
): Promise<{ compensatedSteps: number[]; compensationFailed: boolean }> {
  const { plan, succeededIndices, cfg } = args;
  const compensated: number[] = [];
  let anyHardFailed = false;

  // Reverse order — last SUCCEEDED step first.
  const reversed = [...succeededIndices].reverse();
  for (const idx of reversed) {
    const stepSpec = plan.steps.find((s) => s.stepIndex === idx);
    if (!stepSpec) continue;
    const stepId = stepSpec.id ?? `as_${args.planId.slice(3, 11)}_${idx}`;
    const persistedStep = await cfg.persistence.readStep(stepId, plan.tenantId);
    if (!persistedStep) {
      cfg.logger?.warn(
        { planId: args.planId, stepIndex: idx },
        'compensation: missing persisted step',
      );
      continue;
    }

    const handler = cfg.compensationRegistry[stepSpec.kind];
    if (!handler) {
      cfg.logger?.info(
        { planId: args.planId, stepIndex: idx, kind: stepSpec.kind },
        'no compensation handler — skipping',
      );
      continue;
    }

    await cfg.persistence.updateStep({
      stepId,
      tenantId: plan.tenantId,
      patch: { status: 'COMPENSATING' },
    });

    const compensatingStepId = `as_comp_${args.planId.slice(3, 11)}_${idx}_${randomUUID().slice(0, 6)}`;
    const ctx: CompensationContext = {
      tenantId: plan.tenantId,
      personaId: plan.personaId,
      planId: args.planId,
      compensatingStepId,
      compensatedAtIso: new Date().toISOString(),
      reason: args.failureReason,
    };

    let result;
    try {
      result = await handler(persistedStep, stepSpec, ctx);
    } catch (err) {
      result = {
        ok: false,
        error: {
          code: 'COMPENSATION_THREW',
          message: err instanceof Error ? err.message : 'compensation threw',
        },
      };
    }

    if (result.ok) {
      await cfg.persistence.updateStep({
        stepId,
        tenantId: plan.tenantId,
        patch: {
          status: 'COMPENSATED',
          compensationStepIndex: idx,
        },
      });
      await cfg.auditChain.appendRow({
        tenantId: plan.tenantId,
        action: `action_step.${stepSpec.kind.toLowerCase()}.compensated`,
        payload: {
          planId: args.planId,
          stepIndex: idx,
          stepId,
          compensationResult: result.resultPayload ?? {},
        },
        turnId: args.turnId,
      });
      compensated.push(idx);
    } else {
      const hard = stepSpec.compensation?.hardCompensation ?? true;
      await cfg.auditChain.appendRow({
        tenantId: plan.tenantId,
        action: `action_step.${stepSpec.kind.toLowerCase()}.compensation_failed`,
        payload: {
          planId: args.planId,
          stepIndex: idx,
          stepId,
          error: result.error,
          hard,
        },
        turnId: args.turnId,
      });
      if (hard) {
        anyHardFailed = true;
        cfg.logger?.error(
          { planId: args.planId, stepIndex: idx, error: result.error },
          'compensation hard-failed',
        );
      }
    }
  }

  return { compensatedSteps: compensated, compensationFailed: anyHardFailed };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function computeMoneyMicrosForStep(step: ActionStep): number {
  const lines = step.payload['lines'];
  if (!Array.isArray(lines)) return 0;
  let total = 0;
  for (const line of lines) {
    if (
      line &&
      typeof line === 'object' &&
      typeof (line as Record<string, unknown>)['amountMinorUnits'] === 'number'
    ) {
      // Sum DEBITs only — the DEBIT side equals the gross volume moved.
      const direction = (line as Record<string, unknown>)['direction'];
      if (direction === 'DEBIT') {
        total += (line as Record<string, unknown>)['amountMinorUnits'] as number;
      }
    }
  }
  return total;
}

async function writeStepFailureAudit(
  step: ActionStep,
  planId: string,
  tenantId: string,
  failure: { code: string; message: string },
  cfg: SagaConfig,
): Promise<void> {
  await cfg.auditChain.appendRow({
    tenantId,
    action: `action_step.${step.kind.toLowerCase()}.precondition_failed`,
    payload: {
      planId,
      stepIndex: step.stepIndex,
      failure,
    },
    turnId: `plan:${planId}`,
  });
}

// Re-export the error type for callers (e.g. the Hono route handler).
export { ActionRuntimeError };
