/**
 * Owner Tabs brain tool catalog (Wave OWNER-OS-DURABLE).
 *
 * Backs the SERVER-side tab persistence surface (`/api/v1/owner/tabs`,
 * migration 0089 / fresh-DB-safety re-assertion 0277). Mr. Mwikila can
 * spawn / close / update tabs on the owner cockpit via chat, and the
 * changes sync to every device the owner is signed in on — without a
 * client round-trip, because the handler persists to `owner_tabs.state`
 * directly.
 *
 * These three tools complement the existing CLIENT-chip tab tools in
 * `chat-everywhere-tools.ts` (`mining.ui.pin_tab` / `reorder_tab` /
 * `remove_tab`), which emit a chip the FE store persists. The chip tools
 * stay as-is for FE-only reorder/pin affordances; these tools add the
 * durable per-tab spawn / augment / close / +N-badge operations the FE
 * could never guarantee on its own.
 *
 * Persona scope: T1 owner_strategist + T2 admin_strategist (the admin
 * dogfoods the same chat-driven cockpit so platform staff can roam across
 * tenants without leaving chat).
 *
 * Tools:
 *   - mining.ui.tabs.spawn   spawn or augment a tab (merge-context)
 *   - mining.ui.tabs.close   close (remove) a tab (pinned -> 409)
 *   - mining.ui.tabs.update  partial update (title, context, +N badge)
 *
 * All three are MEDIUM-stakes WRITE tools (isWrite=true). Provenance is
 * injected via `withChatProvenance` so the FE chip can deep-link back to
 * the originating chat turn.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

// ────────────────────────────────────────────────────────────────────
// 1) mining.ui.tabs.spawn — spawn or augment a tab
// ────────────────────────────────────────────────────────────────────

const SpawnInput = z
  .object({
    tabId: z.string().min(1).max(200),
    kind: z.string().min(1).max(80),
    title: z.string().min(1).max(200),
    context: z.record(z.string(), z.unknown()).optional(),
    /** When true, the spawned tab becomes the active tab. Defaults true. */
    setActive: z.boolean().optional().default(true),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const SpawnOutput = z
  .object({
    accepted: z.boolean(),
    tabId: z.string(),
    isNew: z.boolean(),
    updatedAt: z.string(),
  })
  .strict();

export const ownerTabsSpawnTool: PersonaToolDescriptor<
  typeof SpawnInput,
  typeof SpawnOutput
> = {
  id: 'mining.ui.tabs.spawn',
  name: 'Spawn or augment a tab in the owner cockpit',
  description:
    'Open a new tab in the owner cockpit tab strip (licence drawer, site ' +
    'panel, production case timeline, buyer 360, daily brief, etc.). If a ' +
    'tab with the same id already exists the call augments it in place ' +
    '(merges context, keeps the +N badge). Use when the conversation ' +
    "pivots to a specific entity (e.g. 'show me the Geita PML licence') " +
    'so the owner has it one click away on every device they are signed ' +
    'in on. The change persists server-side, so it survives a dropped ' +
    'chip, a different device, or a script.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: SpawnInput,
  outputSchema: SpawnOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        accepted: true,
        tabId: input.tabId,
        isNew: true,
        updatedAt: new Date().toISOString(),
      };
    }
    const tab: Record<string, unknown> = {
      id: input.tabId,
      kind: input.kind,
      title: input.title,
    };
    if (input.context !== undefined) tab.context = input.context;
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        tab,
        setActive: input.setActive ?? true,
        ...(input.reason && { reason: input.reason }),
      },
      ctx,
    );
    const res = await client.post<{
      tab?: { id?: string };
      isNew?: boolean;
      updatedAt?: string;
    }>('/owner/tabs', body);
    return {
      accepted: true,
      tabId: String(res.tab?.id ?? input.tabId),
      isNew: Boolean(res.isNew ?? false),
      updatedAt: String(res.updatedAt ?? new Date().toISOString()),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 2) mining.ui.tabs.close — close a tab
// ────────────────────────────────────────────────────────────────────

const CloseInput = z
  .object({
    tabId: z.string().min(1).max(200),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

const CloseOutput = z
  .object({
    accepted: z.boolean(),
    closedTabId: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const ownerTabsCloseTool: PersonaToolDescriptor<
  typeof CloseInput,
  typeof CloseOutput
> = {
  id: 'mining.ui.tabs.close',
  name: 'Close (remove) a tab in the owner cockpit',
  description:
    'Close a tab the owner is done with. Pinned tabs (Chat, Docs, core ' +
    'navigation) refuse close with a 409 — the owner has to unpin first. ' +
    'Use when the owner is finished with a licence, production case, or ' +
    'buyer panel.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: CloseInput,
  outputSchema: CloseOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        accepted: true,
        closedTabId: input.tabId,
        updatedAt: new Date().toISOString(),
      };
    }
    // The brain-tool loopback HTTP client exposes get/post only, so we drive
    // the close through the route's POST `/:id/close` alias rather than a
    // DELETE verb. Same auth + RLS + audit guards fire either way.
    const body = withChatProvenance(
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        operation: 'close',
        tabId: input.tabId,
        ...(input.reason && { reason: input.reason }),
      },
      ctx,
    );
    const res = await client.post<{
      closedTabId?: string;
      updatedAt?: string;
    }>(`/owner/tabs/${encodeURIComponent(input.tabId)}/close`, body);
    return {
      accepted: true,
      closedTabId: String(res.closedTabId ?? input.tabId),
      updatedAt: String(res.updatedAt ?? new Date().toISOString()),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 3) mining.ui.tabs.update — patch a tab (title, +N badge, context)
// ────────────────────────────────────────────────────────────────────

const UpdateInput = z
  .object({
    tabId: z.string().min(1).max(200),
    title: z.string().min(1).max(200).optional(),
    contextMerge: z.record(z.string(), z.unknown()).optional(),
    /** Set the +N badge count (e.g. after an augmentation burst). */
    pendingUpdates: z.number().int().nonnegative().max(999).optional(),
    /** ISO timestamp marker for the most recent augmentation. */
    augmentedAt: z.string().datetime().optional(),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.title !== undefined ||
      v.contextMerge !== undefined ||
      v.pendingUpdates !== undefined ||
      v.augmentedAt !== undefined,
    'at least one of title / contextMerge / pendingUpdates / augmentedAt is required',
  );

const UpdateOutput = z
  .object({
    accepted: z.boolean(),
    tabId: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const ownerTabsUpdateTool: PersonaToolDescriptor<
  typeof UpdateInput,
  typeof UpdateOutput
> = {
  id: 'mining.ui.tabs.update',
  name: 'Update a tab in the owner cockpit',
  description:
    'Partial update of a tab: rename, merge new context fields, set the ' +
    '+N badge count, or bump augmentedAt. Use when the brain has new data ' +
    "to surface on a tab the owner already has open ('I found 3 new " +
    "royalty shortfalls on this licence — adding them to the licence tab').",
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: UpdateInput,
  outputSchema: UpdateOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        accepted: true,
        tabId: input.tabId,
        updatedAt: new Date().toISOString(),
      };
    }
    const body: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      operation: 'update',
      tabId: input.tabId,
    };
    if (input.title !== undefined) body.title = input.title;
    if (input.contextMerge !== undefined) body.context = input.contextMerge;
    if (input.pendingUpdates !== undefined) {
      body.pendingUpdates = input.pendingUpdates;
    }
    if (input.augmentedAt !== undefined) body.augmentedAt = input.augmentedAt;
    if (input.reason !== undefined) body.reason = input.reason;
    const withProv = withChatProvenance(body, ctx);
    const res = await client.post<{
      tab?: { id?: string };
      updatedAt?: string;
    }>(`/owner/tabs/${encodeURIComponent(input.tabId)}/update`, withProv);
    return {
      accepted: true,
      tabId: String(res.tab?.id ?? input.tabId),
      updatedAt: String(res.updatedAt ?? new Date().toISOString()),
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// Catalog export — included by `buildPersonaToolHandlers` in index.ts.
// ────────────────────────────────────────────────────────────────────

export const OWNER_TABS_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  ownerTabsSpawnTool,
  ownerTabsCloseTool,
  ownerTabsUpdateTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
