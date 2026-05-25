/**
 * Entity resolution. Bridges extracted facts to canonical entities.
 *
 * Three rungs, tried in order:
 *   1. exact match (case-insensitive, whitespace-collapsed)
 *   2. fuzzy match  (token Jaccard + Levenshtein, see in-memory-adapters)
 *   3. embedding match if an embedding is available on the resolver
 *
 * Anything below `THRESHOLDS.HITL_RESOLUTION` is HITL-flagged.
 */

import { stringSimilarity } from '../in-memory-adapters.js';
import type { IEntityResolver } from '../ports.js';
import type { ExtractedField } from '../extract/entity-extractor.js';
import {
  THRESHOLDS,
  type DocumentEntity,
  type ResolutionMethod,
} from '../types.js';

export interface ResolutionTarget {
  readonly extraction: ExtractedField;
  /** Free-form value to look up (e.g. extracted name). */
  readonly queryText: string;
}

export interface ResolutionResult {
  readonly extractionKey: string;
  readonly resolvedEntityId: string | null;
  readonly resolutionConfidence: number;
  readonly resolutionMethod: ResolutionMethod;
  readonly hitlStatus: DocumentEntity['resolutionHitlStatus'];
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function resolveEntities(
  tenantId: string,
  targets: ReadonlyArray<ResolutionTarget>,
  resolver: IEntityResolver,
): Promise<ReadonlyArray<ResolutionResult>> {
  const out: ResolutionResult[] = [];

  for (const target of targets) {
    const q = target.queryText;
    if (!q || q.trim().length === 0) {
      out.push({
        extractionKey: target.extraction.key,
        resolvedEntityId: null,
        resolutionConfidence: 0,
        resolutionMethod: 'fuzzy',
        hitlStatus: 'pending',
      });
      continue;
    }

    const candidates = await resolver.searchByName(tenantId, q, 5);
    if (candidates.length === 0) {
      out.push({
        extractionKey: target.extraction.key,
        resolvedEntityId: null,
        resolutionConfidence: 0,
        resolutionMethod: 'fuzzy',
        hitlStatus: 'pending',
      });
      continue;
    }

    // Exact match?
    const exact = candidates.find(
      (c) => normalise(c.displayName) === normalise(q),
    );
    if (exact) {
      out.push({
        extractionKey: target.extraction.key,
        resolvedEntityId: exact.entityId,
        resolutionConfidence: 1.0,
        resolutionMethod: 'exact_match',
        hitlStatus: null,
      });
      continue;
    }

    // Score by string similarity. Best > HITL threshold = auto.
    const ranked = candidates
      .map((c) => ({
        entityId: c.entityId,
        score: stringSimilarity(normalise(c.displayName), normalise(q)),
      }))
      .sort((a, b) => b.score - a.score);

    const top = ranked[0];
    if (top && top.score >= THRESHOLDS.HITL_RESOLUTION) {
      out.push({
        extractionKey: target.extraction.key,
        resolvedEntityId: top.entityId,
        resolutionConfidence: top.score,
        resolutionMethod: 'fuzzy',
        hitlStatus: null,
      });
      continue;
    }

    // Low confidence — try embedding if the resolver populates one.
    // The in-memory resolver returns a candidate's `embedding` on
    // `searchByName`; production resolvers should do the same.
    const withEmbedding = candidates.find((c) => Array.isArray(c.embedding));
    if (withEmbedding && withEmbedding.embedding) {
      const emb = await resolver.searchByEmbedding(
        tenantId,
        withEmbedding.embedding,
        5,
      );
      if (emb.length > 0) {
        out.push({
          extractionKey: target.extraction.key,
          resolvedEntityId: emb[0]!.entityId,
          resolutionConfidence: 0.78,
          resolutionMethod: 'embedding',
          hitlStatus: 'pending',
        });
        continue;
      }
    }

    // Below threshold and no embedding → HITL pending with NO surfaced
    // entity. We keep the top score for explainability but do not propose
    // a candidate the operator might rubber-stamp by mistake.
    out.push({
      extractionKey: target.extraction.key,
      resolvedEntityId: null,
      resolutionConfidence: top?.score ?? 0,
      resolutionMethod: 'fuzzy',
      hitlStatus: 'pending',
    });
  }

  return out;
}
