/**
 * Citation builder — ResearchArtifact → SpanCitation.
 *
 * Reuses the span format used by `packages/ai-copilot/src/retrieval/
 * span-citations.ts` (FRONT paper, Jaccard-best-sentence). Web sources
 * carry `kind: 'web'` per DEEP_RESEARCH_SPEC §8 extension.
 *
 * Pure — no I/O, deterministic given the same artifact + claim text.
 *
 * @module @borjie/research-tools/citations/citation-builder
 */

import type { ResearchArtifact, SpanCitation, SourceKind } from '../types.js';

// ---------------------------------------------------------------------------
// Sentence splitter — copy of the regex from ai-copilot/span-citations
// ===========================================================================

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9"'])|\n+/;
const MIN_OVERLAP_FOR_SPAN = 0.15;

interface Sentence {
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

function splitIntoSentences(text: string): ReadonlyArray<Sentence> {
  if (!text) return [];
  const out: Array<Sentence> = [];
  let cursor = 0;
  const pieces = text.split(SENTENCE_SPLIT_RE);
  for (const piece of pieces) {
    if (piece.length === 0) {
      cursor = advancePastWhitespace(text, cursor);
      continue;
    }
    const found = text.indexOf(piece, cursor);
    if (found < 0) {
      cursor = Math.min(text.length, cursor + piece.length);
      continue;
    }
    out.push({ text: piece, startOffset: found, endOffset: found + piece.length });
    cursor = found + piece.length;
  }
  if (out.length === 0) {
    out.push({ text, startOffset: 0, endOffset: text.length });
  }
  return out;
}

function advancePastWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i] ?? '')) i++;
  return i;
}

// ---------------------------------------------------------------------------
// Token + Jaccard
// ===========================================================================

const TOKEN_RE = /[a-zA-Z0-9]+/g;

function tokenize(text: string): ReadonlyArray<string> {
  const matches = text.toLowerCase().match(TOKEN_RE);
  return matches ?? [];
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const tok of a) if (b.has(tok)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Public surface
// ===========================================================================

export interface BuildCitationInput {
  readonly artifact: ResearchArtifact;
  /** The claim text the Synthesizer is citing this artifact for. We
   *  pick the best-matching sentence inside the artifact's content. */
  readonly claim_text: string;
}

/**
 * Build a SpanCitation for an artifact + claim. The returned span's
 * character offsets are valid against `artifact.content` —
 * `content.slice(startOffset, endOffset) === quotedSpan` always holds.
 */
export function buildSpanCitation(input: BuildCitationInput): SpanCitation {
  const { artifact, claim_text } = input;
  const sentences = splitIntoSentences(artifact.content);

  if (sentences.length === 0) {
    return {
      citationId: artifact.citation_id,
      kind: mapKind(artifact.source_kind),
      sourceUri: artifact.source_uri,
      startOffset: 0,
      endOffset: artifact.content.length,
      quotedSpan: artifact.content,
      overlap: 0,
    };
  }

  const claimTokens = new Set(tokenize(claim_text));
  let best: Sentence | null = null;
  let bestOverlap = -1;
  for (const s of sentences) {
    const sTokens = new Set(tokenize(s.text));
    const overlap = jaccard(claimTokens, sTokens);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = s;
    }
  }

  if (!best || bestOverlap < MIN_OVERLAP_FOR_SPAN) {
    // Fall back to the excerpt — better to over-highlight than mis-cite.
    return {
      citationId: artifact.citation_id,
      kind: mapKind(artifact.source_kind),
      sourceUri: artifact.source_uri,
      startOffset: 0,
      endOffset: artifact.content.length,
      quotedSpan: artifact.content,
      overlap: Math.max(0, bestOverlap),
    };
  }

  return {
    citationId: artifact.citation_id,
    kind: mapKind(artifact.source_kind),
    sourceUri: artifact.source_uri,
    startOffset: best.startOffset,
    endOffset: best.endOffset,
    quotedSpan: artifact.content.slice(best.startOffset, best.endOffset),
    overlap: bestOverlap,
  };
}

function mapKind(k: SourceKind): SpanCitation['kind'] {
  return k;
}

/**
 * Convenience — generate a stable citation id for an artifact URI.
 * Adapters call this when constructing artifacts. Stable across runs
 * (same URI ⇒ same id) so the audit chain references match.
 */
export function deriveCitationId(uri: string, suffix?: string): string {
  // Simple deterministic hash (FNV-1a 32-bit). Stable, dependency-free.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < uri.length; i++) {
    h ^= uri.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const base = `cit_${h.toString(16).padStart(8, '0')}`;
  return suffix ? `${base}_${suffix}` : base;
}
