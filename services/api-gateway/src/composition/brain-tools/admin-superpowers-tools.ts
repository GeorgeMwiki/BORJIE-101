/**
 * Admin platform-portal superpowers brain tool catalog — four-eye QUEUE.
 *
 * Ported from the BossNyumba admin-superpowers stack (BN migration 0301),
 * retargeted real-estate → mining. Backs the admin-scope bulk-action surface
 * at `/api/v1/admin/superpowers/*`. Platform admins (SUPER_ADMIN / ADMIN /
 * SUPPORT) can drive cross-tenant verbs from chat — suspend a licence holder,
 * export a regulator pack, force a supply-agreement termination, etc. The
 * HIGH-risk subset requires a SECOND distinct admin to approve before the
 * mutation fires.
 *
 * These tools COMPLEMENT (do not replace) the existing token-based
 * `admin.four_eye.initiate/approve` tools in `admin-inviolable-tools.ts`;
 * those drive the per-request approval-token flow, whereas these drive the
 * generic propose → approve → reject → list_pending bulk-action queue backed
 * by `admin_superpower_pending_approvals`.
 *
 * Persona scope: T2_admin_strategist ONLY. NEVER callable from owner persona
 * (T1_owner_strategist) or any field persona (T3..T5).
 *
 * Tools:
 *   - admin.superpowers.bulk_action     propose a verb (HIGH → pending)
 *   - admin.superpowers.approve         second-actor approval (HIGH)
 *   - admin.superpowers.reject          reject pending
 *   - admin.superpowers.list_pending    operator queue read
 *
 * All four carry `requiresPolicyRuleLiteral=true`:
 *   - bulk_action because admin bulk-writes are a HIGH-risk policy prefix
 *     (per CLAUDE.md hard rule: no reason-resolver generalisation).
 *   - approve/reject because they consummate a HIGH-risk action and must hit
 *     a literal policy rule.
 *   - list_pending is READ-ONLY but still gated to the admin persona only.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const ADMIN_ONLY: ReadonlyArray<'T2_admin_strategist'> = [
  'T2_admin_strategist',
];

// ────────────────────────────────────────────────────────────────────
// 1) admin.superpowers.bulk_action — propose a bulk verb
// ────────────────────────────────────────────────────────────────────

const BulkInput = z
  .object({
    entityType: z.enum([
      'licence_holder',
      'supply_agreement',
      'user',
      'inspection_case',
      'royalty_invoice',
      'site',
      'announcement_target',
    ]),
    ids: z.array(z.string().min(1).max(200)).min(1).max(500),
    action: z.enum([
      // HIGH-risk (require four-eye)
      'suspend_licence_holder',
      'reactivate_licence_holder',
      'export_regulator_pack',
      'force_supply_agreement_termination',
      'force_password_reset',
      'bulk_archive_inspection_cases',
      // MEDIUM-risk (audit only)
      'bulk_send_announcement',
      'bulk_archive_old_royalty_invoices',
      'bulk_re_tag_sites',
    ]),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
    reason: z.string().min(8).max(2000),
  })
  .strict();

const BulkOutput = z
  .object({
    accepted: z.boolean(),
    requiresFourEye: z.boolean(),
    status: z.enum(['pending_approval', 'applied']),
    processed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    undoJournalIds: z.array(z.string()),
    pendingApprovalIds: z.array(z.string()),
  })
  .strict();

export const adminBulkActionTool: PersonaToolDescriptor<
  typeof BulkInput,
  typeof BulkOutput
> = {
  id: 'admin.superpowers.bulk_action',
  name: 'Propose an admin bulk action (HIGH verbs require four-eye)',
  description:
    'Admin-scope bulk verb. HIGH-risk verbs (suspend_licence_holder, ' +
    'reactivate_licence_holder, export_regulator_pack, ' +
    'force_supply_agreement_termination, force_password_reset, ' +
    'bulk_archive_inspection_cases >50) land as pending_approval and ' +
    'require a second distinct admin to approve via ' +
    'admin.superpowers.approve. MEDIUM-risk verbs (bulk_send_announcement, ' +
    'bulk_archive_old_royalty_invoices, bulk_re_tag_sites) fire immediately ' +
    'with audit-only logging. Single actor.',
  personaSlugs: ADMIN_ONLY,
  inputSchema: BulkInput,
  outputSchema: BulkOutput,
  stakes: 'HIGH',
  isWrite: true,
  // HIGH-risk policy prefix; the gate refuses reason-resolver generalisation
  // per CLAUDE.md hard rule.
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.superpowers.bulk_action requires httpClient');
    }
    const body = withChatProvenance(
      {
        entityType: input.entityType,
        ids: input.ids,
        action: input.action,
        payload: input.payload ?? {},
        reason: input.reason,
      },
      ctx,
    );
    const res = await client.post<{
      data?: {
        accepted?: boolean;
        requiresFourEye?: boolean;
        status?: 'pending_approval' | 'applied';
        processed?: number;
        failed?: number;
        undoJournalIds?: string[];
        pendingApprovalIds?: string[];
      };
    }>('/admin/superpowers/bulk-action', body);
    const row = res.data ?? {};
    return {
      accepted: Boolean(row.accepted ?? true),
      requiresFourEye: Boolean(row.requiresFourEye ?? false),
      status: (row.status ?? 'applied') as 'pending_approval' | 'applied',
      processed: Number(row.processed ?? 0),
      failed: Number(row.failed ?? 0),
      undoJournalIds: Array.isArray(row.undoJournalIds)
        ? row.undoJournalIds
        : [],
      pendingApprovalIds: Array.isArray(row.pendingApprovalIds)
        ? row.pendingApprovalIds
        : [],
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 2) admin.superpowers.approve — second-actor approval
// ────────────────────────────────────────────────────────────────────

const ApproveInput = z
  .object({
    journalId: z.string().min(1).max(200),
    decisionNote: z.string().min(1).max(2000).optional(),
  })
  .strict();

const ApproveOutput = z
  .object({
    applied: z.boolean(),
    journalId: z.string(),
    pendingId: z.string(),
    action: z.string(),
    targetEntityRef: z.string(),
    approvedAt: z.string(),
  })
  .strict();

export const adminApproveTool: PersonaToolDescriptor<
  typeof ApproveInput,
  typeof ApproveOutput
> = {
  id: 'admin.superpowers.approve',
  name: 'Approve a pending HIGH-risk admin proposal (four-eye)',
  description:
    'Approve a pending HIGH-risk admin verb proposed by another admin. ' +
    'The DB CHECK constraint refuses same-actor approval as a safety net; ' +
    'this handler refuses earlier with a structured 409 FOUR_EYE_SAME_ACTOR. ' +
    "Use when reviewing the platform-portal pending queue and the proposal " +
    "is sound — e.g. 'approve the regulator pack export for licence-holder " +
    "acme'.",
  personaSlugs: ADMIN_ONLY,
  inputSchema: ApproveInput,
  outputSchema: ApproveOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.superpowers.approve requires httpClient');
    }
    const body = withChatProvenance(
      {
        ...(input.decisionNote !== undefined && {
          decisionNote: input.decisionNote,
        }),
      },
      ctx,
    );
    const res = await client.post<{
      data?: {
        applied?: boolean;
        journalId?: string;
        pendingId?: string;
        action?: string;
        targetEntityRef?: string;
        approvedAt?: string;
      };
    }>(
      `/admin/superpowers/approve/${encodeURIComponent(input.journalId)}`,
      body,
    );
    const row = res.data ?? {};
    return {
      applied: Boolean(row.applied ?? true),
      journalId: String(row.journalId ?? input.journalId),
      pendingId: String(row.pendingId ?? ''),
      action: String(row.action ?? ''),
      targetEntityRef: String(row.targetEntityRef ?? ''),
      approvedAt: String(row.approvedAt ?? new Date().toISOString()),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 3) admin.superpowers.reject — reject pending proposal
// ────────────────────────────────────────────────────────────────────

const RejectInput = z
  .object({
    journalId: z.string().min(1).max(200),
    rejectionReason: z.string().min(8).max(2000),
  })
  .strict();

const RejectOutput = z
  .object({
    rejected: z.boolean(),
    journalId: z.string(),
    pendingId: z.string(),
  })
  .strict();

export const adminRejectTool: PersonaToolDescriptor<
  typeof RejectInput,
  typeof RejectOutput
> = {
  id: 'admin.superpowers.reject',
  name: 'Reject a pending HIGH-risk admin proposal',
  description:
    'Reject a pending HIGH-risk admin proposal. The proposing admin sees ' +
    'the rejection reason in their notification feed and must re-propose if ' +
    'they still want the verb to fire. Use when the proposal is unsafe ' +
    "(e.g. 'reject the licence-holder acme suspension until we hear back " +
    "from the regulator').",
  personaSlugs: ADMIN_ONLY,
  inputSchema: RejectInput,
  outputSchema: RejectOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.superpowers.reject requires httpClient');
    }
    const body = withChatProvenance(
      {
        rejectionReason: input.rejectionReason,
      },
      ctx,
    );
    const res = await client.post<{
      data?: {
        rejected?: boolean;
        journalId?: string;
        pendingId?: string;
      };
    }>(
      `/admin/superpowers/reject/${encodeURIComponent(input.journalId)}`,
      body,
    );
    const row = res.data ?? {};
    return {
      rejected: Boolean(row.rejected ?? true),
      journalId: String(row.journalId ?? input.journalId),
      pendingId: String(row.pendingId ?? ''),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 4) admin.superpowers.list_pending — operator queue read
// ────────────────────────────────────────────────────────────────────

const ListPendingInput = z
  .object({
    status: z
      .enum(['pending', 'applied', 'rejected', 'expired'])
      .optional()
      .default('pending'),
    limit: z.number().int().min(1).max(200).optional().default(50),
  })
  .strict();

const ListPendingOutput = z
  .object({
    status: z.string(),
    count: z.number().int().nonnegative(),
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

export const adminListPendingTool: PersonaToolDescriptor<
  typeof ListPendingInput,
  typeof ListPendingOutput
> = {
  id: 'admin.superpowers.list_pending',
  name: 'List pending (or filtered) admin four-eye proposals',
  description:
    'Read the admin operator queue. Defaults to status=pending — the set ' +
    'of HIGH-risk proposals awaiting a second-actor approval. Use when the ' +
    "admin asks 'what's waiting for my approval?' or 'show me proposals " +
    "that lapsed yesterday'.",
  personaSlugs: ADMIN_ONLY,
  inputSchema: ListPendingInput,
  outputSchema: ListPendingOutput,
  stakes: 'LOW',
  isWrite: false,
  // Read-only but still HIGH-risk policy prefix: visibility into the
  // four-eye queue must hit a literal policy rule.
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { status: input.status ?? 'pending', count: 0, rows: [] };
    }
    const res = await client.get<{
      data?: {
        status?: string;
        count?: number;
        rows?: Array<Record<string, unknown>>;
      };
    }>('/admin/superpowers/pending', {
      query: {
        status: input.status ?? 'pending',
        limit: input.limit ?? 50,
      },
    });
    const row = res.data ?? {};
    return {
      status: String(row.status ?? input.status ?? 'pending'),
      count: Number(row.count ?? 0),
      rows: Array.isArray(row.rows) ? row.rows : [],
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Catalog export — included by `buildPersonaToolHandlers` in index.ts.
// ────────────────────────────────────────────────────────────────────

export const ADMIN_SUPERPOWERS_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  adminBulkActionTool,
  adminApproveTool,
  adminRejectTool,
  adminListPendingTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
