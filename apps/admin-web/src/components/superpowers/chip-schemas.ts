/**
 * Wave SUPERPOWERS — admin-side chip wire schemas.
 *
 * Mirrors the owner-web schemas in
 * `apps/owner-web/src/components/home-chat/SuperpowerChips.tsx` so the
 * brain can emit the same SSE event shapes for both surfaces. Admin
 * widens the bulk whitelist (suspend_tenant_org, export_regulator_pack,
 * etc) — see services/api-gateway/src/routes/admin/superpowers.hono.ts.
 *
 * Five families share the owner schemas verbatim; only the bulk schema
 * differs (admin entity types + admin actions).
 */

import { z } from 'zod';

// ─── Shared bilingual primitive (sw/en) ─────────────────────────────

const bilingual = z
  .object({ en: z.string().min(1), sw: z.string().min(1) })
  .strict();

// ─── ui_navigate — admin navigation route + scope ──────────────────

export const uiNavigateChipSchema = z
  .object({
    route: z.string().regex(/^\//),
    scopeIds: z.array(z.string()).optional(),
    focus: z.string().optional(),
    ttl: z.number().int().optional(),
    reason: z.string().min(1),
  })
  .strict();
export type UiNavigateChip = z.infer<typeof uiNavigateChipSchema>;

// ─── ui_prefill — form prefill values + dispatch event payload ──────

export const uiPrefillChipSchema = z
  .object({
    formId: z.string().min(1),
    values: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    submitOnAccept: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict();
export type UiPrefillChip = z.infer<typeof uiPrefillChipSchema>;

// ─── ui_highlight — selector + bilingual message + tone ─────────────

export const uiHighlightChipSchema = z
  .object({
    selector: z.string().min(1),
    message: bilingual,
    ttl: z.number().int().optional(),
    tone: z.enum(['info', 'success', 'warning', 'critical']).optional(),
  })
  .strict();
export type UiHighlightChip = z.infer<typeof uiHighlightChipSchema>;

// ─── ui_share — share-link creation ────────────────────────────────

export const uiShareChipSchema = z
  .object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    recipients: z.array(z.string().email()).optional(),
    expiresInHours: z.number().int(),
    permission: z.enum(['read', 'comment', 'edit']),
    reason: z.string().optional(),
  })
  .strict();
export type UiShareChip = z.infer<typeof uiShareChipSchema>;

// ─── ui_bulk — admin whitelist (distinct from owner) ───────────────

export const ADMIN_BULK_ENTITY_TYPES = [
  'tenant_orgs',
  'intelligence_corpus',
  'feature_flags',
  'killswitch_targets',
] as const;

export const ADMIN_BULK_ACTIONS = [
  'suspend',
  'reactivate',
  'export_regulator_pack',
  'archive',
  'reindex',
  'enable',
  'disable',
  'activate',
] as const;

export const HIGH_IMPACT_ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  'suspend',
  'reactivate',
  'activate',
  'export_regulator_pack',
]);

export const uiBulkChipSchema = z
  .object({
    entityType: z.enum(ADMIN_BULK_ENTITY_TYPES),
    ids: z.array(z.string()).min(1).max(100),
    action: z.enum(ADMIN_BULK_ACTIONS),
    payload: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().min(8),
  })
  .strict();
export type UiBulkChip = z.infer<typeof uiBulkChipSchema>;

// ─── ui_bookmark — pin an entity to the admin quick-access strip ───

export const uiBookmarkChipSchema = z
  .object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    label: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();
export type UiBookmarkChip = z.infer<typeof uiBookmarkChipSchema>;
