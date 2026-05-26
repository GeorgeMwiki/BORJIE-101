/**
 * Query classifier — pure, deterministic heuristic that picks the
 * retrieval mode for a query. No LLM call in the hot path.
 *
 * Scores the query along four axes (each clamped to 0..1):
 *
 *   - entityDensity:         capitalised tokens / total tokens
 *   - relationalKeywords:    presence of "between", "vs", "linked to",
 *                            "connected", "reports to", "via", ...
 *   - aggregationKeywords:   "summarise", "themes", "across",
 *                            "overall", "trend", "patterns", ...
 *   - specificity:           presence of digits, quoted strings,
 *                            long phrases.
 *
 * Decision matrix (deliberately simple):
 *
 *   high aggregation                  → graph_global
 *   high entity + low aggregation     → graph_local
 *   high specificity, low entity      → vector
 *   nothing dominant                  → hybrid
 *
 * Confidence is the gap between the winning axis score and the
 * second-best, clamped to [0.5, 1.0] so hybrid still says "I'm at
 * least 50% sure this is hybrid".
 */

import type {
  QueryContext,
  RetrievalMode,
  RouteDecision,
} from '../types.js';

const RELATIONAL_KEYWORDS = [
  'between',
  ' vs ',
  ' versus ',
  'linked',
  'connected',
  'reports to',
  'related to',
  'relationship',
  'via',
  'depends on',
  'caused by',
  'leads to',
];

const AGGREGATION_KEYWORDS = [
  'summarise',
  'summarize',
  'summary',
  'themes',
  'overall',
  'across',
  'overview',
  'patterns',
  'trends',
  'dominant',
  'aggregate',
];

function lower(s: string): string {
  return s.toLowerCase();
}

function tokens(s: string): ReadonlyArray<string> {
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function entityDensity(query: string): number {
  const ts = tokens(query);
  if (ts.length === 0) return 0;
  const capped = ts.filter((t) => /^[A-Z][a-zA-Z]+/.test(t)).length;
  // Density caps at 0.5 of tokens — most queries are not 100% entities.
  return clamp01(capped / Math.max(1, Math.floor(ts.length / 2)));
}

export function relationalKeywordScore(query: string): number {
  const q = lower(query);
  let hits = 0;
  for (const kw of RELATIONAL_KEYWORDS) {
    if (q.includes(kw)) hits += 1;
  }
  return clamp01(hits / 2);
}

export function aggregationKeywordScore(query: string): number {
  const q = lower(query);
  let hits = 0;
  for (const kw of AGGREGATION_KEYWORDS) {
    if (q.includes(kw)) hits += 1;
  }
  return clamp01(hits / 2);
}

export function specificityScore(query: string): number {
  const ts = tokens(query);
  if (ts.length === 0) return 0;
  let score = 0;
  if (/\d/.test(query)) score += 0.4;
  if (/"[^"]+"/.test(query)) score += 0.4;
  if (ts.length >= 12) score += 0.2;
  return clamp01(score);
}

interface AxisScores {
  readonly entityDensity: number;
  readonly relationalKeywords: number;
  readonly aggregationKeywords: number;
  readonly specificity: number;
}

function scoreQuery(query: string): AxisScores {
  return {
    entityDensity: entityDensity(query),
    relationalKeywords: relationalKeywordScore(query),
    aggregationKeywords: aggregationKeywordScore(query),
    specificity: specificityScore(query),
  };
}

interface Pick {
  readonly mode: RetrievalMode;
  readonly reason: string;
  readonly winnerScore: number;
  readonly runnerUpScore: number;
}

function pickMode(scores: AxisScores): Pick {
  const graphLocalScore =
    scores.entityDensity * 0.6 + scores.relationalKeywords * 0.4;
  const graphGlobalScore = scores.aggregationKeywords;
  const vectorScore = scores.specificity;
  const candidates = [
    { mode: 'graph_global' as RetrievalMode, score: graphGlobalScore },
    { mode: 'graph_local' as RetrievalMode, score: graphLocalScore },
    { mode: 'vector' as RetrievalMode, score: vectorScore },
  ];
  candidates.sort((a, b) => b.score - a.score);
  const first = candidates[0];
  const second = candidates[1];
  const firstScore = first?.score ?? 0;
  const secondScore = second?.score ?? 0;
  if (firstScore < 0.25) {
    return {
      mode: 'hybrid',
      reason: 'no-axis-dominant',
      winnerScore: firstScore,
      runnerUpScore: secondScore,
    };
  }
  if (first === undefined) {
    return {
      mode: 'hybrid',
      reason: 'no-axis-dominant',
      winnerScore: firstScore,
      runnerUpScore: secondScore,
    };
  }
  return {
    mode: first.mode,
    reason: `top-axis=${first.mode}@${firstScore.toFixed(2)}`,
    winnerScore: firstScore,
    runnerUpScore: secondScore,
  };
}

export function classifyQuery(
  query: string,
  ctx: QueryContext,
): RouteDecision {
  if (ctx.forceMode !== undefined) {
    return {
      mode: ctx.forceMode,
      reason: 'force-mode',
      confidence: 1,
    };
  }
  const scores = scoreQuery(query);
  const pick = pickMode(scores);
  const gap = pick.winnerScore - pick.runnerUpScore;
  const confidence = Math.max(0.5, Math.min(1, 0.5 + gap));
  return {
    mode: pick.mode,
    reason: pick.reason,
    confidence,
    scores,
  };
}
