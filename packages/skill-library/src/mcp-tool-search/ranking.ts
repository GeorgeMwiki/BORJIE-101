/**
 * Ranking algorithm for ToolSearch candidate retrieval.
 *
 * Design tradeoff: we want this to run client-side, fast (< 100ms for
 * thousands of tools), with no external embedding service required. So
 * the ranker is a deterministic keyword-weighted scorer:
 *
 *   score = 0.5 * name_match  + 0.3 * description_match + 0.2 * tag_match
 *
 * Each component is in [0, 1] computed as `matched_terms / total_terms`
 * (Jaccard-ish — symmetric difference would over-penalize long queries).
 *
 * For the Voyager skill library, we use a richer embedding-based retriever
 * (see voyager-library/retrieval.ts). Here we keep things lean — MCP
 * tool catalogs change frequently and we want zero-cost ranking.
 */

import type { McpToolDescriptor, ToolSearchCandidate } from './types.js';

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'and',
  'of',
  'in',
  'on',
  'for',
  'with',
  'by',
  'is',
  'are',
  'was',
  'be',
  'me',
  'i',
  'my',
  'we',
  'our',
]);

export function tokenize(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function jaccardOverlap(
  queryTokens: ReadonlyArray<string>,
  targetTokens: ReadonlyArray<string>
): number {
  if (queryTokens.length === 0) return 0;
  const targetSet = new Set(targetTokens);
  let hits = 0;
  for (const t of queryTokens) {
    if (targetSet.has(t)) hits++;
  }
  return hits / queryTokens.length;
}

/**
 * Rank candidates against a query. Returns sorted descending by score.
 * Score == 0 entries are dropped so the caller never has to filter.
 */
export function rankCandidates(
  registry: ReadonlyArray<McpToolDescriptor>,
  query: string,
  maxResults: number
): ReadonlyArray<ToolSearchCandidate> {
  const qTokens = tokenize(query);
  const scored: Array<{ desc: McpToolDescriptor; score: number }> = [];
  for (const tool of registry) {
    const nameScore = jaccardOverlap(qTokens, tokenize(tool.name));
    const descScore = jaccardOverlap(qTokens, tokenize(tool.description));
    const tagScore = jaccardOverlap(
      qTokens,
      tokenize((tool.tags ?? []).join(' '))
    );
    const score = 0.5 * nameScore + 0.3 * descScore + 0.2 * tagScore;
    if (score > 0) scored.push({ desc: tool, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map(({ desc, score }) => ({
    name: desc.name,
    description: desc.description,
    score,
    minimal_schema: extractMinimalSchema(desc.full_schema),
  }));
}

/**
 * Extract a minimal-schema hint from a full JSON Schema. Only top-level
 * properties + their types — enough for the model to know the call
 * shape without paying the full nested-schema context cost.
 */
export function extractMinimalSchema(
  schema: Readonly<Record<string, unknown>>
): ReadonlyArray<{ readonly key: string; readonly type: string; readonly required: boolean }> {
  const props = schema['properties'];
  if (typeof props !== 'object' || props === null) return [];
  const required = Array.isArray(schema['required']) ? new Set(schema['required'] as ReadonlyArray<string>) : new Set<string>();
  const out: Array<{ key: string; type: string; required: boolean }> = [];
  for (const [key, val] of Object.entries(props as Record<string, unknown>)) {
    let type = 'unknown';
    if (typeof val === 'object' && val !== null) {
      const t = (val as Record<string, unknown>)['type'];
      if (typeof t === 'string') type = t;
    }
    out.push({ key, type, required: required.has(key) });
  }
  return out;
}
