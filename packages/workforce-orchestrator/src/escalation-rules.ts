/**
 * Piece M — escalation-rules.
 *
 * Triggers a T3-manager ticket when:
 *   * a work_assignment has been status='blocked' for >= 24h
 *   * a work_assignment has missed a deadline by >= 1h AND no
 *     completion check-in has arrived
 *
 * The escalation creates a ticket via the TicketCreator port (soft
 * pointer — Pieces D+F's tickets table). One ticket per assignment per
 * escalation kind; idempotency is achieved by stamping context.sourceRef
 * into the ticket creator request — production adapters dedupe.
 *
 * The escalation target is the employee's manager (manager_employee_id).
 * If the manager is null (root employee), escalate to assigned_by_user_id.
 */

import type { Severity, WorkAssignment, WorkforceDeps } from './types.js';

export const BLOCKED_THRESHOLD_MS = 24 * 3_600_000;
export const OVERDUE_THRESHOLD_MS = 3_600_000;

export interface EscalationResult {
  assignmentId: string;
  ticketId: string;
  reason: 'blocked_too_long' | 'overdue';
  severity: Severity;
}

export async function runEscalationOnce(
  deps: WorkforceDeps,
  tenantId: string
): Promise<EscalationResult[]> {
  const now = deps.clock();
  const cutoffBlocked = new Date(now.getTime() - BLOCKED_THRESHOLD_MS);

  const out: EscalationResult[] = [];

  const blocked = await deps.store.listBlockedAssignments(tenantId, cutoffBlocked);
  for (const a of blocked) {
    const r = await escalate(deps, {
      tenantId,
      assignment: a,
      reason: 'blocked_too_long',
      severity: pickSeverity(a, 'blocked'),
    });
    out.push(r);
  }

  const overdue = await deps.store.listOverdueAssignments(tenantId, now);
  for (const a of overdue) {
    if (!a.dueAt) continue;
    const ageMs = now.getTime() - new Date(a.dueAt).getTime();
    if (ageMs < OVERDUE_THRESHOLD_MS) continue;
    const r = await escalate(deps, {
      tenantId,
      assignment: a,
      reason: 'overdue',
      severity: pickSeverity(a, 'overdue'),
    });
    out.push(r);
  }

  return out;
}

function pickSeverity(a: WorkAssignment, _reason: 'blocked' | 'overdue'): Severity {
  if (a.riskTier === 'SOVEREIGN') return 'critical';
  if (a.riskTier === 'HIGH' || a.priority === 'urgent') return 'high';
  if (a.priority === 'high') return 'medium';
  return 'low';
}

async function escalate(
  deps: WorkforceDeps,
  args: {
    tenantId: string;
    assignment: WorkAssignment;
    reason: 'blocked_too_long' | 'overdue';
    severity: Severity;
  }
): Promise<EscalationResult> {
  const employee = await deps.store.getEmployee(args.tenantId, args.assignment.assignedEmployeeId);
  const manager = employee?.managerEmployeeId
    ? await deps.store.getEmployee(args.tenantId, employee.managerEmployeeId)
    : null;

  // person_entity_id of the manager is a SOFT pointer; downstream
  // ticketing adapter resolves to a user_id. If no manager exists,
  // fall back to the assigner (assigned_by_user_id is a real user).
  const assigneeUserId = manager
    ? manager.personEntityId
    : args.assignment.assignedByUserId;

  const ticketTitle =
    args.reason === 'blocked_too_long'
      ? `Workforce escalation: blocked task "${args.assignment.title}"`
      : `Workforce escalation: overdue task "${args.assignment.title}"`;

  const ticketDescription =
    args.reason === 'blocked_too_long'
      ? `Assignment ${args.assignment.id} has been blocked for over ${BLOCKED_THRESHOLD_MS / 3_600_000}h. Assignee: ${employee?.id ?? '?'}. Risk tier: ${args.assignment.riskTier}.`
      : `Assignment ${args.assignment.id} has missed its deadline (${args.assignment.dueAt}) and is still open. Assignee: ${employee?.id ?? '?'}. Risk tier: ${args.assignment.riskTier}.`;

  const { ticketId } = await deps.tickets.createTicket({
    tenantId: args.tenantId,
    title: ticketTitle,
    description: ticketDescription,
    assigneeUserId,
    severity: args.severity,
    sourceRef: `work_assignments:${args.assignment.id}:${args.reason}`,
  });

  // Audit append (fire-and-forget).
  try {
    await deps.audit.append({
      tenantId: args.tenantId,
      action: 'workforce.escalation',
      payload: {
        assignmentId: args.assignment.id,
        reason: args.reason,
        severity: args.severity,
        ticketId,
      },
    });
  } catch {
    // intentionally swallowed
  }

  return {
    assignmentId: args.assignment.id,
    ticketId,
    reason: args.reason,
    severity: args.severity,
  };
}
