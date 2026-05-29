/**
 * Borjie Superpowers - Wave SUPERPOWERS brain tool catalog.
 *
 * Eight chat-callable tools that turn Mr. Mwikila from an answerer
 * into an actor on the owner's UI:
 *
 *   1. mining.ui.navigate         - route the owner to a different tab
 *   2. mining.ui.prefill_form     - fill a form from chat-derived data
 *   3. mining.ui.highlight        - guided callout on a UI element
 *   4. mining.ui.share_view       - generate shareable / time-limited link
 *   5. mining.ui.bulk_action      - operate on many entities at once
 *   6. mining.ui.undo_last_action - generic undo within a 5-min window
 *   7. mining.ui.bookmark         - pin entity to owner's quick-access strip
 *   8. mining.ui.unbookmark       - unpin an entity (companion to bookmark)
 *
 * Power 7 of the original 8 (the universal command palette) is a PURE
 * FE component (no brain tool needed) and lives in
 * `packages/design-system/src/command-palette/CommandPalette.tsx`.
 * Eight tools here keep the brain catalog symmetric with the prompt
 * extension.
 *
 * Persona: T1 owner_strategist plus T2 admin_strategist (so the
 * Borjie admin console can dogfood the same surface). T3..T5 are
 * deliberately excluded - field workers and customer concierges
 * never share or pin on the owner's behalf.
 *
 * Discipline:
 *   - Read tools (navigate / highlight) stay LOW stakes, isWrite=false.
 *   - Write tools (prefill / share / bulk / bookmark / undo) are
 *     MEDIUM stakes, isWrite=true so the gate hash-chains audit.
 *   - Bulk action carries `requiresPolicyRuleLiteral=true` so the
 *     policy gate refuses any reason-resolver generalisation
 *     (per CLAUDE.md hard rule).
 *   - All WRITE tools inject chat provenance via withChatProvenance.
 *   - Handler bodies never log secrets - the HTTP client adapter
 *     redacts via pino's serializers.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

// ────────────────────────────────────────────────────────────────────
// 1) mining.ui.navigate - route the owner to a different view
// ────────────────────────────────────────────────────────────────────

const NavigateInput = z
  .object({
    route: z
      .string()
      .min(1)
      .max(200)
      .regex(/^\//, 'route must start with /'),
    scopeIds: z.array(z.string().min(1).max(80)).max(10).optional(),
    focus: z.string().min(1).max(80).optional(),
    ttl: z.number().int().min(0).max(86400).optional(),
    reason: z.string().min(1).max(400),
  })
  .strict();

const NavigateOutput = z
  .object({
    accepted: z.boolean(),
    chipId: z.string(),
    emittedAt: z.string(),
  })
  .strict();

export const uiNavigateTool: PersonaToolDescriptor<
  typeof NavigateInput,
  typeof NavigateOutput
> = {
  id: 'mining.ui.navigate',
  name: 'Navigate the owner to a different view',
  description:
    'Emit a UI navigation chip beneath the chat bubble that, when ' +
    'tapped, routes the owner to a different route / tab with optional ' +
    'scope + focus parameters. NEVER pulls the owner involuntarily - ' +
    'they tap to accept. Use when the question is better answered ' +
    'visually in another view (Licences / Royalties / Compliance / ' +
    'Counterparties / etc).',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: NavigateInput,
  outputSchema: NavigateOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    // Pure SSE chip - no server-side state change. The brain-teach
    // route streams the chip event; this handler just confirms the
    // brain's intent for the audit trail.
    return {
      accepted: true,
      chipId: `nav_${Date.now().toString(36)}`,
      emittedAt: new Date().toISOString(),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 2) mining.ui.prefill_form - fill a form for the owner
// ────────────────────────────────────────────────────────────────────

const PrefillInput = z
  .object({
    formId: z.string().min(1).max(120),
    values: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    submitOnAccept: z.boolean().optional().default(false),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const PrefillOutput = z
  .object({
    accepted: z.boolean(),
    formId: z.string(),
    valueCount: z.number().int().nonnegative(),
    emittedAt: z.string(),
  })
  .strict();

export const uiPrefillTool: PersonaToolDescriptor<
  typeof PrefillInput,
  typeof PrefillOutput
> = {
  id: 'mining.ui.prefill_form',
  name: 'Pre-fill a form from chat-derived data',
  description:
    'Push values into a specific form (by formId) that the owner has ' +
    "open or will open next. Owner sees a 'Mr. Mwikila pre-filled this' " +
    'pill at the top of the form and reviews before submitting. Use when ' +
    'data has been gathered conversationally and the form would otherwise ' +
    'force the owner to re-type.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: PrefillInput,
  outputSchema: PrefillOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    // No server-side side-effect; the chip is emitted via SSE and the
    // FE applies the prefill. We still hash-chain via the audit sink
    // because pre-filling a form on the owner's behalf is a chat-as-OS
    // write surface.
    const client = ctx.httpClient;
    if (!client) {
      return {
        accepted: true,
        formId: input.formId,
        valueCount: Object.keys(input.values).length,
        emittedAt: new Date().toISOString(),
      };
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        formId: input.formId,
        values: input.values,
        submitOnAccept: input.submitOnAccept ?? false,
        ...(input.reason && { reason: input.reason }),
      },
      ctx,
    );
    // Retarget: canonical surface is POST /api/v1/owner/superpowers/prefill
    // (services/api-gateway/src/routes/owner/superpowers.hono.ts). The
    // route ack-audits the prefill emission; the actual chip render
    // lives in brain-teach SSE.
    const res = await client.post<{
      data?: {
        accepted?: boolean;
        formId?: string;
        valueCount?: number;
        emittedAt?: string;
      };
    }>('/owner/superpowers/prefill', body);
    const row = res.data ?? {};
    return {
      accepted: Boolean(row.accepted ?? true),
      formId: String(row.formId ?? input.formId),
      valueCount: Number(row.valueCount ?? Object.keys(input.values).length),
      emittedAt: String(row.emittedAt ?? new Date().toISOString()),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 3) mining.ui.highlight - guided callout
// ────────────────────────────────────────────────────────────────────

const HighlightInput = z
  .object({
    selector: z.string().min(1).max(200),
    messageEn: z.string().min(1).max(400),
    messageSw: z.string().min(1).max(400),
    ttl: z.number().int().min(1000).max(60_000).optional().default(8000),
    tone: z
      .enum(['info', 'success', 'warning', 'critical'])
      .optional()
      .default('info'),
  })
  .strict();

const HighlightOutput = z
  .object({
    accepted: z.boolean(),
    emittedAt: z.string(),
  })
  .strict();

export const uiHighlightTool: PersonaToolDescriptor<
  typeof HighlightInput,
  typeof HighlightOutput
> = {
  id: 'mining.ui.highlight',
  name: 'Render a guided callout on a UI element',
  description:
    'Emit a Popover-style callout anchored to a stable selector ' +
    "(usually a data-tour='...' attribute - see UI_TOUR_SELECTORS " +
    'catalog). Auto-dismisses after `ttl` ms. Use rarely - only when ' +
    "the owner is stuck and a short bilingual hint unblocks them.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: HighlightInput,
  outputSchema: HighlightOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, _ctx) {
    return {
      accepted: true,
      emittedAt: new Date().toISOString(),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 4) mining.ui.share_view - generate shareable link
// ────────────────────────────────────────────────────────────────────

const ShareInput = z
  .object({
    entityType: z.enum([
      'draft',
      'document',
      'royalty_filing',
      'production_report',
      'compliance_artifact',
      'reminder',
      'shipment',
      'invoice',
    ]),
    entityId: z.string().min(1).max(120),
    recipients: z.array(z.string().email()).max(10).optional(),
    expiresInHours: z.number().int().min(1).max(720).default(24),
    permission: z.enum(['read', 'comment', 'edit']).default('read'),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const ShareOutput = z
  .object({
    shareLinkId: z.string(),
    token: z.string(),
    url: z.string(),
    expiresAt: z.string(),
    dispatched: z.number().int().nonnegative(),
  })
  .strict();

export const uiShareViewTool: PersonaToolDescriptor<
  typeof ShareInput,
  typeof ShareOutput
> = {
  id: 'mining.ui.share_view',
  name: 'Generate a shareable link for an entity',
  description:
    'Mint a time-limited share token for a draft / document / royalty ' +
    'filing / report etc. Optionally dispatch the link to one or more ' +
    "recipients via email (uses the reminders worker). Use when the " +
    "owner asks to 'send X to my accountant' or 'share Y with the " +
    "regulator'.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ShareInput,
  outputSchema: ShareOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('mining.ui.share_view requires httpClient');
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        recipients: input.recipients ?? [],
        expiresInHours: input.expiresInHours,
        permission: input.permission,
        ...(input.reason && { reason: input.reason }),
      },
      ctx,
    );
    return client.post<{
      shareLinkId: string;
      token: string;
      url: string;
      expiresAt: string;
      dispatched: number;
    }>('/owner/share-links', body);
  },
};

// ────────────────────────────────────────────────────────────────────
// 5) mining.ui.bulk_action - operate on many entities at once
// ────────────────────────────────────────────────────────────────────

const BulkInput = z
  .object({
    entityType: z.enum([
      'reminders',
      'tasks',
      'incidents',
      'documents',
      'bids',
    ]),
    ids: z.array(z.string().min(1).max(120)).min(1).max(100),
    action: z.enum([
      'snooze',
      'complete',
      'acknowledge',
      'archive',
      'withdraw',
    ]),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
    reason: z.string().min(1).max(400),
  })
  .strict();

const BulkOutput = z
  .object({
    accepted: z.boolean(),
    processed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    undoJournalIds: z.array(z.string()),
  })
  .strict();

export const uiBulkActionTool: PersonaToolDescriptor<
  typeof BulkInput,
  typeof BulkOutput
> = {
  id: 'mining.ui.bulk_action',
  name: 'Apply an action to many entities at once',
  description:
    'Operate on a batch of entities in one call. Allowed combinations: ' +
    'reminders.snooze, tasks.complete, incidents.acknowledge, ' +
    'documents.archive, bids.withdraw. Owner sees a confirmation card ' +
    "listing the N entities + the action before it fires. Use when the " +
    "owner asks 'snooze all my reminders for tomorrow' or 'archive " +
    "everything older than 6 months'.",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: BulkInput,
  outputSchema: BulkOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  // HIGH-risk policy prefix: bulk writes touch many rows and must hit
  // literal policy rules; no reason-resolver generalisation allowed
  // (CLAUDE.md hard rule).
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('mining.ui.bulk_action requires httpClient');
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        entityType: input.entityType,
        ids: input.ids,
        action: input.action,
        payload: input.payload ?? {},
        reason: input.reason,
      },
      ctx,
    );
    return client.post<{
      accepted: boolean;
      processed: number;
      failed: number;
      undoJournalIds: string[];
    }>('/owner/superpowers/bulk-action', body);
  },
};

// ────────────────────────────────────────────────────────────────────
// 6) mining.ui.undo_last_action - reverse the most recent write
// ────────────────────────────────────────────────────────────────────

const UndoInput = z
  .object({
    entityRef: z
      .object({
        entityType: z.string().min(1).max(60),
        entityId: z.string().min(1).max(120),
      })
      .strict()
      .optional(),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const UndoOutput = z
  .object({
    undone: z.boolean(),
    journalId: z.string().nullable(),
    actionKind: z.string().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
  })
  .strict();

export const uiUndoLastActionTool: PersonaToolDescriptor<
  typeof UndoInput,
  typeof UndoOutput
> = {
  id: 'mining.ui.undo_last_action',
  name: 'Undo the most recent write within the 5-min window',
  description:
    'Reverse the most recent un-undone write the current actor made ' +
    'within the configured undo window (default 5 min). If `entityRef` ' +
    "is supplied, undoes the last action on that specific entity. " +
    'Replays the `before_state` snapshot from the undo journal.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: UndoInput,
  outputSchema: UndoOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('mining.ui.undo_last_action requires httpClient');
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        ...(input.entityRef && { entityRef: input.entityRef }),
        ...(input.reason && { reason: input.reason }),
      },
      ctx,
    );
    return client.post<{
      undone: boolean;
      journalId: string | null;
      actionKind: string | null;
      entityType: string | null;
      entityId: string | null;
    }>('/owner/undo-journal/undo-last', body);
  },
};

// ────────────────────────────────────────────────────────────────────
// 7) mining.ui.bookmark - pin entity to quick-access strip
// ────────────────────────────────────────────────────────────────────

const BookmarkInput = z
  .object({
    entityType: z.enum([
      'licence',
      'royalty_filing',
      'site',
      'counterparty',
      'document',
      'draft',
      'reminder',
      'shipment',
    ]),
    entityId: z.string().min(1).max(120),
    label: z.string().min(1).max(80).optional(),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const BookmarkOutput = z
  .object({
    pinnedItemId: z.string(),
    position: z.number().int().nonnegative(),
    label: z.string(),
  })
  .strict();

export const uiBookmarkTool: PersonaToolDescriptor<
  typeof BookmarkInput,
  typeof BookmarkOutput
> = {
  id: 'mining.ui.bookmark',
  name: 'Pin entity to the owner quick-access strip',
  description:
    "Pin an entity (Geita PML, April royalty filing, NEMC EIA, ...) to " +
    "the owner's quick-access strip above the dashboard. Suggest after " +
    'the 3rd reference to the same entity in chat.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: BookmarkInput,
  outputSchema: BookmarkOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('mining.ui.bookmark requires httpClient');
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        ownerId: ctx.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.label && { label: input.label }),
        ...(input.reason && { reason: input.reason }),
      },
      ctx,
    );
    return client.post<{
      pinnedItemId: string;
      position: number;
      label: string;
    }>('/owner/pinned-items', body);
  },
};

// ────────────────────────────────────────────────────────────────────
// 8) mining.ui.unbookmark - remove an entity from the strip
// ────────────────────────────────────────────────────────────────────

const UnbookmarkInput = z
  .object({
    pinnedItemId: z.string().min(1).max(120).optional(),
    entityRef: z
      .object({
        entityType: z.string().min(1).max(60),
        entityId: z.string().min(1).max(120),
      })
      .strict()
      .optional(),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.pinnedItemId ?? v.entityRef), {
    message: 'must provide pinnedItemId or entityRef',
  });

const UnbookmarkOutput = z
  .object({
    unpinned: z.boolean(),
    pinnedItemId: z.string().nullable(),
  })
  .strict();

export const uiUnbookmarkTool: PersonaToolDescriptor<
  typeof UnbookmarkInput,
  typeof UnbookmarkOutput
> = {
  id: 'mining.ui.unbookmark',
  name: 'Remove an entity from the quick-access strip',
  description:
    'Unpin a previously bookmarked entity. Either supply the ' +
    '`pinnedItemId` directly or an `entityRef` to look it up.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: UnbookmarkInput,
  outputSchema: UnbookmarkOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('mining.ui.unbookmark requires httpClient');
    }
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        ownerId: ctx.actorId,
        ...(input.pinnedItemId && { pinnedItemId: input.pinnedItemId }),
        ...(input.entityRef && { entityRef: input.entityRef }),
        ...(input.reason && { reason: input.reason }),
      },
      ctx,
    );
    return client.post<{
      unpinned: boolean;
      pinnedItemId: string | null;
    }>('/owner/pinned-items/unpin', body);
  },
};

// ────────────────────────────────────────────────────────────────────
// Catalog export
// ────────────────────────────────────────────────────────────────────

export const SUPERPOWERS_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  uiNavigateTool,
  uiPrefillTool,
  uiHighlightTool,
  uiShareViewTool,
  uiBulkActionTool,
  uiUndoLastActionTool,
  uiBookmarkTool,
  uiUnbookmarkTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
