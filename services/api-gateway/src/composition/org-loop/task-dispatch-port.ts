/**
 * task-dispatch-port.ts — the spine's ACT seam: a chosen StrategyTrace →
 * a real workforce assignment.
 *
 * THE SPINE STAGE THIS IS
 * -----------------------
 * The self-running-org loop is DETECT-GAP → STRATEGIZE → PICK-PERSON →
 * ASSIGN → DELIVER → GUIDE → COMPLETE → LEARN. This port is the single ACT
 * call that turns a strategy decision (the shape G4 produces) into a durable,
 * delivered assignment: it maps the `StrategyTrace.taskShape` + the chosen
 * `employeeId` + the originating commitment's `evidenceIds` into the
 * orchestrator's `AssignTaskInput`, calls `assignTask(workforceDeps, input)`,
 * and returns the task id + the kernel-derived risk fields. Because
 * `assignTask` already derives the risk tier, schedules followups, fires the
 * kickoff push, and audits, this one call lights ASSIGN + DELIVER + GUIDE.
 *
 * IMPORT DISCIPLINE
 * -----------------
 * Import-light by design: the `StrategyTrace` input shape is defined HERE (a
 * minimal structural contract) so the spine lane (G4) and this keystone lane
 * (G1) share NO cross-lane import — G4 produces this shape, this port consumes
 * it. The only dependency is the orchestrator's `assignTask` + `WorkforceDeps`
 * (already a workspace dep of api-gateway) and the Pino-shim logger.
 *
 * HARD RULES (CLAUDE.md)
 * ----------------------
 *   - Evidence-required: the commitment's `evidenceIds` are threaded into the
 *     assignment's `assetRefs` so the task carries its evidence chain (the
 *     Auditor rail rejects an empty chain upstream; this never drops it).
 *   - Immutability: the AssignTaskInput is a fresh object; never mutate input.
 *   - zod: the StrategyTrace is validated at the boundary before dispatch.
 *   - Pino-shim only; NO console.*.
 */

import { z } from 'zod';
import {
  assignTask,
  type AssignTaskInput,
  type RiskTier,
  type WorkforceDeps,
} from '@borjie/workforce-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

// ─────────────────────────────────────────────────────────────────────
// StrategyTrace — the minimal shape G4 produces + this port consumes.
// Defined here (no cross-lane import) so both lanes pin the SAME contract.
// ─────────────────────────────────────────────────────────────────────

/** The decided task shape the strategist resolved for the detected gap. */
export const TaskShapeSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1),
  /** low | medium | high | urgent — the strategist's urgency read. */
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  /** Jagged-frontier coordinate (licences | royalty | treasury | safety …). */
  competenceDomain: z.string().min(1).optional(),
});

export type TaskShape = z.infer<typeof TaskShapeSchema>;

/**
 * The strategy decision the spine hands to ACT. Carries the task shape, the
 * tenant, who is dispatching (the MD acts as a system user), the CHOSEN
 * employee (the matcher's pick), the commitment's evidence chain, and an
 * optional due date. Kept import-light + structural on purpose.
 */
export const StrategyTraceSchema = z.object({
  tenantId: z.string().min(1),
  /** The user id the assignment is "assigned by" — the MD's system user. */
  assignedByUserId: z.string().min(1),
  /** The employee the matcher chose for this task (orchestrator employee id). */
  chosenEmployeeId: z.string().min(1),
  taskShape: TaskShapeSchema,
  /**
   * Evidence ids carried from the originating commitment. Evidence-required:
   * the spine MUST thread ≥1 so the task is auditable. Empty is allowed at the
   * type level (the upstream Auditor rail enforces non-empty), but the dispatch
   * logs a warning when it is empty so a silent evidence drop is observable.
   */
  evidenceIds: z.array(z.string()).default([]),
  /** Optional ISO due date. */
  dueAt: z.string().nullable().optional(),
  /** Optional caller risk hint — the kernel may only escalate it upward. */
  riskHint: z.enum(['LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN']).optional(),
  /** Optional originating commitment id (for loop close-back correlation). */
  commitmentId: z.string().optional(),
});

export type StrategyTrace = z.infer<typeof StrategyTraceSchema>;

/** What the spine learns back: the task id + the kernel-derived risk fields. */
export interface TaskDispatchResult {
  readonly taskId: string;
  readonly riskTier: RiskTier;
  readonly hitlRequired: boolean;
  /** Whether the kickoff push was delivered in-app (assignTask best-effort). */
  readonly notificationDelivered: boolean;
  /** The number of followups scheduled (closes GUIDE). */
  readonly followupCount: number;
}

export interface TaskDispatchPort {
  /**
   * Map a chosen StrategyTrace → AssignTaskInput, fire assignTask, and return
   * the durable task id + risk fields. Throws only on a genuinely unrecoverable
   * fault (e.g. the chosen employee is not found / inactive — assignTask's own
   * guard); the caller (the spine) decides whether to re-pick or block.
   */
  dispatch(input: StrategyTrace): Promise<TaskDispatchResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Pure mapper — StrategyTrace → AssignTaskInput.
// ─────────────────────────────────────────────────────────────────────

/**
 * Map the validated trace to the orchestrator's `AssignTaskInput`. PURE.
 * Evidence ids ride `assetRefs` (the orchestrator's evidence/asset pointer
 * channel) so the assignment carries its evidence chain end-to-end.
 */
export function strategyTraceToAssignInput(
  trace: StrategyTrace,
): AssignTaskInput {
  // `dueAt` is only spread in when it is a non-empty string — the orchestrator's
  // emitted AssignTaskInput types it as optional `string` (the nullable collapses
  // in the .d.ts), so a `null` is omitted rather than passed (parse fills the
  // default downstream).
  const dueAt =
    typeof trace.dueAt === 'string' && trace.dueAt.length > 0
      ? trace.dueAt
      : undefined;
  return {
    tenantId: trace.tenantId,
    title: trace.taskShape.title,
    description: trace.taskShape.description,
    assignedEmployeeId: trace.chosenEmployeeId,
    assignedByUserId: trace.assignedByUserId,
    priority: trace.taskShape.priority,
    riskHint: trace.riskHint ?? 'LOW',
    // Evidence-required: thread the commitment's evidence chain into the
    // assignment so it is auditable + joins back to the originating gap.
    assetRefs: [...trace.evidenceIds],
    ...(dueAt !== undefined ? { dueAt } : {}),
    // The MD is the persona dispatching — a stable id keeps the audit legible.
    createdByPersonaId: 'mwikila',
  };
}

// ─────────────────────────────────────────────────────────────────────
// The port.
// ─────────────────────────────────────────────────────────────────────

export interface CreateTaskDispatchPortArgs {
  readonly workforceDeps: WorkforceDeps;
  readonly logger?: PinoLikeLogger;
}

/**
 * Build the task-dispatch port over a composed `WorkforceDeps` (the lit
 * synapse). This is the spine's ACT call: it validates the trace, maps it,
 * fires `assignTask`, and returns the task id + risk fields the loop learns on.
 */
export function createTaskDispatchPort(
  args: CreateTaskDispatchPortArgs,
): TaskDispatchPort {
  const { workforceDeps } = args;
  const logger = args.logger ?? createPinoLikeLogger('task-dispatch-port');

  return {
    async dispatch(rawTrace: StrategyTrace): Promise<TaskDispatchResult> {
      const trace = StrategyTraceSchema.parse(rawTrace);

      if (trace.evidenceIds.length === 0) {
        // Evidence-required is enforced upstream (the Auditor rail); a dispatch
        // with an empty chain is observable here so it can never slip silently.
        logger.warn(
          {
            tenantId: trace.tenantId,
            commitmentId: trace.commitmentId ?? null,
            organ: 'task-dispatch',
          },
          'task-dispatch: StrategyTrace carries NO evidenceIds — the assignment will have an empty evidence chain (Evidence-required upstream should have blocked this)',
        );
      }

      const input = strategyTraceToAssignInput(trace);
      const result = await assignTask(workforceDeps, input);

      logger.info(
        {
          tenantId: trace.tenantId,
          taskId: result.assignment.id,
          employeeId: trace.chosenEmployeeId,
          riskTier: result.assignment.riskTier,
          hitlRequired: result.assignment.hitlRequired,
          followupCount: result.followupIds.length,
          delivered: result.notificationDelivered,
          commitmentId: trace.commitmentId ?? null,
        },
        'task-dispatch: assignment dispatched (assign → deliver → guide) — the spine ACT stage fired',
      );

      // The orchestrator's emitted WorkAssignment types id/riskTier/hitlRequired
      // as optional (zod defaults collapse in the .d.ts); they are always present
      // at runtime (assignTask parses through WorkAssignmentSchema), so coalesce
      // to the schema defaults to satisfy the non-optional TaskDispatchResult.
      return Object.freeze({
        taskId: result.assignment.id ?? '',
        riskTier: result.assignment.riskTier ?? 'LOW',
        hitlRequired: result.assignment.hitlRequired ?? false,
        notificationDelivered: result.notificationDelivered,
        followupCount: result.followupIds.length,
      });
    },
  };
}
