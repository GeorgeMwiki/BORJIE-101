/**
 * Citation resolver — Discipline 2, stage 2.
 *
 * Confirms that each `citation_id` marker found in a sentence
 * corresponds to a real `SpanCitation` in the turn's evidence inventory.
 * Pure function — operates on the caller-supplied citation index.
 *
 * @module @borjie/cognitive-engine/grounding/citation-resolver
 */

import type { SpanCitation } from '../types.js';

export interface CitationResolution {
  readonly citation_id: string;
  readonly resolved: boolean;
  readonly source_title?: string;
}

export function buildCitationIndex(
  citations: ReadonlyArray<SpanCitation>,
): ReadonlyMap<string, SpanCitation> {
  const map = new Map<string, SpanCitation>();
  for (const c of citations) {
    map.set(c.citationId, c);
  }
  return map;
}

export function resolveCitations(
  markers: ReadonlyArray<string>,
  index: ReadonlyMap<string, SpanCitation>,
): ReadonlyArray<CitationResolution> {
  return markers.map((m) => {
    const hit = index.get(m);
    if (hit === undefined) {
      return { citation_id: m, resolved: false };
    }
    return { citation_id: m, resolved: true, source_title: hit.title };
  });
}
