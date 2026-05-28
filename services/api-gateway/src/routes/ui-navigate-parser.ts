/**
 * ui-navigate-parser — server-side extractor for the 6 Borjie
 * "superpower" SSE chip families that turn Mr. Mwikila from an answerer
 * into an actor:
 *
 *   <ui_navigate>   route the owner to a different tab / screen
 *   <ui_prefill>    fill a form for them from chat-derived values
 *   <ui_highlight>  guided callout on a specific UI element
 *   <ui_share>      generate a shareable / time-limited link
 *   <ui_bulk>       operate on many entities at once
 *   <ui_bookmark>   pin an entity to the owner's quick-access strip
 *
 * Mirrors the discipline of `board-element-parser.ts` and
 * `extractSpawnTabs`:
 *   - Runs inside `brain-teach.hono.ts` to strip the tags from the
 *     assistant body BEFORE the bubble streams, then emits the parsed
 *     chips as their own SSE events so the FE has a clean,
 *     pre-validated payload to render.
 *   - Caps total chips per turn (defensive — one chip per turn is the
 *     instructed pattern; the cap absorbs prompt drift without leaking
 *     a 10-chip flood into the bubble).
 *   - Malformed JSON or schema-fail entries are DROPPED silently — the
 *     tag is still removed from the body so the owner never sees raw
 *     XML.
 *   - First-match-wins on duplicate ids per family.
 *
 * Returned shape stays in lock-step with the FE handler in
 * `apps/owner-web/src/components/home-chat/HomeChatTeach.tsx` which
 * renders one chip per parsed entry beneath the assistant bubble.
 */

import { z } from 'zod';

// ─── Caps ──────────────────────────────────────────────────────────────
//
// The brain prompt instructs "emit ONE superpower chip per turn at
// most" — these caps absorb prompt drift without flooding the bubble.

const MAX_NAVIGATES_PER_TURN = 3;
const MAX_PREFILLS_PER_TURN = 3;
const MAX_HIGHLIGHTS_PER_TURN = 3;
const MAX_SHARES_PER_TURN = 3;
const MAX_BULKS_PER_TURN = 3;
const MAX_BOOKMARKS_PER_TURN = 3;

// ─── Bilingual primitive (sw/en, both required) ───────────────────────

const bilingual = z
  .object({
    en: z.string().min(1).max(400),
    sw: z.string().min(1).max(400),
  })
  .strict();

// ─── 1) ui_navigate ───────────────────────────────────────────────────

const navigateSchema = z
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
export type UiNavigateChip = z.infer<typeof navigateSchema>;

// ─── 2) ui_prefill ────────────────────────────────────────────────────

const prefillSchema = z
  .object({
    formId: z.string().min(1).max(120),
    values: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    submitOnAccept: z.boolean().optional().default(false),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();
export type UiPrefillChip = z.infer<typeof prefillSchema>;

// ─── 3) ui_highlight ──────────────────────────────────────────────────

const highlightSchema = z
  .object({
    selector: z.string().min(1).max(200),
    message: bilingual,
    ttl: z.number().int().min(1000).max(60_000).optional().default(8000),
    tone: z
      .enum(['info', 'success', 'warning', 'critical'])
      .optional()
      .default('info'),
  })
  .strict();
export type UiHighlightChip = z.infer<typeof highlightSchema>;

// ─── 4) ui_share ──────────────────────────────────────────────────────

const shareSchema = z
  .object({
    entityType: z
      .enum([
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
export type UiShareChip = z.infer<typeof shareSchema>;

// ─── 5) ui_bulk ───────────────────────────────────────────────────────

const bulkSchema = z
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
  .strict()
  .superRefine((val, ctx) => {
    // Whitelist matrix — defence in depth. Mirrors policy-gate.
    const allowed: Record<string, ReadonlyArray<string>> = {
      reminders: ['snooze'],
      tasks: ['complete'],
      incidents: ['acknowledge'],
      documents: ['archive'],
      bids: ['withdraw'],
    };
    const allowedActions = allowed[val.entityType] ?? [];
    if (!allowedActions.includes(val.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `action '${val.action}' not allowed on '${val.entityType}' — whitelist: ${allowedActions.join(',')}`,
        path: ['action'],
      });
    }
  });
export type UiBulkChip = z.infer<typeof bulkSchema>;

// ─── 6) ui_bookmark ───────────────────────────────────────────────────

const bookmarkSchema = z
  .object({
    entityType: z
      .enum([
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
export type UiBookmarkChip = z.infer<typeof bookmarkSchema>;

// ─── Tag patterns (kept simple — JSON-blob inside paired tag) ─────────

const TAG_NAVIGATE = /<ui_navigate>\s*(\{[\s\S]*?\})\s*<\/ui_navigate>/gi;
const TAG_PREFILL = /<ui_prefill>\s*(\{[\s\S]*?\})\s*<\/ui_prefill>/gi;
const TAG_HIGHLIGHT = /<ui_highlight>\s*(\{[\s\S]*?\})\s*<\/ui_highlight>/gi;
const TAG_SHARE = /<ui_share>\s*(\{[\s\S]*?\})\s*<\/ui_share>/gi;
const TAG_BULK = /<ui_bulk>\s*(\{[\s\S]*?\})\s*<\/ui_bulk>/gi;
const TAG_BOOKMARK = /<ui_bookmark>\s*(\{[\s\S]*?\})\s*<\/ui_bookmark>/gi;

// ─── Result shape ─────────────────────────────────────────────────────

export interface ParseSuperpowersResult {
  readonly body: string;
  readonly navigates: ReadonlyArray<UiNavigateChip>;
  readonly prefills: ReadonlyArray<UiPrefillChip>;
  readonly highlights: ReadonlyArray<UiHighlightChip>;
  readonly shares: ReadonlyArray<UiShareChip>;
  readonly bulks: ReadonlyArray<UiBulkChip>;
  readonly bookmarks: ReadonlyArray<UiBookmarkChip>;
  readonly dropped: number;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface ExtractStep<TSchema extends z.ZodTypeAny> {
  readonly pattern: RegExp;
  readonly schema: TSchema;
  readonly cap: number;
  readonly out: Array<z.infer<TSchema>>;
}

function applyStep<TSchema extends z.ZodTypeAny>(
  body: string,
  step: ExtractStep<TSchema>,
  droppedCounter: { value: number },
): string {
  return body.replace(step.pattern, (_match, json: string) => {
    if (step.out.length >= step.cap) {
      droppedCounter.value += 1;
      return '';
    }
    const parsed = safeJson(json);
    if (parsed === null || typeof parsed !== 'object') {
      droppedCounter.value += 1;
      return '';
    }
    const validated = step.schema.safeParse(parsed);
    if (!validated.success) {
      droppedCounter.value += 1;
      return '';
    }
    step.out.push(validated.data);
    return '';
  });
}

/**
 * Parse all six superpower chip families from one assistant body.
 * Always strips tags (even malformed ones) so the owner never sees raw
 * XML. Caller emits the returned arrays as SSE events.
 */
export function parseSuperpowers(text: string): ParseSuperpowersResult {
  const navigates: UiNavigateChip[] = [];
  const prefills: UiPrefillChip[] = [];
  const highlights: UiHighlightChip[] = [];
  const shares: UiShareChip[] = [];
  const bulks: UiBulkChip[] = [];
  const bookmarks: UiBookmarkChip[] = [];
  const dropped = { value: 0 };

  let body = text;
  body = applyStep(body, {
    pattern: TAG_NAVIGATE,
    schema: navigateSchema,
    cap: MAX_NAVIGATES_PER_TURN,
    out: navigates,
  }, dropped);
  body = applyStep(body, {
    pattern: TAG_PREFILL,
    schema: prefillSchema,
    cap: MAX_PREFILLS_PER_TURN,
    out: prefills,
  }, dropped);
  body = applyStep(body, {
    pattern: TAG_HIGHLIGHT,
    schema: highlightSchema,
    cap: MAX_HIGHLIGHTS_PER_TURN,
    out: highlights,
  }, dropped);
  body = applyStep(body, {
    pattern: TAG_SHARE,
    schema: shareSchema,
    cap: MAX_SHARES_PER_TURN,
    out: shares,
  }, dropped);
  body = applyStep(body, {
    pattern: TAG_BULK,
    schema: bulkSchema,
    cap: MAX_BULKS_PER_TURN,
    out: bulks,
  }, dropped);
  body = applyStep(body, {
    pattern: TAG_BOOKMARK,
    schema: bookmarkSchema,
    cap: MAX_BOOKMARKS_PER_TURN,
    out: bookmarks,
  }, dropped);

  return {
    body,
    navigates,
    prefills,
    highlights,
    shares,
    bulks,
    bookmarks,
    dropped: dropped.value,
  };
}

// ─── Public re-exports for FE schema parity ───────────────────────────

export {
  navigateSchema as uiNavigateSchema,
  prefillSchema as uiPrefillSchema,
  highlightSchema as uiHighlightSchema,
  shareSchema as uiShareSchema,
  bulkSchema as uiBulkSchema,
  bookmarkSchema as uiBookmarkSchema,
};
