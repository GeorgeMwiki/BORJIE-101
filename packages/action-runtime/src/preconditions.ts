/**
 * @borjie/action-runtime — preconditions.ts
 *
 * Pluggable precondition evaluation. The runtime calls
 * `evaluatePreconditions()` BEFORE every step's execute(). If any
 * precondition fails, the step transitions to FAILED and the saga's
 * compensation drive starts on the prior SUCCEEDED steps.
 *
 * The default precondition handlers expect injection via the
 * `PreconditionPorts` interface so this module is testable without
 * touching any IO.
 */

import { type Precondition } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Ports — injected from the runtime composition root
// ─────────────────────────────────────────────────────────────────────

export interface PreconditionPorts {
  /**
   * @returns true when the platform / tenant kill-switch is in an
   * ALLOW state. Fail-closed: errors return false.
   */
  readonly isKillSwitchOpen: (args: { tenantId: string }) => Promise<boolean>;
  /**
   * @returns true when the persona is still bound to a user (i.e. the
   * proposing actor's authority hasn't been revoked since the plan
   * was created).
   */
  readonly isPersonaStillBound: (args: {
    tenantId: string;
    personaId: string;
  }) => Promise<boolean>;
  /**
   * @returns true when the plan has at least `requiredMicros` budget
   * remaining (budgetMicros - budgetUsedMicros).
   */
  readonly hasBudgetRemaining: (args: {
    planId: string;
    tenantId: string;
    requiredMicros: number;
  }) => Promise<boolean>;
  /**
   * @returns true when the autonomy cap allows the given action kind
   * for the tenant + persona today.
   */
  readonly isAutonomyCapWithinLimit: (args: {
    tenantId: string;
    personaId: string;
    actionKind: string;
  }) => Promise<boolean>;
  /**
   * @returns true when the idempotency key hasn't been consumed for
   * the tenant. Consumption recorded by the saga on step SUCCEEDED.
   */
  readonly isIdempotencyUnconsumed: (args: {
    tenantId: string;
    toolCallRef: string;
  }) => Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────
// Evaluation context
// ─────────────────────────────────────────────────────────────────────

export interface PreconditionContext {
  readonly tenantId: string;
  readonly personaId: string;
  readonly planId: string;
  readonly stepIndex: number;
  readonly stepKind: string;
  readonly toolCallRef: string | null;
  readonly requiredMicros: number;
  /**
   * Records of prior SUCCEEDED step indices the saga has already
   * driven. Used by the `parent_step_succeeded` predicate.
   */
  readonly succeededStepIndices: ReadonlyArray<number>;
}

export interface PreconditionResult {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<{
    readonly kind: string;
    readonly message: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────────────────

export async function evaluatePreconditions(args: {
  readonly preconditions: ReadonlyArray<Precondition>;
  readonly context: PreconditionContext;
  readonly ports: PreconditionPorts;
}): Promise<PreconditionResult> {
  const failures: Array<{ kind: string; message: string }> = [];

  for (const pre of args.preconditions) {
    try {
      const ok = await evaluateOne(pre, args.context, args.ports);
      if (!ok) {
        failures.push({
          kind: pre.kind,
          message:
            pre.failureMessage ?? `precondition ${pre.kind} not satisfied`,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `precondition ${pre.kind} threw`;
      // Fail-closed on any handler exception.
      failures.push({ kind: pre.kind, message });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

async function evaluateOne(
  pre: Precondition,
  ctx: PreconditionContext,
  ports: PreconditionPorts,
): Promise<boolean> {
  switch (pre.kind) {
    case 'kill_switch_open':
      return ports.isKillSwitchOpen({ tenantId: ctx.tenantId });
    case 'persona_still_bound':
      return ports.isPersonaStillBound({
        tenantId: ctx.tenantId,
        personaId: ctx.personaId,
      });
    case 'budget_remaining':
      return ports.hasBudgetRemaining({
        planId: ctx.planId,
        tenantId: ctx.tenantId,
        requiredMicros: ctx.requiredMicros,
      });
    case 'autonomy_cap_within_limit':
      return ports.isAutonomyCapWithinLimit({
        tenantId: ctx.tenantId,
        personaId: ctx.personaId,
        actionKind: ctx.stepKind,
      });
    case 'idempotency_unconsumed': {
      if (!ctx.toolCallRef) {
        // No key = the step opted out of idempotency — pass.
        return true;
      }
      return ports.isIdempotencyUnconsumed({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef,
      });
    }
    case 'parent_step_succeeded': {
      const requiredIndex = pre.params?.['stepIndex'];
      if (typeof requiredIndex !== 'number') {
        return false;
      }
      return ctx.succeededStepIndices.includes(requiredIndex);
    }
    case 'expression': {
      // Reserved for future expression DSL — until then, undefined-by-default
      // means the precondition is considered satisfied so plans
      // authored against an as-yet-unsupported predicate don't hard
      // fail. We log via the handler that wraps this call.
      return true;
    }
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// In-memory ports for tests
// ─────────────────────────────────────────────────────────────────────

export function createPermissivePreconditionPorts(): PreconditionPorts {
  return {
    isKillSwitchOpen: async () => true,
    isPersonaStillBound: async () => true,
    hasBudgetRemaining: async () => true,
    isAutonomyCapWithinLimit: async () => true,
    isIdempotencyUnconsumed: async () => true,
  };
}
