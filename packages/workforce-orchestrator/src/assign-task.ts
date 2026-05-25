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
// content of the task.
// ─────────────────────────────────────────────────────────────────────────

const RISK_KEYWORDS_HIGH = [
  'terminate',
  'fire ',
  'evict',
  'eviction',
  'lawsuit',
  'court',
  'arrest',
  'police',
];
const RISK_KEYWORDS_SOVEREIGN = ['regulator', 'audit', 'compliance breach', 'fraud'];

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
}): RiskTier {
  const haystack = `${args.title} ${args.description}`.toLowerCase();

  let derived: RiskTier = args.hint;

  if (RISK_KEYWORDS_SOVEREIGN.some((kw) => haystack.includes(kw))) {
    derived = 'SOVEREIGN';
  } else if (RISK_KEYWORDS_HIGH.some((kw) => haystack.includes(kw))) {
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
