/**
 * Support verbs — Mr. Mwikila's first-line-support actions on `support_cases`.
 *
 *   open_support_case     — open a NEW persistent support case (confirm-
 *                           required; a durable row the MD remembers forever).
 *   resolve_support_case  — close a case (confirm-required; status → resolved).
 *   escalate_to_human     — hand the case to a human: set the case status →
 *                           escalated with an escalation REFERENCE ticket so the
 *                           team picks it up from the support queue. The
 *                           `support_cases` table IS that durable queue — its
 *                           `(tenant_id, status)` index is built for triage of
 *                           escalated cases (the I-W-16 support surface reads
 *                           it). Always-authorized in spirit, but still gated +
 *                           RECORDED (audit) — never silent.
 *
 * NOTE on the queue table: the legacy `complaint_records` / `feedback_submissions`
 * tables were ARCHIVED out of the live migration set, so escalations are NOT
 * written there (that would target a non-existent table). The escalation lives
 * on the case row (`status='escalated'` + `escalation_ref`) AND in the immutable
 * `ai_audit_chain`. Re-pointing escalations at a dedicated queue table is a
 * follow-on if/when that surface is re-materialised.
 *
 * ─── WHY THESE ARE NOT MONEY VERBS (CLAUDE.md hard rule) ────────────────
 * Support is DIAGNOSIS + MEMORY only. None of these verbs touch the money path.
 * `support_cases` + `complaint_records` carry NO money column. Any actual fix
 * to a payment routes through the SEPARATE money-actions wave that calls
 * `LedgerService.post()` — never from a support verb. These handlers import NO
 * LedgerService and write NO ledger/journal row.
 *
 * The case writes go through the support-cases repository, which appends a
 * hash-chained, append-only `ai_audit_chain` row for each lifecycle event. The
 * escalation also writes the standard executor `appendExecAudit` trail so the
 * escalation is provable in the immutable chain.
 *
 * RLS FORCE: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`; every statement also predicates on the bound
 * tenant + user (belt-and-braces, matching the sibling handlers).
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';
import {
  openCase,
  resolveCase,
  escalateCase,
  getCase,
  type SupportRepoContext,
} from '../../support-cases/index.js';

// ─── Schemas ─────────────────────────────────────────────────────────

const openSupportCaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(['payment', 'general']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  summary: z.string().trim().max(2000).optional(),
  rootCause: z.string().trim().max(200).optional(),
  threadId: z.string().trim().max(200).optional(),
  /** Evidence ids proving the issue (>=1 — evidence-required). */
  evidenceIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
});

const resolveSupportCaseSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  resolution: z.string().trim().min(1).max(2000),
});

const escalateToHumanSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

/** Build the support-repo context from the executor context. */
function repoCtx(ctx: ExecContext): SupportRepoContext {
  return {
    db: ctx.db as SupportRepoContext['db'],
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    logger: ctx.logger,
  };
}

// ─── open_support_case ───────────────────────────────────────────────

export const openSupportCaseHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = openSupportCaseSchema.parse(rawInput);
  const created = await openCase(repoCtx(ctx), {
    title: input.title,
    category: input.category ?? 'general',
    evidenceIds: input.evidenceIds,
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.rootCause ? { rootCause: input.rootCause } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
  });

  return {
    kind: 'support_case',
    id: created.id,
    summary: `Opened support case: ${created.title} (status: ${created.status})`,
    data: {
      caseId: created.id,
      status: created.status,
      severity: created.severity,
      category: created.category,
      evidenceCount: input.evidenceIds.length,
    },
  };
};

// ─── resolve_support_case ────────────────────────────────────────────

export const resolveSupportCaseHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = resolveSupportCaseSchema.parse(rawInput);
  const existing = await getCase(repoCtx(ctx), input.caseId);
  if (!existing) {
    throw new Error(`resolve_support_case_not_found:${input.caseId}`);
  }
  const resolved = await resolveCase(
    repoCtx(ctx),
    input.caseId,
    input.resolution,
  );
  if (!resolved) {
    throw new Error(`resolve_support_case_not_found:${input.caseId}`);
  }
  return {
    kind: 'support_case',
    id: resolved.id,
    summary: `Resolved support case ${resolved.id}`,
    data: { caseId: resolved.id, status: resolved.status },
  };
};

// ─── escalate_to_human ───────────────────────────────────────────────

export const escalateToHumanHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = escalateToHumanSchema.parse(rawInput);
  const existing = await getCase(repoCtx(ctx), input.caseId);
  if (!existing) {
    throw new Error(`escalate_to_human_case_not_found:${input.caseId}`);
  }

  // Mint a stable escalation REFERENCE ticket the human triage surface keys on.
  const priority = input.priority ?? 'high';
  const escalationRef = `ESC-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // Flip the case to `escalated` with the queue reference. The support_cases
  // table IS the durable support queue (its (tenant_id, status) index serves
  // triage of escalated cases). The repo appends the md_escalated hash-chain
  // entry for us. NO money is touched.
  const escalated = await escalateCase(
    repoCtx(ctx),
    input.caseId,
    escalationRef,
  );
  if (!escalated) {
    throw new Error(`escalate_to_human_case_not_found:${input.caseId}`);
  }

  // Executor-trail audit (the standard appendExecAudit hash-chain entry) so the
  // escalation — including the human-supplied reason — is provable in the
  // immutable chain alongside the repo's md_escalated entry. Money boundary
  // made explicit.
  await appendExecAudit(ctx, {
    action: 'support.case.escalate',
    turnId: escalated.id,
    details: {
      caseId: escalated.id,
      escalationRef,
      priority,
      reason: input.reason.slice(0, 500),
      status: escalated.status,
      moneyMoved: false,
      ledgerPosted: false,
      source: 'chat-confirm-action',
    },
  });

  return {
    kind: 'support_escalation',
    id: escalated.id,
    summary: `Escalated case ${escalated.id} to a human specialist (ref ${escalationRef})`,
    data: {
      caseId: escalated.id,
      status: escalated.status,
      escalationRef,
      priority,
    },
  };
};
