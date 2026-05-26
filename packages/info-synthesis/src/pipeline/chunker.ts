/**
 * Pipeline stage 1 — chunker.
 *
 * INFORMATION_SYNTHESIS_SOTA_SPEC §3.1: distill operates on chunks,
 * never raw artifacts. The chunker splits each artifact into ~N-word
 * windows aligned to sentence boundaries. Default budget 400 words —
 * tracks the Anthropic best-practice band for synthesis stages with
 * Haiku-class models.
 *
 * Pure function. Deterministic. No I/O.
 */

import { randomUUID } from 'node:crypto';
import type { Chunk, CorpusArtifact } from '../types.js';
import { INFO_SYNTHESIS_CONSTANTS } from '../types.js';

export interface ChunkerOptions {
  readonly wordBudget?: number;
  /** UUID factory injection for deterministic tests. */
  readonly nextId?: () => string;
}

/**
 * Chunk a single artifact into sentence-boundary-aligned word windows.
 *
 * Algorithm:
 *   1. Tokenise into sentences via terminator regex.
 *   2. Greedy fill: accumulate sentences until adding the next would
 *      exceed `wordBudget`; emit chunk; continue.
 *   3. A single sentence longer than the budget becomes its own chunk
 *      (the writer downstream can handle oversized chunks; we never
 *      slice mid-sentence — citation anchors would break).
 */
export function chunkArtifact(
  artifact: CorpusArtifact,
  options: ChunkerOptions = {},
): ReadonlyArray<Chunk> {
  const budget =
    options.wordBudget ?? INFO_SYNTHESIS_CONSTANTS.DEFAULT_CHUNK_WORD_BUDGET;
  const nextId = options.nextId ?? randomUUID;

  if (artifact.text.trim().length === 0) {
    return [];
  }

  const sentences = splitIntoSentences(artifact.text);
  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;
  let seq = 0;

  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (bufferWords > 0 && bufferWords + sentenceWords > budget) {
      chunks.push(makeChunk(nextId(), artifact.id, buffer, bufferWords, seq));
      seq += 1;
      buffer = [];
      bufferWords = 0;
    }
    buffer.push(sentence);
    bufferWords += sentenceWords;
  }

  if (buffer.length > 0) {
    chunks.push(makeChunk(nextId(), artifact.id, buffer, bufferWords, seq));
  }

  return chunks;
}

/**
 * Chunk a whole corpus. Returns a flat list with seq scoped per
 * artifact.
 */
export function chunkCorpus(
  corpus: ReadonlyArray<CorpusArtifact>,
  options: ChunkerOptions = {},
): ReadonlyArray<Chunk> {
  const all: Chunk[] = [];
  for (const artifact of corpus) {
    for (const chunk of chunkArtifact(artifact, options)) {
      all.push(chunk);
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function makeChunk(
  id: string,
  artifactId: string,
  sentences: ReadonlyArray<string>,
  wordCount: number,
  seq: number,
): Chunk {
  return Object.freeze({
    id,
    artifactId,
    text: sentences.join(' ').trim(),
    wordCount,
    seq,
  });
}

/**
 * Sentence splitter. Hand-rolled regex — adequate for English-language
 * mining-domain prose. Caveat: doesn't handle "Mr." abbreviations
 * perfectly; the synthesizer is robust to a chunk boundary landing
 * one sentence off.
 */
function splitIntoSentences(text: string): ReadonlyArray<string> {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countWords(s: string): number {
  if (s.trim().length === 0) {
    return 0;
  }
  return s.trim().split(/\s+/u).length;
}
