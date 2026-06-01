/**
 * Support-case repository — open / update / resolve / escalate / list the
 * persistent `support_cases` rows that ARE Mr. Mwikila's support memory.
 *
 * Tenant + user scoped, GUC-bound. The connection's `app.current_tenant_id` is
 * bound by the caller's middleware; every statement ALSO predicates on the
 * bound `tenantId` AND `userId` (belt-and-braces, per CLAUDE.md). The repo
 * NEVER trusts a tenant/user from a request body — they are passed from the
 * authenticated context.
 *
 * Every lifecycle write appends a hash-chained, append-only `ai_audit_chain`
 * row (./audit.ts) recording the event — md_diagnosed_issue / md_updated_case /
 * md_resolved_case / md_escalated. The audit is APPEND-ONLY on the evidence;
 * status TRANSITIONS are allowed on the case row, but the audit trail of those
 * transitions is immutable.
 *
 * HARD RULES honoured (CLAUDE.md):
 *   - NO money writes. `support_cases` has no money column; this repo only
 *     reads/writes support metadata. Any fix routes through the gated verbs.
 *   - EVIDENCE-REQUIRED: `openFromDiagnosis` refuses to open a case from a
 *     diagnosis with an empty evidence chain (the inspector also asserts this).
 *   - RLS + GUC; no `console.log` (Pino-shaped logger threaded in).
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { supportCases } from '@borjie/database';

import { appendSupportAudit } from './audit.js';
import type {
  SupportCase,
  SupportCaseStatus,
  SupportCaseSeverity,
  SupportCaseStep,
} from './case-types.js';
import type { Diagnosis } from '../support-diagnosis/types.js';

/** Statuses that count as OPEN/active for recall (not resolved). */
export const ACTIVE_CASE_STATUSES: ReadonlyArray<SupportCaseStatus> = [
  'open',
  'diagnosing',
  'awaiting_user',
  'escalated',
];

/** Minimal Pino-shaped logger (structural subset). */
export interface SupportRepoLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

/**
 * The Drizzle client the repo speaks. Typed structurally (query-builder +
 * `.execute`) so a test can pass a shim, and so we avoid the cross-package
 * Drizzle namespace-vs-type drift the api-gateway documents elsewhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-package Drizzle type avoided by design
export type SupportRepoDb = any;

export interface SupportRepoContext {
  readonly db: SupportRepoDb;
  readonly tenantId: string;
  readonly userId: string;
  readonly logger?: SupportRepoLogger;
}

export interface OpenCaseInput {
  readonly title: string;
  readonly category?: string;
  readonly severity?: SupportCaseSeverity;
  readonly summary?: string;
  readonly rootCause?: string;
  readonly steps?: ReadonlyArray<SupportCaseStep>;
  readonly evidenceIds?: ReadonlyArray<string>;
  readonly threadId?: string;
  readonly status?: SupportCaseStatus;
}

export interface UpdateCaseInput {
  readonly status?: SupportCaseStatus;
  readonly severity?: SupportCaseSeverity;
  readonly summary?: string;
  readonly rootCause?: string;
  readonly steps?: ReadonlyArray<SupportCaseStep>;
  /** Additional evidence ids to MERGE (append-only) onto the case. */
  readonly addEvidenceIds?: ReadonlyArray<string>;
  readonly resolution?: string;
  readonly escalationRef?: string;
}

/**
 * Bind the tenant GUC tx-local for a standalone repo call (a job / a test that
 * did not pass through `databaseMiddleware`). A no-op-safe SELECT set_config so
 * RLS predicates fire. Callers that already bound the GUC (route handlers) can
 * skip this; calling it again is harmless.
 */
export async function bindTenantGuc(
  db: SupportRepoDb,
  tenantId: string,
): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
  );
}

/** De-dupe + drop empties while preserving order (append-only evidence merge). */
function mergeEvidence(
  existing: ReadonlyArray<string>,
  incoming: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...existing, ...incoming]) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Open a NEW support case. Returns the persisted row. Appends an
 * `md_diagnosed_issue` audit entry.
 */
export async function openCase(
  ctx: SupportRepoContext,
  input: OpenCaseInput,
): Promise<SupportCase> {
  const id = randomUUID();
  const steps = (input.steps ?? []) as SupportCaseStep[];
  const evidenceIds = mergeEvidence([], input.evidenceIds ?? []);

  const values = {
    id,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    threadId: input.threadId ?? null,
    title: input.title,
    category: input.category ?? 'general',
    status: input.status ?? 'open',
    severity: input.severity ?? 'medium',
    summary: input.summary ?? null,
    rootCause: input.rootCause ?? null,
    steps,
    evidenceIds,
    resolution: null,
    escalationRef: null,
  };

  const [row] = await ctx.db.insert(supportCases).values(values).returning();
  const created = (row ?? { ...values, createdAt: new Date(), updatedAt: new Date() }) as SupportCase;

  await appendSupportAudit({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    payload: {
      kind: 'md_diagnosed_issue',
      caseId: created.id,
      details: {
        title: created.title,
        category: created.category,
        status: created.status,
        severity: created.severity,
        rootCause: created.rootCause,
        evidenceCount: evidenceIds.length,
        // Make the money boundary explicit in the immutable trail.
        moneyMoved: false,
      },
    },
    ...(ctx.logger ? { logger: ctx.logger } : {}),
  });

  ctx.logger?.info?.(
    {
      service: 'support-cases',
      op: 'open',
      tenantId: ctx.tenantId,
      caseId: created.id,
      rootCause: created.rootCause,
    },
    'support-case: opened (no money moved)',
  );

  return created;
}

/**
 * Open a case directly FROM a payment {@link Diagnosis} (the inspector output).
 * Evidence-required: throws `case_open_requires_evidence` when the diagnosis has
 * an empty evidence chain — a case is never persisted without proof.
 *
 * The diagnosis's suggested resolution seeds the first `steps` entries so the
 * case shows the user what is fixed / remaining from the start.
 */
export async function openCaseFromDiagnosis(
  ctx: SupportRepoContext,
  diagnosis: Diagnosis,
  opts: { readonly threadId?: string } = {},
): Promise<SupportCase> {
  if (!diagnosis.evidenceIds || diagnosis.evidenceIds.length === 0) {
    throw new Error('case_open_requires_evidence');
  }
  const escalating = diagnosis.suggestedResolution === 'escalate';
  const steps: SupportCaseStep[] = [
    { label: 'Diagnosed the issue', state: 'done' },
    {
      label:
        diagnosis.suggestedResolution === 'guide_user'
          ? 'Guide the user through the fix'
          : diagnosis.suggestedResolution === 'auto_safe_fix'
            ? 'Watch for the issue to self-resolve'
            : 'Escalate to a human specialist',
      state: 'remaining',
    },
  ];
  return openCase(ctx, {
    title: diagnosis.title,
    category: 'payment',
    severity: diagnosis.severity,
    summary: diagnosis.humanExplanationEn,
    rootCause: diagnosis.rootCause,
    steps,
    evidenceIds: diagnosis.evidenceIds,
    status: escalating ? 'diagnosing' : 'open',
    ...(opts.threadId ? { threadId: opts.threadId } : {}),
  });
}

/** Fetch a single case the user owns (tenant + user scoped). */
export async function getCase(
  ctx: SupportRepoContext,
  caseId: string,
): Promise<SupportCase | null> {
  const [row] = await ctx.db
    .select()
    .from(supportCases)
    .where(
      and(
        eq(supportCases.tenantId, ctx.tenantId),
        eq(supportCases.userId, ctx.userId),
        eq(supportCases.id, caseId),
      ),
    )
    .limit(1);
  return (row as SupportCase | undefined) ?? null;
}

/**
 * Update a case (status transition + metadata). Evidence is MERGED append-only
 * (never removed). Appends an `md_updated_case` (or `md_resolved_case` /
 * `md_escalated` when the status moves to resolved / escalated) audit entry.
 */
export async function updateCase(
  ctx: SupportRepoContext,
  caseId: string,
  input: UpdateCaseInput,
): Promise<SupportCase | null> {
  const current = await getCase(ctx, caseId);
  if (!current) return null;

  const existingEvidence = Array.isArray(current.evidenceIds)
    ? (current.evidenceIds as string[])
    : [];
  const nextEvidence = input.addEvidenceIds
    ? mergeEvidence(existingEvidence, input.addEvidenceIds)
    : existingEvidence;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.status !== undefined) set.status = input.status;
  if (input.severity !== undefined) set.severity = input.severity;
  if (input.summary !== undefined) set.summary = input.summary;
  if (input.rootCause !== undefined) set.rootCause = input.rootCause;
  if (input.steps !== undefined) set.steps = input.steps as SupportCaseStep[];
  if (input.addEvidenceIds !== undefined) set.evidenceIds = nextEvidence;
  if (input.resolution !== undefined) set.resolution = input.resolution;
  if (input.escalationRef !== undefined) set.escalationRef = input.escalationRef;
  if (input.status === 'resolved') set.resolvedAt = new Date();

  const [row] = await ctx.db
    .update(supportCases)
    .set(set)
    .where(
      and(
        eq(supportCases.tenantId, ctx.tenantId),
        eq(supportCases.userId, ctx.userId),
        eq(supportCases.id, caseId),
      ),
    )
    .returning();
  const updated = (row as SupportCase | undefined) ?? null;
  if (!updated) return null;

  const kind =
    input.status === 'resolved'
      ? 'md_resolved_case'
      : input.status === 'escalated'
        ? 'md_escalated'
        : 'md_updated_case';

  await appendSupportAudit({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    payload: {
      kind,
      caseId,
      details: {
        status: updated.status,
        severity: updated.severity,
        rootCause: updated.rootCause,
        evidenceCount: nextEvidence.length,
        ...(input.escalationRef ? { escalationRef: input.escalationRef } : {}),
        moneyMoved: false,
      },
    },
    ...(ctx.logger ? { logger: ctx.logger } : {}),
  });

  return updated;
}

/** Resolve a case (status → resolved, resolution text, resolvedAt). */
export async function resolveCase(
  ctx: SupportRepoContext,
  caseId: string,
  resolution: string,
): Promise<SupportCase | null> {
  return updateCase(ctx, caseId, { status: 'resolved', resolution });
}

/**
 * Mark a case escalated with the support-queue reference. status → escalated.
 */
export async function escalateCase(
  ctx: SupportRepoContext,
  caseId: string,
  escalationRef: string,
): Promise<SupportCase | null> {
  return updateCase(ctx, caseId, { status: 'escalated', escalationRef });
}

/**
 * List the user's cases (tenant + user scoped), newest first. Optionally
 * filtered to a set of statuses (e.g. the ACTIVE set for recall).
 */
export async function listCases(
  ctx: SupportRepoContext,
  opts: {
    readonly statuses?: ReadonlyArray<SupportCaseStatus>;
    readonly limit?: number;
  } = {},
): Promise<SupportCase[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const statusFilter =
    opts.statuses && opts.statuses.length > 0
      ? inArray(supportCases.status, [...opts.statuses])
      : undefined;
  const where = statusFilter
    ? and(
        eq(supportCases.tenantId, ctx.tenantId),
        eq(supportCases.userId, ctx.userId),
        statusFilter,
      )
    : and(
        eq(supportCases.tenantId, ctx.tenantId),
        eq(supportCases.userId, ctx.userId),
      );
  const rows = await ctx.db
    .select()
    .from(supportCases)
    .where(where)
    .orderBy(desc(supportCases.updatedAt))
    .limit(limit);
  return rows as SupportCase[];
}

/** List the user's OPEN/active cases — the recall set. */
export async function listActiveCases(
  ctx: SupportRepoContext,
  limit = 10,
): Promise<SupportCase[]> {
  return listCases(ctx, { statuses: ACTIVE_CASE_STATUSES, limit });
}
