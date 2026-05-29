/**
 * citations_block — inline citations for AI claims.
 *
 * Source: `Docs/RESEARCH/owner-status-sota.md` §1.F + §8 — "every claim
 * cites a specific datum." Roadmap R1.
 *
 * When the brain sources a claim from the intelligence corpus or LMBM,
 * it emits a `<ui_block>` of `type: 'citations_block'`. The renderer
 * shows superscript pills (¹²³ / cite-1 / cite-2 / ...) inline with the
 * claim and opens a side panel with `excerpt` + `sourceUrl` when tapped.
 *
 * Why a discrete block rather than inline `<citation>` tags inside the
 * text body: the discriminated-union dispatcher already handles parsing
 * and validation for every other inline block. Keeping citations on the
 * same surface means the same parser, the same render loop, the same
 * test harness, the same brain prompt cadence.
 *
 * Bilingual: panel chrome (labels, "Open source") is rendered by the FE
 * via locale; the `source`, `title`, `excerpt` strings come straight
 * from the corpus and stay in their original language.
 */

import { z } from 'zod';

// ─── citation reference (one entry per pill) ─────────────────────────

const citationRefSchema = z.object({
  /**
   * Stable id for the citation pill — used as the on-pill label
   * ("cite-1" / "¹" depending on render mode). Brain emits `cite-N`
   * starting at 1; FE may remap to superscript glyphs.
   */
  id: z.string().min(1).max(40),
  /**
   * Free-text source label. Examples:
   *  - "Mining Act 2010, §47(1)"
   *  - "TMA Bulletin 2026-03"
   *  - "LMBM cell PML-0241-2023#royalty-rate"
   *  - "Borjie intelligence corpus: gold-royalty.md#L42"
   */
  source: z.string().min(1).max(200),
  /** Display title shown in the side panel header. */
  title: z.string().min(1).max(160),
  /**
   * Quoted excerpt (≤ 400 chars) from the cited document. The FE
   * displays this verbatim inside the side panel under the title.
   */
  excerpt: z.string().min(1).max(400),
  /**
   * Optional click-through URL. Internal corpus chunks omit this and
   * the FE falls back to opening the brain's `corpus.lookup` action.
   */
  sourceUrl: z.string().url().max(500).optional(),
  /** Free-text kind for icon selection: 'corpus' | 'lmbm' | 'web' | 'doc'. */
  kind: z.enum(['corpus', 'lmbm', 'web', 'doc']).default('corpus'),
});

export type CitationRef = z.infer<typeof citationRefSchema>;

// ─── citations_block schema ─────────────────────────────────────────

export const citationsBlockSchema = z.object({
  type: z.literal('citations_block'),
  /**
   * Optional one-line headline displayed above the pill row. Bilingual
   * for the rare case the brain wants to label the row ("Sources" /
   * "Vyanzo"). Most turns omit this — the row of pills is enough.
   */
  headline: z
    .object({
      en: z.string().min(1).max(60),
      sw: z.string().min(1).max(60),
    })
    .optional(),
  citations: z.array(citationRefSchema).min(1).max(8),
});

export type CitationsBlock = z.infer<typeof citationsBlockSchema>;

export const CITATIONS_BLOCK_TYPE = 'citations_block' as const;
