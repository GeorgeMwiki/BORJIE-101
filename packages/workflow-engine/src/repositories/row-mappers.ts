/**
 * Row ↔ domain mappers for the Drizzle-backed workflow repositories.
 *
 * Each mapper is a pure function: it takes a raw Drizzle row
 * (`Record<string, unknown>`) and produces a frozen domain object that
 * matches the engine's public types exactly. Timestamps come back from
 * postgres-js as `Date`; jsonb columns come back already-parsed.
 *
 * Keeping these pure + isolated means the repository files stay focused
 * on query construction and the round-trip shape is asserted in one
 * place (see __tests__/drizzle-repos.test.ts).
 */

import type {
  ApprovalDecision,
  AuditChainEntry,
  ProposedChange,
  ReviewDecision,
  WorkflowKind,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunEventKind,
  WorkflowRunState,
} from '../types.js';

type Row = Record<string, unknown>;

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

function toRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.freeze({ ...(value as Record<string, unknown>) });
  }
  return Object.freeze({});
}

function toNullableRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (value === null || value === undefined) return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.freeze({ ...(value as Record<string, unknown>) });
  }
  return null;
}

/**
 * Re-hydrate a ProposedChange jsonb sub-object. `capturedAt` is stored
 * as an ISO string inside the jsonb (jsonb has no native timestamp), so
 * it is re-parsed into a Date here.
 */
function toProposedChange(value: unknown): ProposedChange | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null;
  }
  const pc = value as Record<string, unknown>;
  const fieldDiffs = Array.isArray(pc.fieldDiffs)
    ? pc.fieldDiffs.map((d) => {
        const fd = d as Record<string, unknown>;
        return Object.freeze({
          path: String(fd.path),
          before: fd.before,
          after: fd.after,
        });
      })
    : [];
  return Object.freeze({
    id: String(pc.id),
    runId: String(pc.runId),
    targetEntity: String(pc.targetEntity),
    fieldDiffs: Object.freeze(fieldDiffs),
    snapshot: toNullableRecord(pc.snapshot),
    capturedAt: toDate(pc.capturedAt),
  });
}

function toReviewDecision(value: unknown): ReviewDecision | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null;
  }
  const rd = value as Record<string, unknown>;
  return Object.freeze({
    id: String(rd.id),
    runId: String(rd.runId),
    verdict: rd.verdict as ReviewDecision['verdict'],
    source: rd.source as ReviewDecision['source'],
    reviewerUserId: (rd.reviewerUserId as string | null) ?? null,
    rationale: String(rd.rationale ?? ''),
    redLines: Object.freeze(
      Array.isArray(rd.redLines) ? rd.redLines.map(String) : [],
    ),
    coachingHints: Object.freeze(
      Array.isArray(rd.coachingHints) ? rd.coachingHints.map(String) : [],
    ),
    decidedAt: toDate(rd.decidedAt),
  });
}

function toApprovalDecision(value: unknown): ApprovalDecision | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null;
  }
  const ad = value as Record<string, unknown>;
  return Object.freeze({
    id: String(ad.id),
    runId: String(ad.runId),
    verdict: ad.verdict as ApprovalDecision['verdict'],
    approverUserId: String(ad.approverUserId),
    approverRole: String(ad.approverRole),
    rationale: String(ad.rationale ?? ''),
    decidedAt: toDate(ad.decidedAt),
  });
}

export function rowToRun(row: Row): WorkflowRun {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    definitionId: String(row.definitionId),
    kind: String(row.kind) as WorkflowKind,
    scope: String(row.scope),
    scopeRef: String(row.scopeRef),
    initiatedByUserId: String(row.initiatedByUserId),
    assignedReviewerUserId: (row.assignedReviewerUserId as string | null) ?? null,
    assignedApproverUserId: (row.assignedApproverUserId as string | null) ?? null,
    state: String(row.state) as WorkflowRunState,
    input: toRecord(row.input),
    proposedChange: toProposedChange(row.proposedChange),
    reviewDecision: toReviewDecision(row.reviewDecision),
    approvalDecision: toApprovalDecision(row.approvalDecision),
    rejectionReason: (row.rejectionReason as string | null) ?? null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    committedAt: toNullableDate(row.committedAt),
  });
}

export function rowToEvent(row: Row): WorkflowRunEvent {
  return Object.freeze({
    id: String(row.id),
    runId: String(row.runId),
    tenantId: String(row.tenantId),
    kind: String(row.kind) as WorkflowRunEventKind,
    actorUserId: (row.actorUserId as string | null) ?? null,
    payload: toRecord(row.payload),
    occurredAt: toDate(row.occurredAt),
  });
}

export function rowToAuditEntry(row: Row): AuditChainEntry {
  return Object.freeze({
    id: String(row.id),
    runId: String(row.runId),
    tenantId: String(row.tenantId),
    previousHash: String(row.previousHash),
    currentHash: String(row.currentHash),
    recordedKind: String(row.recordedKind) as WorkflowRunEventKind,
    recordedPayload: toRecord(row.recordedPayload),
    recordedAt: toDate(row.recordedAt),
  });
}

/**
 * Serialize a ProposedChange for the `proposed_change` jsonb column.
 * `capturedAt` becomes an ISO string so the round-trip is lossless.
 */
export function proposedChangeToJson(
  pc: ProposedChange | null,
): Record<string, unknown> | null {
  if (!pc) return null;
  return {
    id: pc.id,
    runId: pc.runId,
    targetEntity: pc.targetEntity,
    fieldDiffs: pc.fieldDiffs.map((d) => ({
      path: d.path,
      before: d.before,
      after: d.after,
    })),
    snapshot: pc.snapshot ?? null,
    capturedAt: pc.capturedAt.toISOString(),
  };
}

export function reviewDecisionToJson(
  rd: ReviewDecision | null,
): Record<string, unknown> | null {
  if (!rd) return null;
  return {
    id: rd.id,
    runId: rd.runId,
    verdict: rd.verdict,
    source: rd.source,
    reviewerUserId: rd.reviewerUserId,
    rationale: rd.rationale,
    redLines: [...rd.redLines],
    coachingHints: [...rd.coachingHints],
    decidedAt: rd.decidedAt.toISOString(),
  };
}

export function approvalDecisionToJson(
  ad: ApprovalDecision | null,
): Record<string, unknown> | null {
  if (!ad) return null;
  return {
    id: ad.id,
    runId: ad.runId,
    verdict: ad.verdict,
    approverUserId: ad.approverUserId,
    approverRole: ad.approverRole,
    rationale: ad.rationale,
    decidedAt: ad.decidedAt.toISOString(),
  };
}
