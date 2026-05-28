/**
 * Inline UI blocks — INLINE-FIRST flow (Flow A).
 *
 * Wave OWNER-OS-INLINE-FIRST. The owner cockpit chat is inline-first
 * by DEFAULT: the brain renders the EXACT slice the conversation needs
 * INSIDE the chat bubble, not a full tab. The "jump to full tab" is an
 * escape hatch (Flow B), surfaced via the `tab_promotion_chip` only when
 * the slice has a richer view available.
 *
 * This module declares the six action-oriented block schemas that make
 * Flow A possible. They are siblings to the existing teaching blocks
 * (concept_card / metric_strip / decision_card / step_progress /
 * level_select / doc_quest) which are still valid for richer teaching
 * moments but are NO LONGER the default surface.
 *
 * Schemas:
 *   1. data_capture_card    — collect 1-3 fields from the owner inline
 *   2. confirmation_card    — high-stakes ask; supports auto-authorize
 *   3. file_request_card    — owner uploads a doc to proceed
 *   4. micro_action_card    — one-tap action (snooze, mark renewed, etc.)
 *   5. mini_metric          — single live KPI chip
 *   6. tab_promotion_chip   — the escape hatch to spawn the full tab
 *
 * Each block:
 *   - emits as a JSON object inside a <ui_block>{...}</ui_block> tag
 *   - is validated server-side via the discriminated union
 *   - is rendered by `apps/owner-web/src/components/home-chat/UiBlockRenderer.tsx`
 *
 * The parser (`parseInlineBlocks`) is multi-block aware (vs the existing
 * `extractUiBlock` in brain-teach.hono which only captures the first).
 * It returns the cleaned body plus every valid inline block in order.
 */

import { z } from 'zod';
import { ownerOsTabTypeSchema, ownerOsTabContextSchema } from './types.js';

// ─── Bilingual label helper ─────────────────────────────────────────

const bilingualLabelSchema = z.object({
  en: z.string().min(1).max(80),
  sw: z.string().min(1).max(80),
});

export type BilingualLabel = z.infer<typeof bilingualLabelSchema>;

// ─── 1. data_capture_card ───────────────────────────────────────────
//
// Collect 1-3 fields inline before the brain can act. The FE renders
// a compact form with the requested fields + a "Send" button. On submit
// the FE POSTs the captured object back via the next chat turn as a
// hidden `__data_capture_response` block that the brain treats as its
// next-turn input.

export const DATA_CAPTURE_FIELD_KINDS = [
  'text',
  'number',
  'date',
  'select',
  'pml-picker',
  'site-picker',
  'amount-tzs',
] as const;

const dataCaptureFieldSchema = z.object({
  key: z.string().min(1).max(40),
  label: bilingualLabelSchema,
  kind: z.enum(DATA_CAPTURE_FIELD_KINDS),
  options: z.array(z.string().min(1).max(60)).max(20).optional(),
  required: z.boolean().default(true),
  placeholder: z.string().min(1).max(120).optional(),
});

export const dataCaptureCardSchema = z.object({
  type: z.literal('data_capture_card'),
  purpose: z.string().min(1).max(120),
  fields: z.array(dataCaptureFieldSchema).min(1).max(3),
  submitAction: z.string().min(1).max(80),
});

export type DataCaptureCard = z.infer<typeof dataCaptureCardSchema>;

// ─── 2. confirmation_card ───────────────────────────────────────────
//
// High-stakes ask. If `autoAuthorized=true` the brain ALSO emits an
// <auto_authorized>{action,rationale}</auto_authorized> sibling tag and
// the FE renders the rationale without buttons. Otherwise the FE renders
// primary + secondary buttons and POSTs the chosen action to
// `/api/v1/owner/chat/confirm-action`.

const confirmationActionSchema = z.object({
  label: z.string().min(1).max(40),
  kind: z.enum(['destructive', 'primary', 'ghost']),
});

export const confirmationCardSchema = z.object({
  type: z.literal('confirmation_card'),
  question: z.string().min(1).max(200),
  summary: z.string().min(1).max(400),
  primaryAction: confirmationActionSchema,
  secondaryAction: confirmationActionSchema,
  autoAuthorized: z.boolean().default(false),
  rationale: z.string().min(1).max(300),
  /** Stable id for the proposed action; routed to a brain tool. */
  actionId: z.string().min(1).max(80).optional(),
  /** Optional payload the backend forwards to the matching brain tool. */
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type ConfirmationCard = z.infer<typeof confirmationCardSchema>;

// ─── 3. file_request_card ───────────────────────────────────────────
//
// Owner needs to upload a doc to proceed. Reuses the existing intake
// drop-zone scoped to `acceptedKinds`. The optional `jumpToTabType`
// fires the tab promotion path on click (so the owner can fall back to
// the full Docs tab if they want).

export const fileRequestCardSchema = z.object({
  type: z.literal('file_request_card'),
  whatFor: z.string().min(1).max(200),
  acceptedKinds: z.array(z.string().min(1).max(20)).min(1).max(10),
  maxSizeMb: z.number().int().min(1).max(50).default(10),
  jumpToTabType: ownerOsTabTypeSchema.optional(),
});

export type FileRequestCard = z.infer<typeof fileRequestCardSchema>;

// ─── 4. micro_action_card ───────────────────────────────────────────
//
// Single-tap action ("Mark renewed", "Snooze 24h", "Approve draft").
// One button. On click the FE POSTs `{action, payload}` to
// `/api/v1/owner/chat/micro-action` which routes to a brain tool.

export const microActionCardSchema = z.object({
  type: z.literal('micro_action_card'),
  label: bilingualLabelSchema,
  action: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type MicroActionCard = z.infer<typeof microActionCardSchema>;

// ─── 5. mini_metric ─────────────────────────────────────────────────
//
// Single live KPI inline. Compact one-line chip the renderer attaches
// inside the bubble body (NOT as the existing inline_metric pill).

export const miniMetricSchema = z.object({
  type: z.literal('mini_metric'),
  name: z.string().min(1).max(60),
  value: z.string().min(1).max(60),
  delta: z.string().min(1).max(40).optional(),
  tone: z.enum(['positive', 'neutral', 'warning']).default('neutral'),
  sparkline: z.array(z.number()).min(2).max(40).optional(),
});

export type MiniMetric = z.infer<typeof miniMetricSchema>;

// ─── 6. tab_promotion_chip ──────────────────────────────────────────
//
// The escape hatch. Renders as a tiny button beneath the inline content
// labeled "See full Geita compliance" (specific, never generic). Click
// triggers `useOwnerTabs().spawnOrAugment({kind, title, context})`.

export const tabPromotionChipSchema = z.object({
  type: z.literal('tab_promotion_chip'),
  tabType: ownerOsTabTypeSchema,
  context: ownerOsTabContextSchema.default({}),
  label: bilingualLabelSchema,
});

export type TabPromotionChip = z.infer<typeof tabPromotionChipSchema>;

// ─── Discriminated union of every inline block ──────────────────────

export const inlineBlockSchema = z.discriminatedUnion('type', [
  dataCaptureCardSchema,
  confirmationCardSchema,
  fileRequestCardSchema,
  microActionCardSchema,
  miniMetricSchema,
  tabPromotionChipSchema,
]);

export type InlineBlock = z.infer<typeof inlineBlockSchema>;

export const INLINE_BLOCK_TYPES: ReadonlyArray<InlineBlock['type']> = [
  'data_capture_card',
  'confirmation_card',
  'file_request_card',
  'micro_action_card',
  'mini_metric',
  'tab_promotion_chip',
];

// ─── Parser ─────────────────────────────────────────────────────────
//
// Multi-block: extracts EVERY valid inline <ui_block> in order, drops
// invalid / unknown-type blocks silently, returns the cleaned body.
//
// Capped at 8 inline blocks per response to keep render cost bounded.
// The brain prompt explicitly tells the model to emit at most 3-4 per
// turn, so 8 is a generous defensive ceiling.

const INLINE_BLOCK_TAG = /<ui_block>\s*(\{[\s\S]*?\})\s*<\/ui_block>/gi;
const MAX_INLINE_BLOCKS = 8;

export interface ParseInlineBlocksResult {
  readonly body: string;
  readonly blocks: ReadonlyArray<InlineBlock>;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isInlineBlockType(value: unknown): value is InlineBlock['type'] {
  return (
    typeof value === 'string' &&
    INLINE_BLOCK_TYPES.includes(value as InlineBlock['type'])
  );
}

/**
 * Parse every `<ui_block>` tag in the text. Returns the cleaned body
 * (tags stripped) plus an array of validated inline blocks in
 * document order. Blocks whose `type` does NOT match an inline schema
 * are LEFT IN PLACE (so the existing teaching renderer still gets to
 * extract them via its own `extractUiBlock`).
 *
 * Cap: 8 inline blocks per response. Extras are dropped silently.
 */
export function parseInlineBlocks(text: string): ParseInlineBlocksResult {
  const blocks: InlineBlock[] = [];
  // Track which raw matches were inline so we can strip them from the body.
  const stripMatches: string[] = [];

  // Reset lastIndex defensively in case the regex was used elsewhere.
  INLINE_BLOCK_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_BLOCK_TAG.exec(text)) !== null) {
    if (blocks.length >= MAX_INLINE_BLOCKS) break;
    const raw = match[0];
    const json = match[1] ?? '';
    const parsed = safeParseJson(json);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !isInlineBlockType((parsed as { type?: unknown }).type)
    ) {
      continue;
    }
    const validation = inlineBlockSchema.safeParse(parsed);
    if (!validation.success) continue;
    blocks.push(validation.data);
    stripMatches.push(raw);
  }

  let body = text;
  for (const raw of stripMatches) {
    body = body.replace(raw, '');
  }

  return { body, blocks };
}

// ─── auto_authorized companion tag ──────────────────────────────────
//
// When a confirmation_card has `autoAuthorized: true`, the brain ALSO
// emits an <auto_authorized>{action, rationale}</auto_authorized> tag
// that the BACKEND uses to immediately execute the action and write an
// audit row. The FE renders the rationale without buttons.

const autoAuthorizedSchema = z.object({
  action: z.string().min(1).max(80),
  rationale: z.string().min(1).max(300),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type AutoAuthorized = z.infer<typeof autoAuthorizedSchema>;

const AUTO_AUTHORIZED_TAG =
  /<auto_authorized>\s*(\{[\s\S]*?\})\s*<\/auto_authorized>/i;

export interface ExtractAutoAuthorizedResult {
  readonly body: string;
  readonly autoAuthorized: AutoAuthorized | null;
}

/**
 * Strip the single `<auto_authorized>` tag from the body. Returns the
 * parsed payload (or null) plus the cleaned body. Only the first tag
 * is honoured.
 */
export function extractAutoAuthorized(
  text: string,
): ExtractAutoAuthorizedResult {
  let autoAuthorized: AutoAuthorized | null = null;
  const body = text.replace(AUTO_AUTHORIZED_TAG, (_m, json: string) => {
    if (autoAuthorized) return '';
    const parsed = safeParseJson(json);
    if (!parsed) return '';
    const validation = autoAuthorizedSchema.safeParse(parsed);
    if (validation.success) autoAuthorized = validation.data;
    return '';
  });
  return { body, autoAuthorized };
}
