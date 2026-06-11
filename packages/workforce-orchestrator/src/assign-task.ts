/**
 * Piece M — assignTask entrypoint.
 *
 * Side-effects (in order):
 *   1. Validate input.
 *   2. Look up the assignee employee (cross-tenant guard).
 *   3. Derive risk_tier + hitl_required (kernel decision; never trust caller).
 *   4. Append an ai_audit_chain row for the assignment.
 *   5. Insert the work_assignment.
 *   6. Schedule followups based on (riskTier, dueAt, cadence config).
 *   7. Send a kick-off notification on the employee's default channel.
 *
 * Immutability: every domain row is constructed via spread; no mutation
 * after creation. The DAL is the only mutator.
 */

import { z } from 'zod';
import {
  WorkAssignmentSchema,
  WorkFollowupSchema,
  type CadenceKind,
  type Priority,
  type RiskTier,
  type WorkAssignment,
  type WorkforceDeps,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// Risk lexicon — DOMAIN-PACK DATA, not engine. A caller may inject a
// `riskLexicon` (per vertical / per jurisdiction); the default is the
// bilingual EN/SW mining + treasury + safety-legal set. The property-era
// terms (evict/eviction) were dropped with the property→mining migration.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A bilingual domain-pack risk lexicon. Terms are matched as lowercase
 * substrings of `title + ' ' + description`; a trailing space in a term
 * (e.g. 'fire ') word-bounds it on the right.
 */
export interface RiskLexicon {
  /** Terms that escalate to HIGH (owner approval before dispatch). */
  readonly high: ReadonlyArray<string>;
  /** Terms that escalate to SOVEREIGN (the highest HITL gate). */
  readonly sovereign: ReadonlyArray<string>;
}

/** zod boundary shape for an injected lexicon (validated in AssignTaskInput). */
export const RiskLexiconSchema = z.object({
  high: z.array(z.string().min(1)),
  sovereign: z.array(z.string().min(1)),
});

/**
 * The default mining + treasury + safety-legal lexicon — EN and SW so a
 * single-language Swahili task gates IDENTICALLY to its English twin
 * (bilingual-absolute rule: risk never depends on the author's locale).
 */
export const DEFAULT_RISK_LEXICON: RiskLexicon = Object.freeze({
  high: Object.freeze([
    // Safety-legal (EN). 'fire ' keeps its trailing space so 'firewall' /
    // 'misfired' never false-positive.
    'terminate',
    'fire ',
    'lawsuit',
    'court',
    'arrest',
    'police',
    // Money / mining / treasury (EN). 'licence' + 'license' cover both spellings.
    'payment',
    'royalty',
    'licence',
    'license',
    'suspend',
    'dispute',
    // Swahili equivalents.
    'malipo', // payment
    'mrabaha', // royalty
    'leseni', // licence
    'kusimamisha', // suspend
    'mgogoro', // dispute
    'mahakama', // court
    'polisi', // police
    'kukamatwa', // arrest
    'kesi', // lawsuit / court case
    'kufukuz', // kufukuza / kufukuzwa — terminate / dismissal
  ]),
  sovereign: Object.freeze([
    'regulator',
    'audit',
    'compliance breach',
    'fraud',
    'mdhibiti', // regulator
    'udanganyifu', // fraud
    // NOTE: 'ukaguzi' (audit) is deliberately excluded — it also means a
    // routine inspection in mining Swahili and would over-escalate.
  ]),
});

// ─────────────────────────────────────────────────────────────────────────
// Caller-facing input shape.
// ─────────────────────────────────────────────────────────────────────────

export const AssignTaskInputSchema = z.object({
  tenantId: z.string().min(1),
  missionId: z.string().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().min(1),
  assignedEmployeeId: z.string().min(1),
  assignedByUserId: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueAt: z.string().nullable().optional(),
  estimatedEffortHours: z.number().nonnegative().nullable().optional(),
  /** Caller hint; kernel may override upward (never downward). */
  riskHint: z.enum(['LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN']).default('LOW'),
  /**
   * Optional domain-pack risk lexicon (bilingual). Defaults to the mining +
   * treasury + safety-legal set (DEFAULT_RISK_LEXICON). DATA, not engine.
   */
  riskLexicon: RiskLexiconSchema.optional(),
  assetRefs: z.array(z.string()).default([]),
  createdByPersonaId: z.string().nullable().optional(),
  /** Optional explicit cadence; auto-chosen if undefined. */
  cadenceKinds: z
    .array(z.enum(['daily', 'mid_week', 'end_of_week', 'one_shot']))
    .optional(),
});

export type AssignTaskInput = z.infer<typeof AssignTaskInputSchema>;

export interface AssignTaskResult {
  assignment: WorkAssignment;
  followupIds: string[];
  notificationDelivered: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Kernel: risk tier escalation. The caller can only suggest downward;
// the kernel always reserves the right to escalate upward based on the
// content of the task. The keyword lists are the injected/default
// RiskLexicon above — DATA, not engine.
// ─────────────────────────────────────────────────────────────────────────

const RISK_RANK: Record<RiskTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  SOVEREIGN: 3,
};

export function deriveRiskTier(args: {
  hint: RiskTier;
  title: string;
  description: string;
  priority: Priority;
  /** Optional domain-pack lexicon; defaults to the bilingual mining set. */
  lexicon?: RiskLexicon;
}): RiskTier {
  const lexicon = args.lexicon ?? DEFAULT_RISK_LEXICON;
  const haystack = `${args.title} ${args.description}`.toLowerCase();

  let derived: RiskTier = args.hint;

  if (lexicon.sovereign.some((kw) => haystack.includes(kw.toLowerCase()))) {
    derived = 'SOVEREIGN';
  } else if (lexicon.high.some((kw) => haystack.includes(kw.toLowerCase()))) {
    derived = 'HIGH';
  } else if (args.priority === 'urgent' && RISK_RANK[derived] < RISK_RANK.MEDIUM) {
    derived = 'MEDIUM';
  }

  // The kernel never downgrades below the hint.
  return RISK_RANK[derived] >= RISK_RANK[args.hint] ? derived : args.hint;
}

// ─────────────────────────────────────────────────────────────────────────
// Followup cadence picker.
// ─────────────────────────────────────────────────────────────────────────

export function pickCadence(args: {
  riskTier: RiskTier;
  priority: Priority;
  dueAtMs: number | null;
  nowMs: number;
}): CadenceKind[] {
  // High-stakes or no due-date → daily check-ins.
  if (args.riskTier === 'HIGH' || args.riskTier === 'SOVEREIGN') {
    return ['daily'];
  }
  if (args.priority === 'urgent') {
    return ['daily'];
  }
  if (args.dueAtMs === null) {
    return ['mid_week', 'end_of_week'];
  }
  const horizonHours = (args.dueAtMs - args.nowMs) / 3_600_000;
  if (horizonHours <= 24) return ['one_shot'];
  if (horizonHours <= 72) return ['daily'];
  if (horizonHours <= 24 * 7) return ['mid_week', 'end_of_week'];
  return ['mid_week', 'end_of_week'];
}

// ─────────────────────────────────────────────────────────────────────────
// Followup schedule builder.
// ─────────────────────────────────────────────────────────────────────────

export function buildFollowupSchedule(args: {
  cadenceKinds: CadenceKind[];
  nowMs: number;
  dueAtMs: number | null;
}): Array<{ scheduledAt: Date; cadenceKind: CadenceKind }> {
  const out: Array<{ scheduledAt: Date; cadenceKind: CadenceKind }> = [];
  const oneDay = 24 * 3_600_000;

  for (const kind of args.cadenceKinds) {
    if (kind === 'daily') {
      // Schedule the NEXT 5 daily check-ins (capped by dueAt if set).
      for (let i = 1; i <= 5; i += 1) {
        const at = args.nowMs + i * oneDay;
        if (args.dueAtMs && at > args.dueAtMs) break;
        out.push({ scheduledAt: new Date(at), cadenceKind: 'daily' });
      }
    } else if (kind === 'mid_week') {
      out.push({ scheduledAt: nextWeekday(args.nowMs, 3, 10), cadenceKind: 'mid_week' });
    } else if (kind === 'end_of_week') {
      out.push({ scheduledAt: nextWeekday(args.nowMs, 5, 16), cadenceKind: 'end_of_week' });
    } else if (kind === 'one_shot') {
      const ahead = args.dueAtMs
        ? Math.max(args.nowMs + oneDay, args.dueAtMs - 4 * 3_600_000)
        : args.nowMs + oneDay;
      out.push({ scheduledAt: new Date(ahead), cadenceKind: 'one_shot' });
    }
  }

  return out;
}

/** Returns a Date for the next occurrence of (dayOfWeek 1=Mon..7=Sun, hour 0..23). */
function nextWeekday(nowMs: number, dayOfWeek: number, hour: number): Date {
  const now = new Date(nowMs);
  const cur = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // 1..7
  let delta = (dayOfWeek - cur + 7) % 7;
  if (delta === 0) delta = 7; // always strictly in the future
  const target = new Date(now);
  target.setUTCDate(now.getUTCDate() + delta);
  target.setUTCHours(hour, 0, 0, 0);
  return target;
}

// ─────────────────────────────────────────────────────────────────────────
// Main entrypoint.
// ─────────────────────────────────────────────────────────────────────────

export async function assignTask(
  deps: WorkforceDeps,
  rawInput: AssignTaskInput
): Promise<AssignTaskResult> {
  const input = AssignTaskInputSchema.parse(rawInput);

  const employee = await deps.store.getEmployee(input.tenantId, input.assignedEmployeeId);
  if (!employee) {
    throw new Error(
      `assignTask: employee ${input.assignedEmployeeId} not found in tenant ${input.tenantId}`
    );
  }
  if (employee.status !== 'active') {
    throw new Error(
      `assignTask: cannot assign to ${employee.id} — status=${employee.status}`
    );
  }

  const riskTier = deriveRiskTier({
    hint: input.riskHint,
    title: input.title,
    description: input.description,
    priority: input.priority,
    // Domain-pack lexicon override (validated by the schema); default bilingual.
    // Normalized here because the zod .d.ts inference relaxes the fields.
    ...(input.riskLexicon
      ? {
          lexicon: {
            high: input.riskLexicon.high ?? [],
            sovereign: input.riskLexicon.sovereign ?? [],
          },
        }
      : {}),
  });
  const hitlRequired = riskTier === 'HIGH' || riskTier === 'SOVEREIGN';

  // 1. Audit chain entry FIRST so we can stamp the chain id onto the row.
  const audit = await deps.audit.append({
    tenantId: input.tenantId,
    action: 'workforce.assign_task',
    payload: {
      title: input.title,
      assignedEmployeeId: input.assignedEmployeeId,
      assignedByUserId: input.assignedByUserId,
      riskTier,
      hitlRequired,
    },
  });

  const now = deps.clock();
  const nowIso = now.toISOString();
  const id = deps.uuid();

  const assignment: WorkAssignment = WorkAssignmentSchema.parse({
    id,
    tenantId: input.tenantId,
    missionId: input.missionId ?? null,
    title: input.title,
    description: input.description,
    assignedEmployeeId: input.assignedEmployeeId,
    assignedByUserId: input.assignedByUserId,
    priority: input.priority,
    dueAt: input.dueAt ?? null,
    estimatedEffortHours: input.estimatedEffortHours ?? null,
    status: 'pending',
    riskTier,
    hitlRequired,
    assetRefs: input.assetRefs,
    createdByPersonaId: input.createdByPersonaId ?? null,
    auditChainId: audit.chainId,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
  });

  await deps.store.insertAssignment(assignment);

  // 2. Schedule followups.
  const cadenceKinds =
    input.cadenceKinds ??
    pickCadence({
      riskTier,
      priority: input.priority,
      dueAtMs: input.dueAt ? new Date(input.dueAt).getTime() : null,
      nowMs: now.getTime(),
    });

  const schedule = buildFollowupSchedule({
    cadenceKinds,
    nowMs: now.getTime(),
    dueAtMs: input.dueAt ? new Date(input.dueAt).getTime() : null,
  });

  const followupIds: string[] = [];
  for (const slot of schedule) {
    const followup = WorkFollowupSchema.parse({
      id: deps.uuid(),
      tenantId: input.tenantId,
      assignmentId: assignment.id,
      scheduledAt: slot.scheduledAt.toISOString(),
      cadenceKind: slot.cadenceKind,
      channel: employee.defaultChannel,
      status: 'pending',
      createdAt: nowIso,
    });
    await deps.store.insertFollowup(followup);
    followupIds.push(followup.id);
  }

  // 3. Kick-off notification (best-effort, never blocks).
  let delivered = false;
  try {
    const r = await deps.channel.send({
      tenantId: input.tenantId,
      employeeId: assignment.assignedEmployeeId,
      channel: employee.defaultChannel,
      template: 'workforce.new_assignment',
      payload: {
        assignmentId: assignment.id,
        title: assignment.title,
        priority: assignment.priority,
        dueAt: assignment.dueAt,
        riskTier: assignment.riskTier,
      },
    });
    delivered = r.delivered;
  } catch {
    delivered = false;
  }

  return {
    assignment,
    followupIds,
    notificationDelivered: delivered,
  };
}
