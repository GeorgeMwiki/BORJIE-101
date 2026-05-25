/**
 * Piece M — check-in-receiver.
 *
 * Records inbound check-ins from the employee. Side-effects:
 *   1. Validate.
 *   2. Cross-tenant guard (assignment must belong to the tenant).
 *   3. Run sentiment-analyzer on response_text (best-effort).
 *   4. Insert work_check_in row.
 *   5. Update parent assignment status if response_kind dictates.
 *   6. If response_kind === 'blocker' or 'completed', emit a
 *      performance_signal via performance-tracker.
 *   7. If the check-in came in response to a followup, flip the
 *      followup status → 'responded'.
 */

import { z } from 'zod';
import { runPerformanceTracker } from './performance-tracker.js';
import { runSentimentAnalysis } from './sentiment-analyzer.js';
import {
  WorkCheckInSchema,
  type CheckInAttachment,
  type ResponseKind,
  type WorkAssignment,
  type WorkCheckIn,
  type WorkforceDeps,
} from './types.js';

export const ReceiveCheckInInputSchema = z.object({
  tenantId: z.string().min(1),
  assignmentId: z.string().min(1),
  followupId: z.string().nullable().optional(),
  employeeId: z.string().min(1),
  responseKind: z.enum([
    'progress_update',
    'blocker',
    'completed',
    'request_extension',
    'no_response',
  ]),
  responseText: z.string().nullable().optional(),
  attachments: z
    .array(
      z.object({
        kind: z.string(),
        url: z.string(),
        mime: z.string().optional(),
      })
    )
    .default([]),
});

export type ReceiveCheckInInput = z.infer<typeof ReceiveCheckInInputSchema>;

export interface ReceiveCheckInResult {
  checkIn: WorkCheckIn;
  assignment: WorkAssignment;
  emittedSignalKinds: string[];
}

const KIND_TO_STATUS: Partial<Record<ResponseKind, WorkAssignment['status']>> = {
  blocker: 'blocked',
  completed: 'completed',
  progress_update: 'in_progress',
};

export async function receiveCheckIn(
  deps: WorkforceDeps,
  rawInput: ReceiveCheckInInput
): Promise<ReceiveCheckInResult> {
  const input = ReceiveCheckInInputSchema.parse(rawInput);

  const assignment = await deps.store.getAssignment(input.tenantId, input.assignmentId);
  if (!assignment) {
    throw new Error(
      `receiveCheckIn: assignment ${input.assignmentId} not found in tenant ${input.tenantId}`
    );
  }
  if (assignment.assignedEmployeeId !== input.employeeId) {
    throw new Error(
      `receiveCheckIn: employee ${input.employeeId} not assignee of ${input.assignmentId}`
    );
  }

  // Sentiment is best-effort; failure leaves score=null (the
  // sentiment-analyzer already swallows errors).
  let sentimentScore: number | null = null;
  if (input.responseText && input.responseText.trim().length > 0) {
    const s = await runSentimentAnalysis(deps, { text: input.responseText });
    sentimentScore = s.score;
  }

  const now = deps.clock();
  const nowIso = now.toISOString();
  const attachments: CheckInAttachment[] = input.attachments;

  const checkIn: WorkCheckIn = WorkCheckInSchema.parse({
    id: deps.uuid(),
    tenantId: input.tenantId,
    assignmentId: input.assignmentId,
    followupId: input.followupId ?? null,
    employeeId: input.employeeId,
    responseKind: input.responseKind,
    responseText: input.responseText ?? null,
    attachmentsJsonb: attachments,
    sentimentScore,
    createdAt: nowIso,
  });

  await deps.store.insertCheckIn(checkIn);

  // Update parent assignment status if the response_kind dictates.
  let updatedAssignment = assignment;
  const nextStatus = KIND_TO_STATUS[input.responseKind];
  if (nextStatus && assignment.status !== nextStatus) {
    updatedAssignment = {
      ...assignment,
      status: nextStatus,
      updatedAt: nowIso,
      completedAt: nextStatus === 'completed' ? nowIso : assignment.completedAt ?? null,
    };
    await deps.store.updateAssignment(updatedAssignment);
  }

  // Flip parent followup status.
  if (input.followupId) {
    const followups = await deps.store.listFollowupsForAssignment(
      input.tenantId,
      input.assignmentId
    );
    const target = followups.find((f) => f.id === input.followupId);
    if (target && target.status !== 'responded') {
      await deps.store.updateFollowup({ ...target, status: 'responded' });
    }
  }

  // Emit performance signal.
  const emittedSignalKinds = await runPerformanceTracker(deps, {
    tenantId: input.tenantId,
    assignment: updatedAssignment,
    checkIn,
  });

  // Append to audit chain (fire-and-forget; failure swallowed).
  try {
    await deps.audit.append({
      tenantId: input.tenantId,
      action: 'workforce.check_in',
      payload: {
        assignmentId: assignment.id,
        responseKind: input.responseKind,
        emittedSignalKinds,
        sentimentScore,
      },
    });
  } catch {
    // intentionally swallowed
  }

  return {
    checkIn,
    assignment: updatedAssignment,
    emittedSignalKinds,
  };
}
