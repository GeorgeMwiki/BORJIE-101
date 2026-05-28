/**
 * board-element-parser — server-side `<board_add>` extractor.
 *
 * Runs inside brain-teach.hono.ts to strip the tags before the chat
 * body is forwarded as SSE `message_chunk` events, and emit the
 * parsed elements as their own `board_element` SSE events so the FE
 * blackboard store can append them without re-parsing.
 *
 * Mirrors the FE parser at
 * apps/owner-web/src/components/blackboard/parse-board-elements.ts
 * but lives here so the api-gateway has no dependency on owner-web.
 * Both parsers use the SAME zod schema shape (kept in sync by hand;
 * one source of truth is the FE module — this is a validation
 * subset that accepts what the FE accepts).
 *
 * Defensive policy (parity with FE):
 *  - Caps at 12 elements per turn.
 *  - First-match wins on duplicate ids.
 *  - Malformed JSON or schema-fail entries are dropped silently.
 *  - The tag is ALWAYS stripped from the body (even if invalid) so
 *    the owner never sees raw XML in the chat bubble.
 */

import { z } from 'zod';

const TAG_PATTERN = /<board_add>\s*(\{[\s\S]*?\})\s*<\/board_add>/gi;
const MAX_ELEMENTS_PER_TURN = 12;

// ─── Schema (validation subset shared with the FE) ─────────────────

const bilingual = z
  .object({ en: z.string().min(1).max(400), sw: z.string().min(1).max(400) })
  .strict();

const sentiment = z.enum(['positive', 'negative', 'neutral']);
const tone = z.enum(['positive', 'warning', 'critical', 'neutral']);

const boardElementSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('formula'),
      id: z.string().min(1).max(80),
      latex: z.string().min(1).max(400),
      label: bilingual.optional(),
      variables: z
        .array(z.object({ symbol: z.string().min(1).max(40), meaning: bilingual }).strict())
        .max(10)
        .optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('diagram'),
      id: z.string().min(1).max(80),
      kind: z.enum(['flow', 'tree', 'venn', 'matrix']),
      nodes: z
        .array(
          z
            .object({
              id: z.string().min(1).max(60),
              label: bilingual,
              parentId: z.string().min(1).max(60).optional(),
              meta: z.string().max(120).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(24),
      edges: z
        .array(
          z
            .object({
              from: z.string().min(1).max(60),
              to: z.string().min(1).max(60),
              label: bilingual.optional(),
            })
            .strict(),
        )
        .max(48)
        .optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('chart'),
      id: z.string().min(1).max(80),
      kind: z.enum(['bar', 'line', 'donut']),
      title: bilingual,
      series: z
        .array(
          z
            .object({
              name: z.string().min(1).max(80),
              color: z.enum(['gold', 'success', 'warning', 'danger', 'info']).optional(),
              points: z
                .array(z.object({ x: z.string().min(1).max(40), y: z.number().finite() }).strict())
                .min(1)
                .max(60),
            })
            .strict(),
        )
        .min(1)
        .max(4),
      height: z.number().int().min(120).max(420).optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('comparison'),
      id: z.string().min(1).max(80),
      headline: bilingual,
      cardA: z
        .object({
          label: bilingual,
          bullets: z.array(bilingual).min(1).max(5),
          metric: z
            .object({ label: bilingual, value: z.string().min(1).max(40), tone: tone.optional() })
            .strict()
            .optional(),
        })
        .strict(),
      cardB: z
        .object({
          label: bilingual,
          bullets: z.array(bilingual).min(1).max(5),
          metric: z
            .object({ label: bilingual, value: z.string().min(1).max(40), tone: tone.optional() })
            .strict()
            .optional(),
        })
        .strict(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      id: z.string().min(1).max(80),
      src: z.string().url().max(600),
      caption: bilingual,
      attribution: z.string().max(120).optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('text'),
      id: z.string().min(1).max(80),
      body: bilingual,
      weight: z.enum(['normal', 'emphasis', 'headline']).optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('highlight'),
      id: z.string().min(1).max(80),
      targetId: z.string().min(1).max(80),
      tone,
      note: bilingual.optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('arrow'),
      id: z.string().min(1).max(80),
      fromId: z.string().min(1).max(80),
      toId: z.string().min(1).max(80),
      label: bilingual.optional(),
      sentiment: sentiment.optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('sketch'),
      id: z.string().min(1).max(80),
      svgPath: z.string().min(1).max(2000),
      label: bilingual.optional(),
      atMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

export type BoardElement = z.infer<typeof boardElementSchema>;

export interface ParseBoardResult {
  readonly body: string;
  readonly elements: ReadonlyArray<BoardElement>;
  readonly dropped: number;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseBoardElements(text: string): ParseBoardResult {
  const elements: BoardElement[] = [];
  const seenIds = new Set<string>();
  let dropped = 0;

  const body = text.replace(TAG_PATTERN, (_match, json: string) => {
    if (elements.length >= MAX_ELEMENTS_PER_TURN) {
      dropped += 1;
      return '';
    }
    const parsed = safeParseJson(json);
    if (!parsed || typeof parsed !== 'object') {
      dropped += 1;
      return '';
    }
    const validated = boardElementSchema.safeParse(parsed);
    if (!validated.success) {
      dropped += 1;
      return '';
    }
    if (seenIds.has(validated.data.id)) {
      return '';
    }
    seenIds.add(validated.data.id);
    elements.push(validated.data);
    return '';
  });

  return { body, elements, dropped };
}
