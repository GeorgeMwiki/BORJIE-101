/**
 * Artifact-richness shared types.
 *
 * Wave ARTIFACT-RICHNESS-2026-05-29. Every Borjie artifact (drafts,
 * briefs, scan reports, decision-journal entries, inspection
 * narratives, compliance exports, plan-DAGs, blackboards, settlement
 * statements, RFB confirmations, cockpit cards, audit receipts) flows
 * its source-of-truth markdown through this layer to gain SOTA
 * richness without each producer re-implementing mermaid / KaTeX /
 * citation embed / branded layout / TOC / empty-state behaviour.
 *
 * The package is consumed:
 *   - by `services/api-gateway/src/services/document-drafter/renderers/*`
 *     to extend the markdown-to-html pipeline.
 *   - by every artifact-producing service that wants its body to look
 *     like the others (single visual contract).
 *
 * Zero direct dependency on heavy libs — mermaid / KaTeX / vega are
 * imported lazily so cold-start stays cheap and the api-gateway boots
 * in environments where those binaries are absent. Each renderer
 * gracefully degrades to the textual source when its peer is missing.
 */

export type ArtifactLanguage = 'sw' | 'en';

export type ArtifactClassification = 'public' | 'internal' | 'confidential';

/**
 * Citation chip — emitted by claim-bearing artifacts. The shape is
 * shared with `@borjie/owner-os-tabs` citations-block but lives here
 * too so artifact-richness has no inverse dependency on owner-os-tabs.
 */
export interface ArtifactCitation {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly url?: string;
  readonly evidenceId?: string;
  readonly retrievedAt?: string;
}

export interface ArtifactRichnessOptions {
  /** When true, mermaid blocks render to inline SVG (when binary available). Defaults true. */
  readonly mermaid: boolean;
  /** When true, $...$ + $$...$$ render via KaTeX. Defaults true. */
  readonly katex: boolean;
  /** When true, append a footnotes section consolidating citations. Defaults true. */
  readonly footnotes: boolean;
  /** When true, prepend an auto-generated TOC if the body has 4+ headings. Defaults true. */
  readonly tableOfContents: boolean;
  /** Language for empty-state / disclaimer copy. */
  readonly language: ArtifactLanguage;
}

export const DEFAULT_RICHNESS_OPTIONS: ArtifactRichnessOptions = Object.freeze({
  mermaid: true,
  katex: true,
  footnotes: true,
  tableOfContents: true,
  language: 'en',
});

/**
 * Result of running the richness pipeline on a markdown body. The
 * `body` is the canonical markdown with replacements applied; the
 * `htmlOverrides` map carries pre-rendered HTML for tokens that the
 * downstream markdown-to-html pass should NOT re-escape (mermaid SVG,
 * KaTeX MathML, citation chips). The renderer pipeline substitutes by
 * the opaque marker key in the body.
 */
export interface RichnessResult {
  readonly body: string;
  readonly htmlOverrides: Readonly<Record<string, string>>;
  readonly tocHtml: string | null;
  readonly footnotesHtml: string | null;
  readonly mermaidCount: number;
  readonly mathCount: number;
  readonly citationCount: number;
}

/**
 * A token marker the richness pipeline injects into the markdown body
 * so the downstream HTML-from-MD pass can splice in the pre-rendered
 * SVG / MathML without re-encoding the angle brackets. The format is
 * intentionally distinctive so it cannot collide with user content.
 */
export const RICHNESS_MARKER_PREFIX = 'RICHNESS_TOKEN_';
export const RICHNESS_MARKER_SUFFIX = '';

export function makeMarker(id: string): string {
  return `${RICHNESS_MARKER_PREFIX}${id}${RICHNESS_MARKER_SUFFIX}`;
}

/**
 * Tail-only random-ish marker id — deterministic enough that tests can
 * snapshot output, opaque enough that a user typing the prefix in
 * markdown will never collide (we strip every  from input first).
 */
export function makeMarkerId(kind: 'mermaid' | 'math' | 'citation' | 'toc', index: number): string {
  return `${kind}_${index.toString(36)}`;
}
