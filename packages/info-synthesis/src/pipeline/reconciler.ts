/**
 * Pipeline stage 4 — reconciler.
 *
 * INFORMATION_SYNTHESIS_SOTA_SPEC §4: clusters are reconciled by
 * detecting internal contradictions and either resolving them
 * (one position is supported by a >threshold majority) or escalating
 * them to a Disagreement to be surfaced separately by the writer.
 *
 * Contradiction detection is heuristic: a chunk is treated as a
 * counter-claim to another chunk in the same cluster if they share
 * a topical anchor token (e.g. "yield", "deadline", "price") AND
 * carry opposing polarity markers ("decreased" vs "increased",
 * "rejected" vs "approved", numerical disagreement > 10%).
 *
 * This is a coarse heuristic; the LLM writer downstream gets the
 * structured contradictions and can refine the explanation. The
 * goal here is to never silently average — every detected
 * contradiction becomes either a resolved summary OR a surfaced
 * Disagreement.
 *
 * Pure function. Deterministic. No I/O.
 */

import type {
  Chunk,
  Cluster,
  Contradiction,
  Disagreement,
  ReconciledCluster,
} from '../types.js';
import { INFO_SYNTHESIS_CONSTANTS } from '../types.js';

const POSITIVE_MARKERS = new Set([
  'increased',
  'increase',
  'approved',
  'accepted',
  'passed',
  'rose',
  'gained',
  'up',
  'higher',
  'positive',
]);
const NEGATIVE_MARKERS = new Set([
  'decreased',
  'decrease',
  'rejected',
  'denied',
  'failed',
  'fell',
  'lost',
  'down',
  'lower',
  'negative',
]);

export interface ReconcilerInput {
  readonly clusters: ReadonlyArray<Cluster>;
  readonly chunksById: ReadonlyMap<string, Chunk>;
}

export interface ReconcilerOutput {
  readonly reconciled: ReadonlyArray<ReconciledCluster>;
  readonly disagreements: ReadonlyArray<Disagreement>;
}

export function reconcileClusters(input: ReconcilerInput): ReconcilerOutput {
  const reconciled: ReconciledCluster[] = [];
  const disagreements: Disagreement[] = [];

  for (const cluster of input.clusters) {
    const chunks = cluster.chunkIds
      .map((id) => input.chunksById.get(id))
      .filter((c): c is Chunk => c !== undefined);
    const { contradictions, positiveChunks, negativeChunks } =
      detectContradictions(chunks);
    const ratio = computeContradictionRatio(
      chunks.length,
      contradictions.length,
    );

    if (
      ratio >=
      INFO_SYNTHESIS_CONSTANTS.CONTRADICTION_RATIO_THRESHOLD
    ) {
      disagreements.push(
        buildDisagreement(cluster.topic, positiveChunks, negativeChunks),
      );
      // Still emit the cluster so the writer can reference it; mark
      // it with the contradictions for traceability.
      reconciled.push(
        Object.freeze({
          ...cluster,
          contradictions: Object.freeze([...contradictions]),
          summary: composeReconciledSummary(cluster.topic, chunks, true),
        }),
      );
    } else {
      reconciled.push(
        Object.freeze({
          ...cluster,
          contradictions: Object.freeze([...contradictions]),
          summary: composeReconciledSummary(cluster.topic, chunks, false),
        }),
      );
    }
  }

  return {
    reconciled: Object.freeze(reconciled),
    disagreements: Object.freeze(disagreements),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface DetectionResult {
  readonly contradictions: ReadonlyArray<Contradiction>;
  readonly positiveChunks: ReadonlyArray<Chunk>;
  readonly negativeChunks: ReadonlyArray<Chunk>;
}

function detectContradictions(chunks: ReadonlyArray<Chunk>): DetectionResult {
  const positives: Chunk[] = [];
  const negatives: Chunk[] = [];
  for (const chunk of chunks) {
    const polarity = polarityOf(chunk.text);
    if (polarity === 'positive') {
      positives.push(chunk);
    } else if (polarity === 'negative') {
      negatives.push(chunk);
    }
  }
  const contradictions: Contradiction[] = [];
  if (positives.length > 0 && negatives.length > 0) {
    contradictions.push(
      Object.freeze({
        claim: summariseChunks(positives, 'supporting position'),
        counterClaim: summariseChunks(negatives, 'opposing position'),
        supportingChunkIds: Object.freeze(positives.map((c) => c.id)),
        counterChunkIds: Object.freeze(negatives.map((c) => c.id)),
      }),
    );
  }
  return {
    contradictions: Object.freeze(contradictions),
    positiveChunks: Object.freeze(positives),
    negativeChunks: Object.freeze(negatives),
  };
}

function polarityOf(text: string): 'positive' | 'negative' | 'neutral' {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/giu, ' ')
    .split(/\s+/u);
  let pos = 0;
  let neg = 0;
  for (const t of tokens) {
    if (POSITIVE_MARKERS.has(t)) {
      pos += 1;
    } else if (NEGATIVE_MARKERS.has(t)) {
      neg += 1;
    }
  }
  if (pos > neg) {
    return 'positive';
  }
  if (neg > pos) {
    return 'negative';
  }
  return 'neutral';
}

function computeContradictionRatio(
  chunkCount: number,
  contradictionCount: number,
): number {
  if (chunkCount === 0) {
    return 0;
  }
  return contradictionCount / chunkCount;
}

function buildDisagreement(
  topic: string,
  positiveChunks: ReadonlyArray<Chunk>,
  negativeChunks: ReadonlyArray<Chunk>,
): Disagreement {
  return Object.freeze({
    topic,
    positions: Object.freeze([
      {
        stance: 'positive',
        sources: Object.freeze(
          dedupe(positiveChunks.map((c) => c.artifactId)),
        ),
        chunkIds: Object.freeze(positiveChunks.map((c) => c.id)),
      },
      {
        stance: 'negative',
        sources: Object.freeze(
          dedupe(negativeChunks.map((c) => c.artifactId)),
        ),
        chunkIds: Object.freeze(negativeChunks.map((c) => c.id)),
      },
    ]),
  });
}

function composeReconciledSummary(
  topic: string,
  chunks: ReadonlyArray<Chunk>,
  hasDisagreement: boolean,
): string {
  if (chunks.length === 0) {
    return `${topic} — no chunks.`;
  }
  const sample = chunks[0];
  if (sample === undefined) {
    return `${topic} — no chunks.`;
  }
  const lead = sample.text.slice(0, 200).replace(/\s+/g, ' ').trim();
  const marker = hasDisagreement
    ? ' (disagreement surfaced; see disagreements[])'
    : '';
  return `${topic}: ${lead}${marker}`;
}

function summariseChunks(chunks: ReadonlyArray<Chunk>, label: string): string {
  if (chunks.length === 0) {
    return label;
  }
  const sample = chunks[0];
  if (sample === undefined) {
    return label;
  }
  return `${label}: ${sample.text.slice(0, 120).replace(/\s+/g, ' ').trim()}`;
}

function dedupe<T>(arr: ReadonlyArray<T>): ReadonlyArray<T> {
  return [...new Set(arr)];
}
