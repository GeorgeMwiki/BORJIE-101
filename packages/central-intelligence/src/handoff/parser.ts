/**
 * parseChatHandoffs — strip `<chat_handoff .../>` tags from the brain's
 * reply, validate each payload against the handoff zod schema, and
 * return the cleaned body + parsed handoffs.
 *
 * Mirrors the established `parseBoardElements` / `parseSuperpowers`
 * style so the brain-teach SSE pipeline can extract handoffs in the
 * same pass it already extracts board elements + UI chips.
 *
 * Defensive policy (parity with the rest of the parser family):
 *
 *  - Caps at 6 handoffs per turn (the LLM should rarely emit more than
 *    one or two — 6 is a generous ceiling against runaway prompts).
 *  - Drops any tag that fails the discriminated-union zod schema.
 *  - Strips the tag from the body either way (so the source chat
 *    bubble never shows raw XML to Mr. Mwikila).
 *  - First-match wins on duplicate target_user_id within one reply
 *    (the recorder also de-dupes, but this keeps the FE chip count
 *    sane).
 *
 * Tag shape (XML-style self-closing, attributes-only — no JSON body
 * because the brain LLM tends to emit unbalanced JSON when nested
 * inside other primitives):
 *
 *   <chat_handoff
 *     target_user_id="user_abc"
 *     target_role="T3_module_manager"
 *     topic="Mwadui site safety follow-up"
 *     site_ids="mwadui,buzwagi"
 *     category="safety"
 *   />
 *
 * Optional attributes (all space-separated lists):
 *   site_ids       comma-separated string of site ids
 *   entity_kind    a single entity kind ("incident", "drill_hole")
 *   entity_id      the entity id when entity_kind is set
 *   category       free-form short string ("safety", "production")
 *   source_turn_id originating brain turn id (for reply-card lookup)
 *
 * Defence-in-depth: no `eval`, no JSON parsing — only the regex split
 * on `=` + the zod validator. The brain cannot smuggle arbitrary code
 * through a `chat_handoff` tag.
 */

import { z } from 'zod';
import { HANDOFF_PERSONA_ROLES } from './types.js';
import type { HandoffPersonaRole, HandoffScopePayload } from './types.js';

const TAG_PATTERN = /<chat_handoff\s+([^/>]*)\/>/gi;
const ATTR_PATTERN = /([a-z_][a-z0-9_]*)\s*=\s*"([^"]*)"/gi;
const MAX_HANDOFFS_PER_TURN = 6;

// Attribute schema — every value arrives as a string from the regex.
// The validator coerces to the typed `ParsedChatHandoff` shape.
const RawAttrSchema = z
  .object({
    target_user_id: z.string().min(1).max(120),
    target_role: z.enum(HANDOFF_PERSONA_ROLES),
    topic: z.string().min(1).max(400),
    site_ids: z.string().max(400).optional(),
    entity_kind: z.string().min(1).max(80).optional(),
    entity_id: z.string().min(1).max(120).optional(),
    category: z.string().min(1).max(80).optional(),
    source_turn_id: z.string().min(1).max(120).optional(),
  })
  .strict();

export interface ParsedChatHandoff {
  readonly targetUserId: string;
  readonly targetRole: HandoffPersonaRole;
  readonly topic: string;
  readonly scopePayload: HandoffScopePayload;
}

export interface ParseChatHandoffsResult {
  readonly body: string;
  readonly handoffs: ReadonlyArray<ParsedChatHandoff>;
  readonly dropped: number;
}

function extractAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let match: RegExpExecArray | null;
  // Reset for global regex reuse.
  ATTR_PATTERN.lastIndex = 0;
  while ((match = ATTR_PATTERN.exec(raw)) !== null) {
    const [, key, value] = match;
    if (typeof key === 'string' && typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

function buildScope(attrs: z.infer<typeof RawAttrSchema>): HandoffScopePayload {
  const scope: Record<string, unknown> = {};
  if (typeof attrs.site_ids === 'string' && attrs.site_ids.length > 0) {
    const siteIds = Object.freeze(
      attrs.site_ids
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 80),
    );
    scope['siteIds'] = siteIds;
  }
  if (attrs.category) scope['category'] = attrs.category;
  if (attrs.entity_kind) scope['entityKind'] = attrs.entity_kind;
  if (attrs.entity_id) scope['entityId'] = attrs.entity_id;
  if (attrs.source_turn_id) scope['sourceTurnId'] = attrs.source_turn_id;
  return Object.freeze(scope as HandoffScopePayload);
}

export function parseChatHandoffs(text: string): ParseChatHandoffsResult {
  const handoffs: ParsedChatHandoff[] = [];
  const seenTargets = new Set<string>();
  let dropped = 0;

  const body = text.replace(TAG_PATTERN, (_match, attrsRaw: string) => {
    if (handoffs.length >= MAX_HANDOFFS_PER_TURN) {
      dropped += 1;
      return '';
    }
    const attrs = extractAttrs(attrsRaw);
    const parsed = RawAttrSchema.safeParse(attrs);
    if (!parsed.success) {
      dropped += 1;
      return '';
    }
    const value = parsed.data;
    if (seenTargets.has(value.target_user_id)) {
      // First-match wins; subsequent duplicates dropped.
      dropped += 1;
      return '';
    }
    seenTargets.add(value.target_user_id);
    handoffs.push(
      Object.freeze({
        targetUserId: value.target_user_id,
        targetRole: value.target_role,
        topic: value.topic,
        scopePayload: buildScope(value),
      }),
    );
    return '';
  });

  return Object.freeze({
    body,
    handoffs: Object.freeze(handoffs.slice()),
    dropped,
  });
}
