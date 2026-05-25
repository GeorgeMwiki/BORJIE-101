/**
 * Piece O — Search observer.
 *
 * Watches search queries (Cmd+K palette via packages/spotlight, or any
 * other search surface) and matches them against module-keyword rules.
 */

import { evaluateSearchQuery } from '../scoring-matrix.js';
import type { NewSignalInput, SearchKeywordPayload } from '../types.js';

export interface SearchQueryEvent {
  readonly tenantId: string;
  readonly userId: string;
  readonly query: string;
}

/**
 * Tokenise a raw query into lowercase tokens. Very simple: split on
 * non-alphanumeric, drop empties, drop very short tokens. The matrix
 * matcher does its own substring match so this is mostly for the
 * payload — but keeping it here lets callers inspect tokens for
 * downstream analytics without re-tokenising.
 */
export function tokeniseQuery(query: string): readonly string[] {
  if (!query || typeof query !== 'string') return [];
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Convert a search query into zero or more signals.
 */
export function observeSearch(
  event: SearchQueryEvent,
): readonly NewSignalInput[] {
  if (!event || !event.tenantId || !event.userId || !event.query) return [];

  const hits = evaluateSearchQuery(event.query);
  if (hits.length === 0) return [];

  const payload: SearchKeywordPayload = {
    query: event.query.slice(0, 512),
    tokens: tokeniseQuery(event.query).slice(0, 50),
  };

  return hits.map((hit) => ({
    tenantId: event.tenantId,
    userId: event.userId,
    signalKind: 'search_keyword' as const,
    signalPayload: { ...payload, matchedRule: hit.rule },
    suggestedModuleTemplateId: hit.suggestedModuleTemplateId,
    weight: hit.weight,
  }));
}
