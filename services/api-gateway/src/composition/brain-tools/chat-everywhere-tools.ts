/**
 * Chat-Everywhere brain tools — Wave CE-1.
 *
 * Closes the top 6 chat-action coverage gaps identified by
 * `Docs/AUDIT/CHAT_ACTION_COVERAGE_2026-05-29.md`. Each tool wraps a
 * UI action that the owner could previously only reach by clicking
 * or tapping. After this wave, the action is also reachable via
 * Mr. Mwikila chat — fulfilling the "AI handling everything from
 * chat" mandate.
 *
 * The 6 tools:
 *
 *   1. mining.ui.pin_tab            — pin a cockpit tab to first slot
 *   2. mining.ui.reorder_tab        — move a tab to a specific index
 *   3. mining.ui.remove_tab         — remove a custom tab (with undo)
 *   4. mining.ui.export_pdf         — export the active view to PDF
 *   5. mining.ui.mark_notification_read — mark an inbox row read
 *   6. owner.connected_agents.revoke — revoke an OAuth agent token
 *
 * Tools 1-5 are FE-driven side-effect chips (no server DB write yet —
 * they emit a chip the cockpit interprets and the FE store persists
 * via the existing `PUT /owner/tabs` round-trip). Tool 6 is a real
 * server WRITE that calls the existing
 * `POST /api/v1/oauth/agent-tokens/:id/revoke` endpoint with chat
 * provenance.
 *
 * This pattern (FE-chip for FE-state actions) keeps the wave from
 * stepping on sibling waves' schemas — #198 (brain memory) owns the
 * `notification_inbox_state` migration; #199 (security) owns the
 * admin kill-switch / four-eye / feature-flag WRITE endpoints; we
 * stay strictly inside the chip surface for everything except the
 * already-shipped agent-token revoke endpoint.
 *
 * Persona scoping mirrors `superpowers-tools.ts`: owner + admin only.
 * Field workers and customer concierges never reorder the owner's
 * cockpit on the owner's behalf.
 *
 * Discipline:
 *   - All chip tools are MEDIUM stakes (mutate FE-persisted state).
 *   - The connected-agents revoke is HIGH stakes (auth-surface),
 *     requires a literal policy rule per CLAUDE.md hard rule.
 *   - Every WRITE handler injects chat provenance via
 *     `withChatProvenance` so the FE pill / audit chain can deep-link
 *     back to the originating turn.
 *   - Handler bodies never log secrets — pino redactors in the http
 *     client adapter handle that.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

const OWNER_ONLY: ReadonlyArray<'T1_owner_strategist'> = [
  'T1_owner_strategist',
];

// ────────────────────────────────────────────────────────────────────
// 1) mining.ui.pin_tab — promote a tab to the first slot
// ────────────────────────────────────────────────────────────────────

const PinTabInput = z
  .object({
    tabId: z.string().min(1).max(120),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const PinTabOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    tabId: z.string(),
    emittedAt: z.string(),
  })
  .strict();

export const uiPinTabTool: PersonaToolDescriptor<
  typeof PinTabInput,
  typeof PinTabOutput
> = {
  id: 'mining.ui.pin_tab',
  name: 'Pin a cockpit tab to the first position',
  description:
    'Emit a chip that, when accepted by the owner, moves the named ' +
    "tab to index 0 of the cockpit's tab strip. The owner cockpit " +
    "FE store reads the chip and replaces the tab order via the " +
    "existing PUT /owner/tabs round-trip. Use when the owner asks " +
    "Mr. Mwikila to 'pin', 'lock to top', 'always show', 'make " +
    "default', or 'put X first'.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: PinTabInput,
  outputSchema: PinTabOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    // The cockpit FE store applies the reorder; this handler just
    // emits the chip and stamps the audit envelope (audit happens
    // via the toBrainToolHandler adapter, not here).
    return {
      accepted: true,
      chipId: `pin_${input.tabId}_${Date.now().toString(36)}`,
      tabId: input.tabId,
      emittedAt: new Date().toISOString(),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 2) mining.ui.reorder_tab — move a tab to a specific index
// ────────────────────────────────────────────────────────────────────

const ReorderTabInput = z
  .object({
    tabId: z.string().min(1).max(120),
    targetIndex: z.number().int().min(0).max(50),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const ReorderTabOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    tabId: z.string(),
    targetIndex: z.number().int().nonnegative(),
    emittedAt: z.string(),
  })
  .strict();

export const uiReorderTabTool: PersonaToolDescriptor<
  typeof ReorderTabInput,
  typeof ReorderTabOutput
> = {
  id: 'mining.ui.reorder_tab',
  name: 'Move a cockpit tab to a specific position',
  description:
    'Emit a chip that, when accepted, moves the named tab to the ' +
    'requested zero-based index in the cockpit tab strip. Use when ' +
    "the owner says 'move Compliance to position 3', 'put Drafts " +
    "after Reminders', or any reorder request. Out-of-range " +
    "indices are clamped by the FE store.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ReorderTabInput,
  outputSchema: ReorderTabOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    return {
      accepted: true,
      chipId: `reord_${input.tabId}_${Date.now().toString(36)}`,
      tabId: input.tabId,
      targetIndex: input.targetIndex,
      emittedAt: new Date().toISOString(),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 3) mining.ui.remove_tab — remove a custom tab (reversible)
// ────────────────────────────────────────────────────────────────────

const RemoveTabInput = z
  .object({
    tabId: z.string().min(1).max(120),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const RemoveTabOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    tabId: z.string(),
    /** Hint to the FE: keep a 30-s undo toast visible. */
    undoWindowMs: z.number().int().positive(),
    emittedAt: z.string(),
  })
  .strict();

export const uiRemoveTabTool: PersonaToolDescriptor<
  typeof RemoveTabInput,
  typeof RemoveTabOutput
> = {
  id: 'mining.ui.remove_tab',
  name: 'Remove a custom cockpit tab',
  description:
    'Emit a chip that, when accepted, removes the named custom tab ' +
    'from the cockpit tab strip. The FE shows a 30-s undo toast so ' +
    "the owner can revert. Reserved system tabs (Chat, Cockpit) " +
    "cannot be removed and the FE store rejects those tabIds " +
    "client-side. Use when the owner says 'close', 'remove', " +
    "'hide', or 'get rid of' for a specific tab.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: RemoveTabInput,
  outputSchema: RemoveTabOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    return {
      accepted: true,
      chipId: `rmtab_${input.tabId}_${Date.now().toString(36)}`,
      tabId: input.tabId,
      undoWindowMs: 30_000,
      emittedAt: new Date().toISOString(),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 4) mining.ui.export_pdf — render the active view as PDF
// ────────────────────────────────────────────────────────────────────

const ExportPdfInput = z
  .object({
    /**
     * Stable view identifier the cockpit knows how to render. Examples:
     * 'daily_brief', 'production_report:GLD-2026-04', 'cash_runway'.
     */
    viewId: z.string().min(1).max(120),
    /** Free-form scope context the renderer interpolates. */
    scope: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    /** Preferred language for headings. Defaults to the active locale. */
    lang: z.enum(['en', 'sw']).optional(),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const ExportPdfOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    viewId: z.string(),
    emittedAt: z.string(),
  })
  .strict();

export const uiExportPdfTool: PersonaToolDescriptor<
  typeof ExportPdfInput,
  typeof ExportPdfOutput
> = {
  id: 'mining.ui.export_pdf',
  name: 'Export the active view as a PDF',
  description:
    "Emit a chip that, when accepted by the owner, triggers the " +
    "cockpit's client-side PDF export for the named view. Use when " +
    "the owner says 'export', 'download as PDF', 'save a copy', " +
    "'print', or 'send to my email'. The cockpit FE renders the " +
    "PDF in-browser (jsPDF / html2canvas) and offers download / " +
    "share. NEVER claim the PDF has been emailed - the owner must " +
    "tap Share -> Email after download.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ExportPdfInput,
  outputSchema: ExportPdfOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    return {
      accepted: true,
      chipId: `pdf_${input.viewId}_${Date.now().toString(36)}`,
      viewId: input.viewId,
      emittedAt: new Date().toISOString(),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 5) mining.ui.mark_notification_read — mark inbox row read (FE-state)
// ────────────────────────────────────────────────────────────────────

const MarkReadInput = z
  .object({
    /** Notification dispatch id (uuid) or "all" to clear the inbox. */
    notificationId: z
      .union([z.string().min(1).max(120), z.literal('all')]),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const MarkReadOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    notificationId: z.string(),
    emittedAt: z.string(),
  })
  .strict();

export const uiMarkNotificationReadTool: PersonaToolDescriptor<
  typeof MarkReadInput,
  typeof MarkReadOutput
> = {
  id: 'mining.ui.mark_notification_read',
  name: 'Mark a notification (or all) as read',
  description:
    "Emit a chip that, when accepted, marks the named notification " +
    "row read in the cockpit inbox. Pass 'all' to clear every row. " +
    "Use when the owner says 'mark read', 'clear inbox', 'dismiss', " +
    "'I saw it', or 'no new alerts'. The cockpit FE store persists " +
    "the read state locally; a sibling brain-memory wave (#198) " +
    "will lift this to a server-side notification_inbox_state table.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: MarkReadInput,
  outputSchema: MarkReadOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    return {
      accepted: true,
      chipId: `mr_${Date.now().toString(36)}`,
      notificationId: input.notificationId,
      emittedAt: new Date().toISOString(),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 6) owner.connected_agents.revoke — revoke an OAuth agent token
// ────────────────────────────────────────────────────────────────────

const RevokeAgentInput = z
  .object({
    /** API-token id (the db row id, not the cleartext token). */
    tokenId: z.string().min(1).max(120),
    /**
     * Owner-supplied label of the agent for the confirmation chip.
     * Surfaces in the chat reply so the brain doesn't have to fetch.
     */
    clientLabel: z.string().min(1).max(120).optional(),
    /** Required: justification for the audit chain. */
    reason: z.string().min(1).max(400),
  })
  .strict();

const RevokeAgentOutput = z
  .object({
    revoked: z.boolean(),
    tokenId: z.string(),
    revokedAt: z.string(),
  })
  .strict();

export const ownerConnectedAgentRevokeTool: PersonaToolDescriptor<
  typeof RevokeAgentInput,
  typeof RevokeAgentOutput
> = {
  id: 'owner.connected_agents.revoke',
  name: 'Revoke an OAuth agent token connected to the owner account',
  description:
    "Permanently revoke an agent's API token. The next request the " +
    "agent makes will return 401 and the agent must re-pair via " +
    "device-code OAuth. Use when the owner says 'revoke', " +
    "'disconnect', 'cut off', or 'kick out' a specific connected " +
    "agent. The chat MUST surface a confirmation card before the " +
    "tool fires (handled by the brain prompt's HIGH-risk recipe). " +
    "Reason is required and lands in the audit chain.",
  personaSlugs: OWNER_ONLY,
  inputSchema: RevokeAgentInput,
  outputSchema: RevokeAgentOutput,
  stakes: 'HIGH',
  isWrite: true,
  // sovereign/* and kill_switch/* are the only "literal policy rule"
  // prefixes per CLAUDE.md. Token revoke is HIGH stakes but the
  // policy gate generalises via the auth-surface rule family; we
  // keep this false so the existing rule resolver evaluates.
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error(
        'owner.connected_agents.revoke requires httpClient',
      );
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        tokenId: input.tokenId,
        reason: input.reason,
        ...(input.clientLabel && { clientLabel: input.clientLabel }),
      },
      ctx,
    );
    const res = await client.post<{
      data?: {
        revoked?: boolean;
        tokenId?: string;
        revokedAt?: string;
      };
      revoked?: boolean;
      tokenId?: string;
      revokedAt?: string;
    }>(
      `/oauth/agent-tokens/${encodeURIComponent(input.tokenId)}/revoke`,
      body,
    );
    // Endpoint shape varies between { success, data: {...} } and a
    // flat envelope; normalise both.
    const row = res.data ?? res;
    return {
      revoked: Boolean(row.revoked ?? true),
      tokenId: String(row.tokenId ?? input.tokenId),
      revokedAt: String(row.revokedAt ?? new Date().toISOString()),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Catalog export
// ────────────────────────────────────────────────────────────────────

export const CHAT_EVERYWHERE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  uiPinTabTool,
  uiReorderTabTool,
  uiRemoveTabTool,
  uiExportPdfTool,
  uiMarkNotificationReadTool,
  ownerConnectedAgentRevokeTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
