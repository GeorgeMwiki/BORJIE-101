/**
 * Pipeline stage 2 — scorer.
 *
 * Scores each chunk on three axes:
 *
 *   1. relevance      — keyword-overlap of the chunk vs. the query,
 *                       normalised to 0..1. Lightweight; not a vector
 *                       embedding (the calling layer can pre-filter
 *                       via a vector retriever if needed).
 *   2. quality        — source reliability prior + chunk text health
 *                       (length, sentence density). Captures "this
 *                       chunk is well-formed and from a trustworthy
 *                       source".
 *   3. recencyDecay   — exponential decay against now with a
 *                       180-day half-life; missing publishedAt → 0.7
 *                       midpoint (we don't want to discard undated
 *                       documents).
 *
 * `score` is a weighted blend: 0.5*relevance + 0.3*quality + 0.2*recency.
 *
 * Pure function. Deterministic. No I/O.
 */

import type { Chunk, CorpusArtifact, ScoredChunk } from '../types.js';
import { INFO_SYNTHESIS_CONSTANTS } from '../types.js';

export interface ScorerInput {
  readonly query: string;
  readonly chunks: ReadonlyArray<Chunk>;
  readonly corpusById: ReadonlyMap<string, CorpusArtifact>;
  /** ISO 8601 string for deterministic tests. */
  readonly nowIso?: string;
}

export function scoreChunks(input: ScorerInput): ReadonlyArray<ScoredChunk> {
  const nowMs =
    input.nowIso !== undefined ? Date.parse(input.nowIso) : Date.now();
  const queryTokens = tokenise(input.query);
  const queryTokenSet = new Set(queryTokens);

  return input.chunks.map((chunk) => {
    const relevance = computeRelevance(chunk.text, queryTokenSet);
    const artifact = input.corpusById.get(chunk.artifactId);
    const quality = computeQuality(chunk, artifact);
    const recencyDecay = computeRecencyDecay(artifact?.publishedAt, nowMs);
    const score = round3(
      0.5 * relevance + 0.3 * quality + 0.2 * recencyDecay,
    );
    return Object.freeze({
      ...chunk,
      relevance: round3(relevance),
      quality: round3(quality),
      recencyDecay: round3(recencyDecay),
      score,
    });
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function tokenise(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-￿\s]+/giu, ' ')
    .split(/\s+/u)
    .filter((t) => t.length >= 3);
}

function computeRelevance(
  chunkText: string,
  queryTokens: ReadonlySet<string>,
): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const chunkTokens = new Set(tokenise(chunkText));
  if (chunkTokens.size === 0) {
    return 0;
  }
  let hits = 0;
  for (const t of queryTokens) {
    if (chunkTokens.has(t)) {
      hits += 1;
    }
  }
  return clamp01(hits / queryTokens.size);
}

function computeQuality(
  chunk: Chunk,
  artifact: CorpusArtifact | undefined,
): number {
  const reliabilityPrior = artifact?.reliability ?? 0.5;
  // Word-count health: too-short or too-long chunks are penalised.
  const wordHealth =
    chunk.wordCount < 25
      ? chunk.wordCount / 25
      : chunk.wordCount > 800
        ? Math.max(0, 1 - (chunk.wordCount - 800) / 800)
        : 1;
  return clamp01(0.6 * reliabilityPrior + 0.4 * wordHealth);
}

function computeRecencyDecay(
  publishedAtIso: string | undefined,
  nowMs: number,
): number {
  if (publishedAtIso === undefined) {
    return 0.7;
  }
  const publishedMs = Date.parse(publishedAtIso);
  if (!Number.isFinite(publishedMs)) {
    return 0.7;
  }
  const ageDays = Math.max(0, (nowMs - publishedMs) / (1000 * 60 * 60 * 24));
  const halfLife = INFO_SYNTHESIS_CONSTANTS.RECENCY_HALFLIFE_DAYS;
  return clamp01(Math.pow(0.5, ageDays / halfLife));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
