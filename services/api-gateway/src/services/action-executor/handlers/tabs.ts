/**
 * manage_tab — a CONFIRM-REQUIRED, SERVER-PERSISTED structural tab verb.
 *
 * Promotes the owner cockpit tab strip from FE-chip-only to a DURABLE store. The
 * brain tools `mining.ui.pin_tab` / `reorder_tab` / `remove_tab`
 * (services/api-gateway/src/composition/brain-tools/chat-everywhere-tools.ts)
 * historically only emitted a chip the FE store persisted via PUT /owner/tabs —
 * so a tab op vanished if no FE was listening (a different device, a script, a
 * dropped chip). This verb writes the structural store directly
 * (`owner_tabs_structural`, migration 0169) — one row per (tenant, user, tab_id)
 * — so spawn / update / remove / reorder / pin PERSIST server-side. The FE chip
 * becomes a thin echo of a real server write.
 *
 * Five ops (the `op` discriminator):
 *   spawn    — create a new custom tab (idempotent on tab_id; re-activates a
 *              previously-removed tab instead of erroring).
 *   update   — patch a tab's label / config.
 *   remove   — SOFT-delete (status → 'removed'); 'system' tabs are protected.
 *   reorder  — set a tab's zero-based position.
 *   pin      — pin / unpin a tab (pinned tabs sort ahead in the FE).
 *
 * This verb NEVER auto-executes. Registered `autoSafe:false` (registry.ts) so the
 * brain-teach auto-execute path and `/micro-action` both refuse it; ONLY
 * `/confirm-action` (after the owner explicitly confirmed) reaches it, after the
 * fail-closed `decideAutoAuthorization` gate authorizes it.
 *
 * MONEY BOUNDARY (CLAUDE.md hard rule): `owner_tabs_structural` is pure UI
 * structure — NO money column. This handler imports NO LedgerService and writes
 * NO ledger/journal row.
 *
 * TENANT SCOPING: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so RLS clips every write to the caller's tenant. We
 * ALSO predicate every read/UPDATE on `tenant_id = ctx.tenantId AND user_id =
 * ctx.userId` (belt-and-braces per CLAUDE.md) — a tab strip is per-owner, so a
 * cross-tenant / cross-user tab_id matches zero rows and the op fails precisely
 * (`manage_tab_not_found`).
 *
 * Every successful op appends a hash-chained `ai_audit_chain` entry via
 * `appendExecAudit` (action `owner.tab.<op>`).
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ownerTabsStructural } from '@borjie/database';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

// ─── Schemas (discriminated by `op`) ─────────────────────────────────

const tabIdField = z.string().trim().min(1).max(120);

const spawnSchema = z.object({
  op: z.literal('spawn'),
  /** Stable tab id; generated when omitted. */
  tabId: tabIdField.optional(),
  label: z.string().trim().min(1).max(200),
  position: z.number().int().min(0).max(50).optional(),
  pinned: z.boolean().optional(),
  /** Flexible per-tab options bag (query/filters). NEVER money. */
  config: z.record(z.string(), z.unknown()).optional(),
});

// NOTE: no `.refine()` here — z.discriminatedUnion rejects a ZodEffects member.
// The "at least one of label/config" rule is enforced in updateTab() instead.
const updateSchema = z.object({
  op: z.literal('update'),
  tabId: tabIdField,
  label: z.string().trim().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const removeSchema = z.object({
  op: z.literal('remove'),
  tabId: tabIdField,
});

const reorderSchema = z.object({
  op: z.literal('reorder'),
  tabId: tabIdField,
  position: z.number().int().min(0).max(50),
});

const pinSchema = z.object({
  op: z.literal('pin'),
  tabId: tabIdField,
  /** TRUE to pin (default), FALSE to unpin. */
  pinned: z.boolean().optional(),
});

const manageTabSchema = z.discriminatedUnion('op', [
  spawnSchema,
  updateSchema,
  removeSchema,
  reorderSchema,
  pinSchema,
]);

type ManageTabInput = z.infer<typeof manageTabSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Fetch the tenant+user's row for a tab_id (or undefined). */
async function findTab(ctx: ExecContext, tabId: string) {
  const rows = await ctx.db
    .select({
      id: ownerTabsStructural.id,
      tabId: ownerTabsStructural.tabId,
      label: ownerTabsStructural.label,
      kind: ownerTabsStructural.kind,
      status: ownerTabsStructural.status,
      config: ownerTabsStructural.config,
    })
    .from(ownerTabsStructural)
    .where(
      and(
        eq(ownerTabsStructural.tenantId, ctx.tenantId),
        eq(ownerTabsStructural.userId, ctx.userId),
        eq(ownerTabsStructural.tabId, tabId),
      ),
    )
    .limit(1);
  return rows[0];
}

function chatProvenance(ctx: ExecContext) {
  return {
    via: 'chat' as const,
    actorId: ctx.userId,
    requestedAt: new Date().toISOString(),
  };
}

// ─── Op handlers ─────────────────────────────────────────────────────

async function spawnTab(
  ctx: ExecContext,
  input: z.infer<typeof spawnSchema>,
): Promise<ExecResult> {
  const tabId = input.tabId ?? `tab-${randomUUID().slice(0, 8)}`;

  // Idempotent: if the tab id already exists, re-activate + relabel it instead
  // of failing the UNIQUE(tenant,user,tab_id) index.
  const existing = await findTab(ctx, tabId);
  if (existing) {
    const reactivated = await ctx.db
      .update(ownerTabsStructural)
      .set({
        label: input.label,
        status: 'active',
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.config !== undefined ? { config: input.config } : {}),
        provenance: chatProvenance(ctx),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ownerTabsStructural.tenantId, ctx.tenantId),
          eq(ownerTabsStructural.userId, ctx.userId),
          eq(ownerTabsStructural.tabId, tabId),
        ),
      )
      .returning({ id: ownerTabsStructural.id, tabId: ownerTabsStructural.tabId });
    const row = reactivated[0];
    if (!row) {
      throw new Error(`manage_tab_not_found:${tabId}`);
    }
    return {
      kind: 'owner_tab',
      id: String(row.id),
      summary: `Tab "${input.label}" re-added`,
      data: { tabId, op: 'spawn', reactivated: true },
    };
  }

  const id = randomUUID();
  const inserted = await ctx.db
    .insert(ownerTabsStructural)
    .values({
      id,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      tabId,
      label: input.label,
      position: input.position ?? 0,
      pinned: input.pinned ?? false,
      kind: 'custom',
      config: input.config ?? {},
      status: 'active',
      provenance: chatProvenance(ctx),
    })
    .returning({ id: ownerTabsStructural.id, tabId: ownerTabsStructural.tabId });

  const row = inserted[0];
  if (!row) {
    throw new Error('manage_tab spawn returned no row');
  }
  return {
    kind: 'owner_tab',
    id: String(row.id),
    summary: `Tab "${input.label}" added`,
    data: { tabId, op: 'spawn' },
  };
}

async function updateTab(
  ctx: ExecContext,
  input: z.infer<typeof updateSchema>,
): Promise<ExecResult> {
  if (input.label === undefined && input.config === undefined) {
    throw new Error('manage_tab_update_requires_label_or_config');
  }
  const updated = await ctx.db
    .update(ownerTabsStructural)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.config !== undefined ? { config: input.config } : {}),
      provenance: chatProvenance(ctx),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ownerTabsStructural.tenantId, ctx.tenantId),
        eq(ownerTabsStructural.userId, ctx.userId),
        eq(ownerTabsStructural.tabId, input.tabId),
      ),
    )
    .returning({ id: ownerTabsStructural.id, label: ownerTabsStructural.label });
  const row = updated[0];
  if (!row) {
    throw new Error(`manage_tab_not_found:${input.tabId}`);
  }
  return {
    kind: 'owner_tab',
    id: String(row.id),
    summary: `Tab "${String(row.label)}" updated`,
    data: { tabId: input.tabId, op: 'update' },
  };
}

async function removeTab(
  ctx: ExecContext,
  input: z.infer<typeof removeSchema>,
): Promise<ExecResult> {
  // System tabs (Chat / Cockpit) cannot be removed — guard server-side so a
  // dropped FE guard can never delete one.
  const existing = await findTab(ctx, input.tabId);
  if (!existing) {
    throw new Error(`manage_tab_not_found:${input.tabId}`);
  }
  if (String(existing.kind) === 'system') {
    throw new Error(`manage_tab_system_tab_protected:${input.tabId}`);
  }

  // SOFT-delete: status → 'removed' (the row survives for undo/audit).
  const updated = await ctx.db
    .update(ownerTabsStructural)
    .set({ status: 'removed', provenance: chatProvenance(ctx), updatedAt: new Date() })
    .where(
      and(
        eq(ownerTabsStructural.tenantId, ctx.tenantId),
        eq(ownerTabsStructural.userId, ctx.userId),
        eq(ownerTabsStructural.tabId, input.tabId),
      ),
    )
    .returning({ id: ownerTabsStructural.id, label: ownerTabsStructural.label, status: ownerTabsStructural.status });
  const row = updated[0];
  if (!row) {
    throw new Error(`manage_tab_not_found:${input.tabId}`);
  }
  return {
    kind: 'owner_tab',
    id: String(row.id),
    summary: `Tab "${String(row.label)}" removed`,
    data: { tabId: input.tabId, op: 'remove', status: String(row.status) },
  };
}

async function reorderTab(
  ctx: ExecContext,
  input: z.infer<typeof reorderSchema>,
): Promise<ExecResult> {
  const updated = await ctx.db
    .update(ownerTabsStructural)
    .set({ position: input.position, provenance: chatProvenance(ctx), updatedAt: new Date() })
    .where(
      and(
        eq(ownerTabsStructural.tenantId, ctx.tenantId),
        eq(ownerTabsStructural.userId, ctx.userId),
        eq(ownerTabsStructural.tabId, input.tabId),
      ),
    )
    .returning({ id: ownerTabsStructural.id, position: ownerTabsStructural.position });
  const row = updated[0];
  if (!row) {
    throw new Error(`manage_tab_not_found:${input.tabId}`);
  }
  return {
    kind: 'owner_tab',
    id: String(row.id),
    summary: `Tab moved to position ${input.position}`,
    data: { tabId: input.tabId, op: 'reorder', position: input.position },
  };
}

async function pinTab(
  ctx: ExecContext,
  input: z.infer<typeof pinSchema>,
): Promise<ExecResult> {
  const pinned = input.pinned ?? true;
  const updated = await ctx.db
    .update(ownerTabsStructural)
    .set({ pinned, provenance: chatProvenance(ctx), updatedAt: new Date() })
    .where(
      and(
        eq(ownerTabsStructural.tenantId, ctx.tenantId),
        eq(ownerTabsStructural.userId, ctx.userId),
        eq(ownerTabsStructural.tabId, input.tabId),
      ),
    )
    .returning({ id: ownerTabsStructural.id, pinned: ownerTabsStructural.pinned });
  const row = updated[0];
  if (!row) {
    throw new Error(`manage_tab_not_found:${input.tabId}`);
  }
  return {
    kind: 'owner_tab',
    id: String(row.id),
    summary: pinned ? 'Tab pinned' : 'Tab unpinned',
    data: { tabId: input.tabId, op: 'pin', pinned },
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────

export const manageTabHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input: ManageTabInput = manageTabSchema.parse(rawInput);

  const result =
    input.op === 'spawn'
      ? await spawnTab(ctx, input)
      : input.op === 'update'
        ? await updateTab(ctx, input)
        : input.op === 'remove'
          ? await removeTab(ctx, input)
          : input.op === 'reorder'
            ? await reorderTab(ctx, input)
            : await pinTab(ctx, input);

  await appendExecAudit(ctx, {
    action: `owner.tab.${input.op}`,
    turnId: result.id ?? input.tabId ?? 'tab',
    details: {
      ...result.data,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    {
      executor: 'manage_tab',
      tenantId: ctx.tenantId,
      op: input.op,
      tabId: result.data?.tabId,
    },
    'action-executor: tab structural op persisted',
  );

  return result;
};
