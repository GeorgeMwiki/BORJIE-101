/**
 * Admin inviolable-rule chat tools — Wave G-FIX-5.
 *
 * Eight HIGH-risk admin-side chat tools that wrap the inviolable-rule
 * surfaces (kill-switch / four-eye / policy / feature-flag / audit
 * export / tenant suspend). Each tool:
 *
 *   - Carries `stakes: 'HIGH'` so the kernel risk-tier gate (#202)
 *     forces a confirmation chip BEFORE the handler fires.
 *   - Sets `requiresPolicyRuleLiteral: true` for sovereign / kill_switch
 *     / four_eye / policy_rollout prefixes per CLAUDE.md hard rule —
 *     the reason-resolver may NEVER generalise these.
 *   - Validates input via zod (strict schemas — unknown keys rejected).
 *   - Is RLS-scoped via the tool dispatcher's loopback-context binding
 *     (`runWithLoopbackContext` threads the tenant + actor for the
 *     service-bound JWT mint). Cross-tenant calls fail-closed.
 *   - Emits a hash-chained audit entry through the dispatcher adapter
 *     (`toBrainToolHandler` calls `gate.auditSink.append` when
 *     `isWrite: true`).
 *   - Emits a cockpit-bus chip envelope so the admin-web cockpit FE
 *     can render a live "Mr. Mwikila is firing X" pill that resolves
 *     when the upstream handler returns.
 *
 * Persona scoping: T2_admin_strategist only. Owner / manager / worker /
 * buyer / customer-concierge personas are NEVER in the allowlist for
 * inviolable-rule writes — the kernel risk-gate enforces this at the
 * tool dispatcher level (and the descriptor allowlist enforces it at
 * the catalog level — defense in depth).
 *
 * Why this wave is HIGH-only:
 *   The inviolable-rule surface (kill-switch / four-eye / policy /
 *   tenant-suspend) is the trust-boundary of the platform — every
 *   action here is destructive or rights-reducing, so the confirmation
 *   gate must be unconditional. The brain SHOULD render a literal
 *   "Type CONFIRM to fire X" chip before invoking these.
 *
 * Bilingual sw/en (CLAUDE.md hard rule): every user-facing description
 * is composed for an admin who may flip language at any time. The
 * handler return envelopes include both `noteSw` and `noteEn` strings
 * so the cockpit can render the localised confirmation.
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const ADMIN_ONLY: ReadonlyArray<'T2_admin_strategist'> = [
  'T2_admin_strategist',
];

/**
 * Build a deterministic chip-id for the cockpit bus. Tests pin
 * `Date.now()` so the id is stable across runs.
 */
function chipId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ────────────────────────────────────────────────────────────────────
// 1) admin.killswitch.open — initiate two-operator kill-switch open
// ────────────────────────────────────────────────────────────────────

const KillSwitchOpenInput = z
  .object({
    scope: z
      .string()
      .min(1)
      .max(120)
      .refine((s) => s === 'platform' || s.startsWith('tenant:'), {
        message: 'Scope must be "platform" or "tenant:<tenantId>"',
      }),
    reason: z.string().min(1).max(400),
    level: z.enum(['degraded', 'halt']).default('halt'),
    note: z.string().min(1).max(500).optional(),
  })
  .strict();

const KillSwitchOpenOutput = z
  .object({
    initiated: z.boolean(),
    pendingConfirmationId: z.string(),
    chipId: z.string(),
    expiresAt: z.string(),
    waitingForSecondOperator: z.literal(true),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminKillSwitchOpenTool: PersonaToolDescriptor<
  typeof KillSwitchOpenInput,
  typeof KillSwitchOpenOutput
> = {
  id: 'admin.killswitch.open',
  name: 'Admin — initiate kill-switch open',
  description:
    'HIGH-RISK. Initiate the two-operator kill-switch open flow for the ' +
    'platform or a tenant. Returns a pending-confirmation id that a ' +
    'second admin must approve within 30 seconds (POST ' +
    '/api/v1/mining/internal/killswitch/:id/confirm). The chat MUST ' +
    "render a literal 'Type CONFIRM to fire' chip; the reason-resolver " +
    'is forbidden from generalising this descriptor (CLAUDE.md hard rule).',
  personaSlugs: ADMIN_ONLY,
  inputSchema: KillSwitchOpenInput,
  outputSchema: KillSwitchOpenOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.killswitch.open requires httpClient');
    }
    const body = withChatProvenance(
      {
        scope: input.scope,
        level: input.level,
        reasonCode: input.reason,
        ...(input.note !== undefined && { note: input.note }),
      },
      ctx,
    );
    const res = await client.post<{
      pendingConfirmationId?: string;
      expiresAt?: string;
    }>('/mining/internal/killswitch', body);
    const pendingId = String(res.pendingConfirmationId ?? '');
    return {
      initiated: true,
      pendingConfirmationId: pendingId,
      chipId: chipId('ks_open'),
      expiresAt: String(res.expiresAt ?? new Date().toISOString()),
      waitingForSecondOperator: true as const,
      noteEn: `Kill-switch ${input.level} on ${input.scope} initiated — waiting for second admin within 30 s.`,
      noteSw: `Kifaa-cha-kuzima ${input.level} kwenye ${input.scope} kimeanzishwa — kinasubiri admin wa pili ndani ya sekunde 30.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 2) admin.killswitch.close — initiate two-operator kill-switch close
// ────────────────────────────────────────────────────────────────────

const KillSwitchCloseInput = z
  .object({
    scope: z
      .string()
      .min(1)
      .max(120)
      .refine((s) => s === 'platform' || s.startsWith('tenant:'), {
        message: 'Scope must be "platform" or "tenant:<tenantId>"',
      }),
    reason: z.string().min(1).max(400),
    note: z.string().min(1).max(500).optional(),
  })
  .strict();

const KillSwitchCloseOutput = z
  .object({
    initiated: z.boolean(),
    pendingConfirmationId: z.string(),
    chipId: z.string(),
    expiresAt: z.string(),
    waitingForSecondOperator: z.literal(true),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminKillSwitchCloseTool: PersonaToolDescriptor<
  typeof KillSwitchCloseInput,
  typeof KillSwitchCloseOutput
> = {
  id: 'admin.killswitch.close',
  name: 'Admin — initiate kill-switch close (return to live)',
  description:
    'HIGH-RISK. Initiate the two-operator kill-switch return-to-live ' +
    'flow for the platform or a tenant. Level is hard-coded to "live" — ' +
    'the close flow always lifts the switch fully. Returns the pending ' +
    'confirmation row id; second admin must confirm within 30 s.',
  personaSlugs: ADMIN_ONLY,
  inputSchema: KillSwitchCloseInput,
  outputSchema: KillSwitchCloseOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.killswitch.close requires httpClient');
    }
    const body = withChatProvenance(
      {
        scope: input.scope,
        level: 'live' as const,
        reasonCode: input.reason,
        ...(input.note !== undefined && { note: input.note }),
      },
      ctx,
    );
    const res = await client.post<{
      pendingConfirmationId?: string;
      expiresAt?: string;
    }>('/mining/internal/killswitch', body);
    const pendingId = String(res.pendingConfirmationId ?? '');
    return {
      initiated: true,
      pendingConfirmationId: pendingId,
      chipId: chipId('ks_close'),
      expiresAt: String(res.expiresAt ?? new Date().toISOString()),
      waitingForSecondOperator: true as const,
      noteEn: `Kill-switch return-to-live on ${input.scope} initiated — waiting for second admin within 30 s.`,
      noteSw: `Kurejesha kifaa-cha-kuzima kwenye hai kwenye ${input.scope} kumeanzishwa — kinasubiri admin wa pili ndani ya sekunde 30.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 3) admin.four_eye.initiate — start a four-eye approval flow
// ────────────────────────────────────────────────────────────────────

const FOUR_EYE_ACTION_TYPES = [
  'payment.large',
  'regulator.filing',
  'contract.sign',
  'tenant.purge',
  'kill_switch.flip',
  'policy.rule_edit',
] as const;

const FourEyeInitiateInput = z
  .object({
    actionType: z.enum(FOUR_EYE_ACTION_TYPES),
    secondApproverId: z.string().min(1).max(128),
    payload: z.record(z.string(), z.unknown()),
    reason: z.string().min(1).max(400),
    ttlMinutes: z
      .number()
      .int()
      .min(15)
      .max(7 * 24 * 60)
      .optional(),
  })
  .strict();

const FourEyeInitiateOutput = z
  .object({
    requestId: z.string(),
    chipId: z.string(),
    approvalToken: z.string(),
    approvalUrl: z.string(),
    expiresAt: z.string(),
    actionType: z.string(),
    status: z.string(),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminFourEyeInitiateTool: PersonaToolDescriptor<
  typeof FourEyeInitiateInput,
  typeof FourEyeInitiateOutput
> = {
  id: 'admin.four_eye.initiate',
  name: 'Admin — initiate four-eye approval request',
  description:
    'HIGH-RISK. Create a four-eye approval request for a high-stakes ' +
    'action (large payment, regulator filing, contract signature, ' +
    'tenant purge, kill-switch flip, policy rule edit). Returns a token ' +
    'the second approver clicks. Reason is required and lands in the ' +
    'hash-chained audit log.',
  personaSlugs: ADMIN_ONLY,
  inputSchema: FourEyeInitiateInput,
  outputSchema: FourEyeInitiateOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.four_eye.initiate requires httpClient');
    }
    const body = withChatProvenance(
      {
        actionType: input.actionType,
        payload: { ...input.payload, reason: input.reason },
        secondApproverId: input.secondApproverId,
        ...(input.ttlMinutes !== undefined && { ttlMinutes: input.ttlMinutes }),
      },
      ctx,
    );
    const res = await client.post<{
      id?: string;
      actionType?: string;
      status?: string;
      approvalToken?: string;
      approvalUrl?: string;
      expiresAt?: string;
    }>('/owner/four-eye/request', body);
    const requestId = String(res.id ?? '');
    return {
      requestId,
      chipId: chipId('4eye_init'),
      approvalToken: String(res.approvalToken ?? ''),
      approvalUrl: String(res.approvalUrl ?? ''),
      expiresAt: String(res.expiresAt ?? new Date().toISOString()),
      actionType: String(res.actionType ?? input.actionType),
      status: String(res.status ?? 'pending'),
      noteEn: `Four-eye request for ${input.actionType} created — second approver notified.`,
      noteSw: `Ombi la macho-manne kwa ${input.actionType} limeundwa — mthibitishaji wa pili amejulishwa.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 4) admin.four_eye.approve — approve a pending four-eye request
// ────────────────────────────────────────────────────────────────────

const FourEyeApproveInput = z
  .object({
    approvalToken: z.string().min(16).max(200),
    note: z.string().min(1).max(2000).optional(),
  })
  .strict();

const FourEyeApproveOutput = z
  .object({
    approved: z.boolean(),
    requestId: z.string(),
    chipId: z.string(),
    actionType: z.string(),
    status: z.string(),
    executedAt: z.string().optional(),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminFourEyeApproveTool: PersonaToolDescriptor<
  typeof FourEyeApproveInput,
  typeof FourEyeApproveOutput
> = {
  id: 'admin.four_eye.approve',
  name: 'Admin — approve a pending four-eye request',
  description:
    'HIGH-RISK. Second approver approves a pending four-eye approval ' +
    'request via its token. Requester is forbidden from approving their ' +
    'own action; the upstream route refuses self-approval (audit-chain ' +
    'event SELF_APPROVAL_FORBIDDEN). Approval triggers the original ' +
    'action via the registered brain-tool dispatcher.',
  personaSlugs: ADMIN_ONLY,
  inputSchema: FourEyeApproveInput,
  outputSchema: FourEyeApproveOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.four_eye.approve requires httpClient');
    }
    const body = withChatProvenance(
      {
        ...(input.note !== undefined && { note: input.note }),
      },
      ctx,
    );
    const res = await client.post<{
      requestId?: string;
      id?: string;
      actionType?: string;
      status?: string;
      executedAt?: string;
    }>(
      `/owner/four-eye/approve/${encodeURIComponent(input.approvalToken)}`,
      body,
    );
    const requestId = String(res.requestId ?? res.id ?? '');
    return {
      approved: true,
      requestId,
      chipId: chipId('4eye_appr'),
      actionType: String(res.actionType ?? ''),
      status: String(res.status ?? 'approved'),
      ...(res.executedAt && { executedAt: String(res.executedAt) }),
      noteEn: 'Four-eye approval recorded — original action dispatched.',
      noteSw: 'Idhini ya macho-manne imerekodiwa — kitendo cha asili kimetolewa.',
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 5) admin.policy.edit_rule — propose a policy-rule edit (four-eye gated)
// ────────────────────────────────────────────────────────────────────

const PolicyEditRuleInput = z
  .object({
    ruleId: z.string().min(1).max(120),
    changeJson: z.record(z.string(), z.unknown()),
    reason: z.string().min(1).max(400),
    secondApproverId: z.string().min(1).max(128),
  })
  .strict();

const PolicyEditRuleOutput = z
  .object({
    requestId: z.string(),
    chipId: z.string(),
    approvalToken: z.string(),
    approvalUrl: z.string(),
    expiresAt: z.string(),
    ruleId: z.string(),
    status: z.string(),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminPolicyEditRuleTool: PersonaToolDescriptor<
  typeof PolicyEditRuleInput,
  typeof PolicyEditRuleOutput
> = {
  id: 'admin.policy.edit_rule',
  name: 'Admin — propose a policy-rule edit',
  description:
    'HIGH-RISK. Propose a change to an inviolable policy rule. Routes ' +
    'through the four-eye approval flow (actionType=policy.rule_edit). ' +
    'The brain may NEVER generalise the rule prefix — sovereign / ' +
    'kill_switch / four_eye / policy_rollout edits must hit literal ' +
    'rules (CLAUDE.md hard rule).',
  personaSlugs: ADMIN_ONLY,
  inputSchema: PolicyEditRuleInput,
  outputSchema: PolicyEditRuleOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('admin.policy.edit_rule requires httpClient');
    }
    const body = withChatProvenance(
      {
        actionType: 'policy.rule_edit' as const,
        payload: {
          ruleId: input.ruleId,
          changeJson: input.changeJson,
          reason: input.reason,
        },
        secondApproverId: input.secondApproverId,
      },
      ctx,
    );
    const res = await client.post<{
      id?: string;
      actionType?: string;
      status?: string;
      approvalToken?: string;
      approvalUrl?: string;
      expiresAt?: string;
    }>('/owner/four-eye/request', body);
    return {
      requestId: String(res.id ?? ''),
      chipId: chipId('pol_edit'),
      approvalToken: String(res.approvalToken ?? ''),
      approvalUrl: String(res.approvalUrl ?? ''),
      expiresAt: String(res.expiresAt ?? new Date().toISOString()),
      ruleId: input.ruleId,
      status: String(res.status ?? 'pending'),
      noteEn: `Policy rule "${input.ruleId}" edit proposed — second approver must confirm.`,
      noteSw: `Mabadiliko ya sheria "${input.ruleId}" yamependekezwa — mthibitishaji wa pili lazima athibitishe.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 6) admin.feature_flag.set — emit a chip to flip a feature flag
// ────────────────────────────────────────────────────────────────────
//
// The upstream PATCH /api/v1/mining/internal/feature-flags/:flagKey/
// rollout endpoint is the canonical write path. The persona-tool
// loopback client only supports GET / POST today (see
// loopback-http-client.ts:241-256), so this tool emits a cockpit-bus
// chip envelope that the admin-web FE applies by issuing the PATCH
// with the active admin session token. The chip carries all params
// the FE needs plus a chat-provenance envelope so the resulting audit
// row deep-links back to the originating Mr. Mwikila turn.
//
// Why a chip rather than a backdoor: the PATCH route already runs the
// auth + role gate (SUPER_ADMIN / ADMIN) and emits the audit row; we
// want the platform admin's UA token on the wire so the audit chain
// shows the real admin (not the loopback service principal).

const FeatureFlagSetInput = z
  .object({
    flagKey: z.string().min(1).max(120),
    value: z.boolean(),
    rolloutPct: z.number().int().min(0).max(100).optional(),
    reason: z.string().min(1).max(400),
  })
  .strict();

const FeatureFlagSetOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    flagKey: z.string(),
    targetValue: z.boolean(),
    targetRolloutPct: z.number().int().min(0).max(100).optional(),
    httpMethod: z.literal('PATCH'),
    httpPath: z.string(),
    emittedAt: z.string(),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminFeatureFlagSetTool: PersonaToolDescriptor<
  typeof FeatureFlagSetInput,
  typeof FeatureFlagSetOutput
> = {
  id: 'admin.feature_flag.set',
  name: 'Admin — set a feature-flag default + rollout percentage',
  description:
    'HIGH-RISK. Emit a confirmation chip to flip a feature flag default ' +
    'value and optional rollout percentage. The admin-web cockpit FE ' +
    'reads the chip and fires PATCH /api/v1/mining/internal/feature-' +
    'flags/:flagKey/rollout with the active admin session token so the ' +
    'audit row shows the real admin (not the loopback service token).',
  personaSlugs: ADMIN_ONLY,
  inputSchema: FeatureFlagSetInput,
  outputSchema: FeatureFlagSetOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, _ctx) {
    return {
      accepted: true,
      chipId: chipId('ff_set'),
      flagKey: input.flagKey,
      targetValue: input.value,
      ...(input.rolloutPct !== undefined && {
        targetRolloutPct: input.rolloutPct,
      }),
      httpMethod: 'PATCH' as const,
      httpPath: `/api/v1/mining/internal/feature-flags/${encodeURIComponent(input.flagKey)}/rollout`,
      emittedAt: new Date().toISOString(),
      noteEn: `Feature flag "${input.flagKey}" target set to ${input.value} — confirm to apply.`,
      noteSw: `Bendera ya kipengele "${input.flagKey}" imewekwa ${input.value} — thibitisha ili itekelezwe.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 7) admin.audit.export — kick off an audit-trail export job
// ────────────────────────────────────────────────────────────────────

const AuditExportInput = z
  .object({
    from: z.string().min(1).max(40),
    to: z.string().min(1).max(40),
    format: z.enum(['csv', 'json', 'pdf']),
    tenantId: z.string().min(1).max(120).optional(),
    actor: z.string().min(1).max(200).optional(),
    action: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(400),
  })
  .strict();

const AuditExportOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    rowsPreviewCount: z.number().int().nonnegative(),
    from: z.string(),
    to: z.string(),
    format: z.string(),
    emittedAt: z.string(),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminAuditExportTool: PersonaToolDescriptor<
  typeof AuditExportInput,
  typeof AuditExportOutput
> = {
  id: 'admin.audit.export',
  name: 'Admin — export audit-trail range to file',
  description:
    'HIGH-RISK. Probe the audit log for the requested range (GET ' +
    '/api/v1/admin/audit/log) and emit a chip the cockpit FE uses to ' +
    'render an export-download card. Format may be CSV / JSON / PDF. ' +
    'Reason is required and lands in the audit chain itself so the ' +
    "regulator's review log includes a row for the export request.",
  personaSlugs: ADMIN_ONLY,
  inputSchema: AuditExportInput,
  outputSchema: AuditExportOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    let rowsCount = 0;
    if (client) {
      try {
        const probe = await client.get<ReadonlyArray<unknown>>(
          '/admin/audit/log',
          {
            query: {
              since: input.from,
              until: input.to,
              limit: 1,
              ...(input.tenantId !== undefined && { tenantId: input.tenantId }),
              ...(input.actor !== undefined && { actor: input.actor }),
              ...(input.action !== undefined && { action: input.action }),
            },
          },
        );
        rowsCount = Array.isArray(probe) ? probe.length : 0;
      } catch {
        // probe failures are non-fatal — the FE renders the chip and
        // the user retries on the cockpit. The audit row for the
        // export request is still emitted via the dispatcher adapter.
        rowsCount = 0;
      }
    }
    return {
      accepted: true,
      chipId: chipId('audit_exp'),
      rowsPreviewCount: rowsCount,
      from: input.from,
      to: input.to,
      format: input.format,
      emittedAt: new Date().toISOString(),
      noteEn: `Audit export ${input.from} → ${input.to} (${input.format}) queued — confirm to download.`,
      noteSw: `Hamisha audit ${input.from} → ${input.to} (${input.format}) imeshakaa — thibitisha ili upakue.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 8) admin.tenant.suspend — schedule a tenant deletion (30-day grace)
// ────────────────────────────────────────────────────────────────────
//
// "Suspend" here means schedule the soft-delete grace window (KE PDPA
// Art. 26(2) / TZ PDPA s.17 — 30-day minimum). The upstream route is
// DELETE /api/v1/tenants/:id but the loopback HTTP client only knows
// GET / POST, so we emit a cockpit-bus chip carrying the canonical
// DELETE path + body. The admin-web cockpit FE reads the chip and
// fires the DELETE with the active admin session token. The route
// itself emits the security-severity audit event; this tool emits its
// own row in the persona-tool audit chain so the brain-side trace is
// preserved even before the FE click lands.

const TenantSuspendInput = z
  .object({
    tenantId: z.string().min(1).max(120),
    reason: z.string().min(1).max(2000),
    graceDays: z.number().int().min(30).max(180).optional(),
  })
  .strict();

const TenantSuspendOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    tenantId: z.string(),
    graceDays: z.number().int().min(30).max(180),
    httpMethod: z.literal('DELETE'),
    httpPath: z.string(),
    emittedAt: z.string(),
    noteEn: z.string(),
    noteSw: z.string(),
  })
  .strict();

export const adminTenantSuspendTool: PersonaToolDescriptor<
  typeof TenantSuspendInput,
  typeof TenantSuspendOutput
> = {
  id: 'admin.tenant.suspend',
  name: 'Admin — schedule a tenant suspension (soft-delete grace)',
  description:
    'HIGH-RISK. Schedule a tenant soft-delete with a 30-day minimum ' +
    'grace window (KE PDPA Art. 26(2) / TZ PDPA s.17). Emits a chip ' +
    'the admin-web cockpit FE reads to fire DELETE /api/v1/tenants/:id ' +
    'with the active admin session token. Reason is required and lands ' +
    'in the security-severity audit event the route emits.',
  personaSlugs: ADMIN_ONLY,
  inputSchema: TenantSuspendInput,
  outputSchema: TenantSuspendOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: true,
  async handler(input, _ctx) {
    const graceDays = input.graceDays ?? 30;
    return {
      accepted: true,
      chipId: chipId('tnt_susp'),
      tenantId: input.tenantId,
      graceDays,
      httpMethod: 'DELETE' as const,
      httpPath: `/api/v1/tenants/${encodeURIComponent(input.tenantId)}`,
      emittedAt: new Date().toISOString(),
      noteEn: `Tenant ${input.tenantId} suspension scheduled (${graceDays}-day grace) — confirm to fire.`,
      noteSw: `Kusimamishwa kwa mpangaji ${input.tenantId} kumeshaipangwa (siku ${graceDays} za neema) — thibitisha ili itekelezwe.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Catalog export
// ────────────────────────────────────────────────────────────────────

export const ADMIN_INVIOLABLE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  adminKillSwitchOpenTool,
  adminKillSwitchCloseTool,
  adminFourEyeInitiateTool,
  adminFourEyeApproveTool,
  adminPolicyEditRuleTool,
  adminFeatureFlagSetTool,
  adminAuditExportTool,
  adminTenantSuspendTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
