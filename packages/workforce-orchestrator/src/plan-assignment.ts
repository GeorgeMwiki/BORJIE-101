/**
 * Piece M — planAssignment(): pure assignment-plan preview.
 *
 * This is the read-only, side-effect-free *front half* of `assignTask()`.
 * It composes the three pure kernel functions that `assign-task.ts`
 * already exports — `deriveRiskTier`, `pickCadence`, and
 * `buildFollowupSchedule` — into a single "what would happen if I
 * assigned this?" preview, WITHOUT touching the store, audit chain,
 * channel, or any other `WorkforceDeps` port.
 *
 * Why it exists: the gateway needs to surface the orchestrator's real
 * risk-tier + HITL-gate + followup-cadence logic behind an HTTP route
 * (see `services/api-gateway/src/routes/mining/assignment-planner.hono.ts`)
 * without standing up the full Drizzle-backed `WorkforceStore` composition
 * that `assignTask()` requires. `assignTask()` remains the canonical
 * *write* path; this is the canonical *preview* path that mirrors its
 * kernel decisions exactly (it calls the same functions), so a caller can
 * render a dispatch preview before committing the assignment.
 *
 * Complements — does NOT duplicate — the gateway's
 * `tasks-suggest.hono.ts`, which answers a different question ("WHO should
 * I assign this to?" — candidate ranking). This answers "given a chosen
 * assignee + task, WHAT risk tier / HITL gate / follow-up cadence applies?".
 *
 * Immutability: returns a fresh object; the inputs are never mutated.
 */

import { z } from 'zod';
import {
  buildFollowupSchedule,
  deriveRiskTier,
  pickCadence,
} from './assign-task.js';
import { type CadenceKind, type RiskTier } from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// Input — a subset of AssignTaskInput sufficient for the preview. We do not
// require assignee/assignedBy here because the preview is independent of the
// chosen worker (those only matter at write time in assignTask()).
// ─────────────────────────────────────────────────────────────────────────

export const PlanAssignmentInputSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  /** Caller hint; the kernel may escalate upward (never downward). */
  riskHint: z.enum(['LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN']).default('LOW'),
  /** ISO timestamp the work is due, or null/omitted for open-ended. */
  dueAt: z.string().datetime().nullable().optional(),
  /** Optional explicit cadence; auto-chosen from risk/priority/horizon if omitted. */
  cadenceKinds: z
    .array(z.enum(['daily', 'mid_week', 'end_of_week', 'one_shot']))
    .optional(),
  /**
   * ISO "now" for deterministic previews/tests. Defaults to the call time.
   * The package never reaches for a clock itself, so the caller supplies it.
   */
  nowIso: z.string().datetime().optional(),
});

export type PlanAssignmentInput = z.infer<typeof PlanAssignmentInputSchema>;

export interface PlannedFollowup {
  scheduledAt: string;
  cadenceKind: CadenceKind;
}

export interface AssignmentPlan {
  /** Risk tier the kernel derived (>= the caller hint). */
  riskTier: RiskTier;
  /** True when the derived tier forces a human-in-the-loop gate. */
  hitlRequired: boolean;
  /** The cadence kinds chosen (either caller-supplied or auto-picked). */
  cadenceKinds: ReadonlyArray<CadenceKind>;
  /** The concrete follow-up schedule the assignment would produce. */
  followups: ReadonlyArray<PlannedFollowup>;
  /** Bilingual one-line rationale for the derived tier (EN/SW per locale purity). */
  rationale: { en: string; sw: string };
}

// ─────────────────────────────────────────────────────────────────────────
// Pure preview. No I/O, no ports, no mutation.
// ─────────────────────────────────────────────────────────────────────────

export function planAssignment(rawInput: PlanAssignmentInput): AssignmentPlan {
  const input = PlanAssignmentInputSchema.parse(rawInput);

  const nowMs = input.nowIso ? new Date(input.nowIso).getTime() : Date.now();
  const dueAtMs = input.dueAt ? new Date(input.dueAt).getTime() : null;

  const riskTier = deriveRiskTier({
    hint: input.riskHint,
    title: input.title,
    description: input.description,
    priority: input.priority,
  });
  const hitlRequired = riskTier === 'HIGH' || riskTier === 'SOVEREIGN';

  const cadenceKinds =
    input.cadenceKinds ??
    pickCadence({
      riskTier,
      priority: input.priority,
      dueAtMs,
      nowMs,
    });

  const schedule = buildFollowupSchedule({ cadenceKinds, nowMs, dueAtMs });
  const followups: PlannedFollowup[] = schedule.map((slot) => ({
    scheduledAt: slot.scheduledAt.toISOString(),
    cadenceKind: slot.cadenceKind,
  }));

  return {
    riskTier,
    hitlRequired,
    cadenceKinds,
    followups,
    rationale: rationaleFor(riskTier, hitlRequired),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Bilingual rationale — strictly single-language strings per side so the
// caller can render exactly one locale (no EN/SW mixing).
// ─────────────────────────────────────────────────────────────────────────

function rationaleFor(
  riskTier: RiskTier,
  hitlRequired: boolean,
): { en: string; sw: string } {
  if (hitlRequired) {
    return {
      en: `Risk tier ${riskTier}: human approval required before dispatch.`,
      sw: `Kiwango cha hatari ${riskTier}: idhini ya binadamu inahitajika kabla ya kutuma.`,
    };
  }
  return {
    en: `Risk tier ${riskTier}: may be auto-dispatched with scheduled follow-ups.`,
    sw: `Kiwango cha hatari ${riskTier}: yaweza kutumwa kiotomatiki na ufuatiliaji uliopangwa.`,
  };
}
