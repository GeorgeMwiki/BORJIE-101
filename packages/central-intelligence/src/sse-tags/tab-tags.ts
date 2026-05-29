/**
 * Brain SSE tab-tags protocol (CT-1).
 *
 * Four discrete XML-like tags Mr. Mwikila streams inline with chat text
 * so the owner-cockpit can spawn / update / remove / propose tabs in
 * real time, fully driven from natural-language conversation:
 *
 *   <tab_spawn    type="..." title="..." config='{...}' />
 *   <tab_update   id="..." config='{...}' title="..." />
 *   <tab_remove   id="..." />
 *   <tab_proposal title="..." type="..." reason="..."
 *                 reasonSw="..." evidenceIds='["..."]' />
 *
 * Why XML self-closing tags inline with text instead of JSON tool calls?
 *   - The owner sees a single, fluent reply (no tool-call latency hop).
 *   - The brain teach prompt is shorter (one DSL, not three).
 *   - The parser is incremental — the FE could stream-render before the
 *     full reply lands (we don't yet, but the protocol allows it).
 *   - Mirrors `<spawn_tabs>` / `<chat_handoff>` / `<ui_navigate>` —
 *     consistent with every other Borjie chat-driven primitive.
 *
 * Validation is strict:
 *   - `type` ∈ OWNER_OS_TAB_TYPES (33 today) — unknown types dropped + warned.
 *   - `config` is JSON; per-type schema validation happens at the gateway
 *     boundary (this module accepts arbitrary records — the gateway
 *     decides if a `mineralKind: "platinum"` is valid for `compliance`).
 *   - `title` capped at 60 chars (the tab strip's render budget).
 *   - `reason` capped at 200 chars; `evidenceIds` capped at 5 ids.
 *
 * Audit hooks fire at the gateway layer — this is a PURE parser + zod
 * contract. No I/O, no logging, no side-effects.
 *
 * Tests: `__tests__/tab-tags.test.ts` — 6 cases covering happy path,
 * malformed JSON, unknown type, duplicate tags, length caps, sw/en
 * bilingual reason.
 */

import { z } from 'zod';

import { OWNER_OS_TAB_TYPES } from '@borjie/owner-os-tabs';

// ─── Public schemas ─────────────────────────────────────────────────

export const tabTagsTypeSchema = z.enum(OWNER_OS_TAB_TYPES);

/**
 * Free-form per-type config. The gateway re-validates against each
 * tab type's own schema (see `tab-config-validator.ts`) — this layer
 * only ensures the value is a JSON object, not an array or scalar.
 */
const configRecordSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => !Array.isArray(v), {
    message: 'config must be an object, not an array',
  });

/**
 * `<tab_spawn>` — async create of a fresh tab. Idempotent: re-emitting
 * the same `(type, scoping-context)` resolves to the same tab id via
 * the owner-tabs-store deterministic-id builder.
 */
export const tabSpawnSchema = z.object({
  kind: z.literal('tab_spawn'),
  type: tabTagsTypeSchema,
  title: z.string().min(1).max(60),
  /** Bilingual title — overrides `title` per locale when present. */
  titleEn: z.string().min(1).max(60).optional(),
  titleSw: z.string().min(1).max(60).optional(),
  config: configRecordSchema.default({}),
});
export type TabSpawnTag = z.infer<typeof tabSpawnSchema>;

/**
 * `<tab_update>` — partial PATCH of an existing tab's config or title.
 * `id` is the persisted tab id (the FE store's deterministic id).
 */
export const tabUpdateSchema = z.object({
  kind: z.literal('tab_update'),
  id: z.string().min(1).max(160),
  config: configRecordSchema.optional(),
  title: z.string().min(1).max(60).optional(),
  titleEn: z.string().min(1).max(60).optional(),
  titleSw: z.string().min(1).max(60).optional(),
});
export type TabUpdateTag = z.infer<typeof tabUpdateSchema>;

/**
 * `<tab_remove>` — soft-close. The FE store removes the tab from the
 * strip; if the tab is pinned the route layer rejects with a code.
 */
export const tabRemoveSchema = z.object({
  kind: z.literal('tab_remove'),
  id: z.string().min(1).max(160),
});
export type TabRemoveTag = z.infer<typeof tabRemoveSchema>;

/**
 * `<tab_proposal>` — proactive, evidence-cited recommendation. Renders
 * as an accept/dismiss chip in the chat reply. Acceptance binds to
 * `POST /api/v1/owner/tabs`; dismissal hits the suggester inbox so
 * the same proposal does not re-surface for N days.
 */
export const tabProposalSchema = z.object({
  kind: z.literal('tab_proposal'),
  type: tabTagsTypeSchema,
  title: z.string().min(1).max(60),
  titleEn: z.string().min(1).max(60).optional(),
  titleSw: z.string().min(1).max(60).optional(),
  /** EN reason shown when the owner's locale is EN. */
  reason: z.string().min(1).max(200),
  /** SW reason — falls back to `reason` when missing (with a warn). */
  reasonSw: z.string().min(1).max(200).optional(),
  /**
   * Evidence ids — LMBM observation ids, decision ids, ui_navigate
   * trail ids, mwikila_action ids, etc. Per CLAUDE.md grounding rule
   * every proposal MUST carry ≥1 id, else the gateway drops it +
   * Pino-warns about the brain hallucinating.
   */
  evidenceIds: z.array(z.string().min(1).max(120)).min(1).max(5),
  config: configRecordSchema.default({}),
  /**
   * Confidence 0..1. The chip renders a "high / medium" pip from it.
   * Coerced because XML attribute values are always strings on the wire.
   */
  confidence: z.coerce.number().min(0).max(1).optional(),
});
export type TabProposalTag = z.infer<typeof tabProposalSchema>;

/** Discriminated union — every parsed tag has a `kind` field. */
export const tabTagSchema = z.discriminatedUnion('kind', [
  tabSpawnSchema,
  tabUpdateSchema,
  tabRemoveSchema,
  tabProposalSchema,
]);
export type TabTag = z.infer<typeof tabTagSchema>;

// ─── XML attribute parser ───────────────────────────────────────────
//
// We deliberately roll our own micro-parser — full XML libraries pull
// in megabytes for a self-closing-attribute use case. The DSL accepts:
//
//   <tab_spawn type="x" title="y" config='{"a":1}' />
//   <tab_spawn type='x' title='y' />
//   <tab_remove id="abc" />
//
// Quote styles are interchangeable (single or double); whitespace
// inside attribute values is preserved; the JSON in `config` is
// surface-decoded (no entity escaping is performed — the brain emits
// raw JSON inside single quotes by convention).

const TAG_NAMES = ['tab_spawn', 'tab_update', 'tab_remove', 'tab_proposal'] as const;
type TagName = (typeof TAG_NAMES)[number];

const TAG_PATTERN = new RegExp(
  `<(${TAG_NAMES.join('|')})\\s+([^>]*?)/>`,
  'gi',
);

const ATTR_PATTERN = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

interface RawAttrs {
  readonly [key: string]: string;
}

function parseAttrs(raw: string): RawAttrs {
  const out: Record<string, string> = {};
  ATTR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_PATTERN.exec(raw)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : '';
    out[key] = value;
  }
  return out;
}

function safeParseJson(raw: string | undefined): unknown {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Sentinel signalling "the brain emitted this attribute but the JSON
 * was malformed". Letting it through as `undefined` would silently
 * apply the schema default, masking the hallucination from the eval
 * loop. We instead inject an obviously-wrong shape so zod records a
 * crisp issue + the gateway logs it.
 */
const MALFORMED_JSON_SENTINEL = Symbol('malformed-json');

function attrsToCandidate(tagName: TagName, attrs: RawAttrs): unknown {
  const base: Record<string, unknown> = { kind: tagName };
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'config' || key === 'evidenceIds') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        // empty quotes — leave the key off; schema default kicks in.
        continue;
      }
      const parsed = safeParseJson(value);
      if (parsed === null) {
        // Malformed JSON — surface as a sentinel object zod will reject.
        // The dropped diagnostic carries the original raw payload so
        // the gateway / eval loop can pinpoint the broken brain emit.
        base[key] = MALFORMED_JSON_SENTINEL;
      } else {
        base[key] = parsed;
      }
    } else {
      base[key] = value;
    }
  }
  return base;
}

// ─── Public extractor ───────────────────────────────────────────────

export interface ExtractTabTagsResult {
  /** The reply text with every recognised tag removed. */
  readonly body: string;
  /** Successfully parsed + validated tags in emission order. */
  readonly tags: ReadonlyArray<TabTag>;
  /**
   * Diagnostics — tags that matched the surface pattern but failed
   * schema validation. The gateway logs these via Pino.warn so the
   * eval loop can fine-tune the brain teach prompt.
   */
  readonly dropped: ReadonlyArray<{
    readonly tagName: TagName;
    readonly raw: string;
    readonly reason: string;
  }>;
}

/**
 * Strip every recognised tab tag from the brain reply and return the
 * validated payloads. Mirrors the `extractSpawnTabs` API style so the
 * gateway can pipe the result into the same SSE event scaffold.
 *
 * Never throws — returns `dropped` entries for any malformed tag.
 */
export function extractTabTags(text: string): ExtractTabTagsResult {
  const tags: TabTag[] = [];
  const dropped: ExtractTabTagsResult['dropped'][number][] = [];
  let body = text;

  body = body.replace(TAG_PATTERN, (raw, name: string, attrBlob: string) => {
    const tagName = name.toLowerCase() as TagName;
    const attrs = parseAttrs(attrBlob);
    const candidate = attrsToCandidate(tagName, attrs);
    const parsed = tabTagSchema.safeParse(candidate);
    if (parsed.success) {
      tags.push(parsed.data);
    } else {
      dropped.push({
        tagName,
        raw,
        reason: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
    }
    return '';
  });

  // Strip any orphan opening tags the brain may have left if it forgot
  // the self-close — keeps the body clean of leaked DSL fragments.
  body = body.replace(
    new RegExp(`<\\/?(${TAG_NAMES.join('|')})(\\s[^>]*)?>`, 'gi'),
    '',
  );

  return { body, tags, dropped };
}

// ─── Helpers used by the gateway layer ──────────────────────────────

export function isTabSpawn(tag: TabTag): tag is TabSpawnTag {
  return tag.kind === 'tab_spawn';
}
export function isTabUpdate(tag: TabTag): tag is TabUpdateTag {
  return tag.kind === 'tab_update';
}
export function isTabRemove(tag: TabTag): tag is TabRemoveTag {
  return tag.kind === 'tab_remove';
}
export function isTabProposal(tag: TabTag): tag is TabProposalTag {
  return tag.kind === 'tab_proposal';
}

/**
 * Pick the best title for a target locale. Falls back through:
 *   1. titleSw / titleEn  (locale-specific overrides)
 *   2. title              (default)
 *
 * Used by the FE store + the chip renderer when promoting a proposal.
 */
export function pickTagTitle(
  tag: { readonly title: string; readonly titleEn?: string; readonly titleSw?: string },
  locale: 'sw' | 'en',
): string {
  if (locale === 'sw' && tag.titleSw) return tag.titleSw;
  if (locale === 'en' && tag.titleEn) return tag.titleEn;
  return tag.title;
}

/** Same fallback policy for the proposal reason copy. */
export function pickProposalReason(tag: TabProposalTag, locale: 'sw' | 'en'): string {
  if (locale === 'sw' && tag.reasonSw) return tag.reasonSw;
  return tag.reason;
}
