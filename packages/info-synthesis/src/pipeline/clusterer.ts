/**
 * Pipeline stage 3 — clusterer.
 *
 * Groups scored chunks into topically coherent clusters via a
 * lightweight token-Jaccard agglomeration. The algorithm intentionally
 * avoids a vector index — runs in pure memory, deterministic, suitable
 * for any chunk count up to ~5000. Larger corpora pre-filter via the
 * vector retriever upstream of this stage.
 *
 * Spec §3.2 — clusters are the unit the reconciler operates on. A
 * cluster topic label is the K most frequent salient tokens, joined
 * with the convention "topic: <words>".
 *
 * Pure function. Deterministic. No I/O.
 */

import { randomUUID } from 'node:crypto';
import type { Cluster, ScoredChunk } from '../types.js';
import { INFO_SYNTHESIS_CONSTANTS } from '../types.js';

export interface ClustererOptions {
  readonly maxClusters?: number;
  /** Jaccard threshold above which two chunks are merged. */
  readonly mergeThreshold?: number;
  readonly nextId?: () => string;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'this',
  'from',
  'have',
  'are',
  'was',
  'were',
  'has',
  'had',
  'but',
  'not',
  'all',
  'any',
  'one',
  'two',
  'into',
  'over',
  'out',
  'their',
  'they',
  'them',
]);

export function clusterChunks(
  chunks: ReadonlyArray<ScoredChunk>,
  options: ClustererOptions = {},
): ReadonlyArray<Cluster> {
  const maxClusters =
    options.maxClusters ?? INFO_SYNTHESIS_CONSTANTS.DEFAULT_MAX_CLUSTERS;
  const mergeThreshold = options.mergeThreshold ?? 0.25;
  const nextId = options.nextId ?? randomUUID;

  const ranked = [...chunks]
    .filter((c) => c.score >= INFO_SYNTHESIS_CONSTANTS.MIN_SCORE_FOR_CLUSTERING)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return [];
  }

  interface Bucket {
    readonly tokens: Set<string>;
    readonly chunkIds: string[];
    readonly avgScoreSum: number;
    readonly count: number;
  }

  const buckets: Bucket[] = [];

  for (const chunk of ranked) {
    const tokens = tokeniseSalient(chunk.text);
    let placed = false;
    for (let i = 0; i < buckets.length; i += 1) {
      const bucket = buckets[i];
      if (bucket === undefined) {
        continue;
      }
      const sim = jaccard(tokens, bucket.tokens);
      if (sim >= mergeThreshold) {
        buckets[i] = {
          tokens: union(bucket.tokens, tokens),
          chunkIds: [...bucket.chunkIds, chunk.id],
          avgScoreSum: bucket.avgScoreSum + chunk.score,
          count: bucket.count + 1,
        };
        placed = true;
        break;
      }
    }
    if (!placed) {
      buckets.push({
        tokens,
        chunkIds: [chunk.id],
        avgScoreSum: chunk.score,
        count: 1,
      });
    }
  }

  // Sort buckets by average score descending, take the top N.
  const topBuckets = buckets
    .map((b) => ({ ...b, avg: b.avgScoreSum / Math.max(1, b.count) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, maxClusters);

  return topBuckets.map((b) =>
    Object.freeze({
      id: nextId(),
      topic: pickTopicLabel(b.tokens),
      chunkIds: Object.freeze([...b.chunkIds]),
      avgScore: round3(b.avg),
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function tokeniseSalient(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9-￿\s]+/giu, ' ')
    .split(/\s+/u)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) {
      inter += 1;
    }
  }
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set<string>(a);
  for (const t of b) {
    out.add(t);
  }
  return out;
}

function pickTopicLabel(tokens: ReadonlySet<string>): string {
  const words = [...tokens].sort((a, b) => a.localeCompare(b)).slice(0, 5);
  if (words.length === 0) {
    return 'topic: unlabelled';
  }
  return `topic: ${words.join(', ')}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
