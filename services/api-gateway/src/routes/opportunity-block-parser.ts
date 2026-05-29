/**
 * opportunity-block-parser — server-side `<opportunity>` extractor.
 *
 * Mirrors the shape + defensive policy of `board-element-parser.ts`
 * but for the new Mr. Mwikila opportunity blocks emitted via the
 * Borjie home teaching prompt extension ("ALWAYS LOOK FOR POSITIVE
 * ANGLES").
 *
 * Runs inside `brain-teach.hono.ts` to strip the tag(s) before the
 * chat body is forwarded as SSE `message_chunk` events, and emit the
 * parsed opportunity as its own `opportunity_proposed` SSE event so
 * the FE renderer can mount a slim gold-accent card below the AI
 * bubble without re-parsing.
 *
 * Defensive policy (mirrors `<board_add>` extractor):
 *   - Caps at ONE opportunity per turn — quality over quantity.
 *   - First-match wins on duplicate ids within the same turn.
 *   - Malformed JSON or schema-fail entries are dropped silently.
 *   - The tag is ALWAYS stripped from the body (even if invalid) so
 *     the owner never sees raw JSON in the chat bubble.
 *
 * Schema kept aligned with the `OpportunitySchema` exported from
 * `../services/opportunity-scanner/types` — this parser uses the
 * exported schema so there is only one source of truth on the wire.
 */

import { OpportunitySchema, type Opportunity } from '../services/opportunity-scanner/types';

const TAG_PATTERN = /<opportunity>\s*(\{[\s\S]*?\})\s*<\/opportunity>/gi;
const MAX_OPPORTUNITIES_PER_TURN = 1;

export interface ParseOpportunityResult {
  readonly body: string;
  readonly opportunities: ReadonlyArray<Opportunity>;
  readonly dropped: number;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseOpportunityBlocks(text: string): ParseOpportunityResult {
  const opportunities: Opportunity[] = [];
  const seenIds = new Set<string>();
  let dropped = 0;

  const body = text.replace(TAG_PATTERN, (_match, json: string) => {
    if (opportunities.length >= MAX_OPPORTUNITIES_PER_TURN) {
      dropped += 1;
      return '';
    }
    const parsed = safeParseJson(json);
    if (!parsed || typeof parsed !== 'object') {
      dropped += 1;
      return '';
    }
    const validated = OpportunitySchema.safeParse(parsed);
    if (!validated.success) {
      dropped += 1;
      return '';
    }
    if (seenIds.has(validated.data.id)) {
      return '';
    }
    seenIds.add(validated.data.id);
    opportunities.push(validated.data);
    return '';
  });

  return { body, opportunities, dropped };
}
