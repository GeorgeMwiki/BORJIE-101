/**
 * Pipeline stage 6 — citer.
 *
 * INFORMATION_SYNTHESIS_SOTA_SPEC §6: attaches per-claim citations
 * to the rendered synthesis. The citer walks each cluster + its
 * chunks, materialises a Citation per (claim → chunk → artifact)
 * triple, and dedupes across clusters that share the same source
 * artifact.
 *
 * The citation rendering itself is the writer's responsibility — the
 * citer's job is to produce the structured Citation[] that the
 * downstream UI layer turns into hyperlinks.
 *
 * Pure function. Deterministic. No I/O.
 */

import type {
  Chunk,
  Citation,
  CorpusArtifact,
  ReconciledCluster,
} from '../types.js';

export interface CiterInput {
  readonly clusters: ReadonlyArray<ReconciledCluster>;
  readonly chunksById: ReadonlyMap<string, Chunk>;
  readonly corpusById: ReadonlyMap<string, CorpusArtifact>;
}

export function attachCitations(input: CiterInput): ReadonlyArray<Citation> {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const cluster of input.clusters) {
    for (const chunkId of cluster.chunkIds) {
      const chunk = input.chunksById.get(chunkId);
      if (chunk === undefined) {
        continue;
      }
      const artifact = input.corpusById.get(chunk.artifactId);
      if (artifact === undefined) {
        continue;
      }
      const key = `${cluster.id}:${chunk.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(
        Object.freeze({
          claimSpan: cluster.topic,
          chunkId: chunk.id,
          artifactId: artifact.id,
          source: artifact.source,
          // Per-citation confidence inherits the cluster avg score —
          // good chunks → confident citations.
          confidence: cluster.avgScore,
        }),
      );
    }
  }
  return Object.freeze(out);
}
