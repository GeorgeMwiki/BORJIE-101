/**
 * Blackboard element types — zod schemas for every primitive Mr. Mwikila
 * can render on the teaching canvas. The brain emits one
 * `<board_add>{...payload}</board_add>` tag per element; the FE parses,
 * validates, and pushes into the store.
 *
 * Parity with LitFin's smartboard vocabulary (10 primitives) but
 * mining-estate tailored. See Docs/DESIGN/LITFIN_BLACKBOARD_SPEC.md
 * for the structural reference and Docs/DESIGN/BORJIE_BLACKBOARD_
 * CURRICULUM.md for the corpus of canonical moves.
 */

import { z } from 'zod';

// ─── Bilingual string helper ────────────────────────────────────────

export const bilingualSchema = z
  .object({
    en: z.string().min(1).max(400),
    sw: z.string().min(1).max(400),
  })
  .strict();
export type Bilingual = z.infer<typeof bilingualSchema>;

const sentimentSchema = z.enum(['positive', 'negative', 'neutral']);
const toneSchema = z.enum(['positive', 'warning', 'critical', 'neutral']);

// ─── Element schemas ────────────────────────────────────────────────

const formulaSchema = z
  .object({
    type: z.literal('formula'),
    id: z.string().min(1).max(80),
    latex: z.string().min(1).max(400),
    label: bilingualSchema.optional(),
    variables: z
      .array(
        z.object({
          symbol: z.string().min(1).max(40),
          meaning: bilingualSchema,
        }),
      )
      .max(10)
      .optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const diagramNodeSchema = z
  .object({
    id: z.string().min(1).max(60),
    label: bilingualSchema,
    parentId: z.string().min(1).max(60).optional(),
    meta: z.string().max(120).optional(),
  })
  .strict();

const diagramSchema = z
  .object({
    type: z.literal('diagram'),
    id: z.string().min(1).max(80),
    kind: z.enum(['flow', 'tree', 'venn', 'matrix']),
    nodes: z.array(diagramNodeSchema).min(1).max(24),
    edges: z
      .array(
        z
          .object({
            from: z.string().min(1).max(60),
            to: z.string().min(1).max(60),
            label: bilingualSchema.optional(),
          })
          .strict(),
      )
      .max(48)
      .optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const chartSchema = z
  .object({
    type: z.literal('chart'),
    id: z.string().min(1).max(80),
    kind: z.enum(['bar', 'line', 'donut']),
    title: bilingualSchema,
    series: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            color: z.enum(['gold', 'success', 'warning', 'danger', 'info']).optional(),
            points: z
              .array(
                z
                  .object({
                    x: z.string().min(1).max(40),
                    y: z.number().finite(),
                  })
                  .strict(),
              )
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
  .strict();

const comparisonSchema = z
  .object({
    type: z.literal('comparison'),
    id: z.string().min(1).max(80),
    headline: bilingualSchema,
    cardA: z
      .object({
        label: bilingualSchema,
        bullets: z.array(bilingualSchema).min(1).max(5),
        metric: z
          .object({
            label: bilingualSchema,
            value: z.string().min(1).max(40),
            tone: toneSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    cardB: z
      .object({
        label: bilingualSchema,
        bullets: z.array(bilingualSchema).min(1).max(5),
        metric: z
          .object({
            label: bilingualSchema,
            value: z.string().min(1).max(40),
            tone: toneSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const imageSchema = z
  .object({
    type: z.literal('image'),
    id: z.string().min(1).max(80),
    src: z.string().url().max(600),
    caption: bilingualSchema,
    attribution: z.string().max(120).optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const textSchema = z
  .object({
    type: z.literal('text'),
    id: z.string().min(1).max(80),
    body: bilingualSchema,
    weight: z.enum(['normal', 'emphasis', 'headline']).optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const highlightSchema = z
  .object({
    type: z.literal('highlight'),
    id: z.string().min(1).max(80),
    targetId: z.string().min(1).max(80),
    tone: toneSchema,
    note: bilingualSchema.optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const arrowSchema = z
  .object({
    type: z.literal('arrow'),
    id: z.string().min(1).max(80),
    fromId: z.string().min(1).max(80),
    toId: z.string().min(1).max(80),
    label: bilingualSchema.optional(),
    sentiment: sentimentSchema.optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const sketchSchema = z
  .object({
    type: z.literal('sketch'),
    id: z.string().min(1).max(80),
    svgPath: z.string().min(1).max(2000),
    label: bilingualSchema.optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();

// ─── Discriminated union of every element ───────────────────────────

export const boardElementSchema = z.discriminatedUnion('type', [
  formulaSchema,
  diagramSchema,
  chartSchema,
  comparisonSchema,
  imageSchema,
  textSchema,
  highlightSchema,
  arrowSchema,
  sketchSchema,
]);

export type BoardElement = z.infer<typeof boardElementSchema>;
export type BoardElementType = BoardElement['type'];

// ─── Element envelope (added to store) ──────────────────────────────

export interface BoardElementEnvelope {
  /** Stable id (taken from the payload) — used for dedupe + replay. */
  readonly id: string;
  /** Monotonic add-time so the renderer can compute stagger. */
  readonly addedAt: number;
  /** The parsed, validated payload. */
  readonly element: BoardElement;
  /** Optional message id this element was attached to. */
  readonly messageId: string | null;
}
