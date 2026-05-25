/**
 * Piece O — Signal aggregator.
 *
 * Reads `tab_spawn_signals` rows for a tenant over a lookback window,
 * groups them by (user_id, suggested_module_template_id), and scores
 * each group with a half-life decay so older signals contribute less.
 *
 * Pure function: takes already-fetched signal rows + a config and
 * returns sorted `AggregatedScore` entries. The cron file does the IO.
 *
 * The decay function:
 *   weighted = signal.weight * 2 ^ (-ageDays / halfLifeDays)
 *
 * Choosing 2 over e makes the half-life literal: at exactly halfLife,
 * a signal contributes half its weight, regardless of irrational-
 * exponent rounding.
 */

import type {
  AggregatedScore,
  ModuleTemplateId,
  SignalRow,
} from './types.js';

/**
 * Aggregator options. `now` is injected for determinism in tests.
 */
export interface AggregateSignalsOptions {
  readonly now: Date;
  readonly halfLifeDays: number;
  readonly lookbackDays: number;
  /** Drop entries whose score falls below this floor. Default 0.01. */
  readonly minScore?: number;
  /** Max signals to keep in `contributingSignalIds`. Default 20. */
  readonly maxContributingIds?: number;
}

const DEFAULT_MIN_SCORE = 0.01;
const DEFAULT_MAX_CONTRIBUTING_IDS = 20;

/**
 * Group signals by `(userId, suggestedModuleTemplateId)`, apply
 * half-life decay, return sorted aggregations. Signals with NULL
 * suggested_module_template_id are skipped (they're observational
 * only — not module-voting).
 *
 * @param signals    Already-fetched signal rows from migration 0261.
 * @param options    Time/decay/threshold knobs.
 * @returns Aggregated scores sorted by score desc, then userId asc,
 *          then module id asc (deterministic).
 */
export function aggregateSignals(
  signals: readonly SignalRow[],
  options: AggregateSignalsOptions,
): readonly AggregatedScore[] {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const maxIds = options.maxContributingIds ?? DEFAULT_MAX_CONTRIBUTING_IDS;
  const halfLife = Math.max(0.001, options.halfLifeDays);
  const nowMs = options.now.getTime();
  const lookbackMs = options.lookbackDays * 24 * 60 * 60 * 1000;
  const cutoffMs = nowMs - lookbackMs;

  // Bucket → score + signal ids.
  const buckets = new Map<
    string,
    {
      tenantId: string;
      userId: string;
      suggestedModuleTemplateId: ModuleTemplateId;
      score: number;
      ids: { id: string; weighted: number }[];
    }
  >();

  for (const signal of signals) {
    if (!signal.suggestedModuleTemplateId) continue;
    const createdMs = signal.createdAt.getTime();
    if (Number.isNaN(createdMs)) continue;
    if (createdMs < cutoffMs) continue;
    // Future-dated rows would otherwise yield negative ageDays → boost.
    // Clamp ageDays to 0.
    const ageDays = Math.max(0, (nowMs - createdMs) / (24 * 60 * 60 * 1000));
    const weighted = signal.weight * Math.pow(2, -ageDays / halfLife);
    if (!Number.isFinite(weighted) || weighted <= 0) continue;

    const key = `${signal.tenantId}::${signal.userId}::${signal.suggestedModuleTemplateId}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        tenantId: signal.tenantId,
        userId: signal.userId,
        suggestedModuleTemplateId: signal.suggestedModuleTemplateId,
        score: weighted,
        ids: [{ id: signal.id, weighted }],
      });
    } else {
      existing.score += weighted;
      existing.ids.push({ id: signal.id, weighted });
    }
  }

  // Materialise + filter + sort.
  const out: AggregatedScore[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.score < minScore) continue;
    // Take top-N contributing ids by weighted score desc.
    const sortedIds = [...bucket.ids]
      .sort((a, b) => {
        if (b.weighted !== a.weighted) return b.weighted - a.weighted;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .slice(0, maxIds)
      .map((it) => it.id);
    out.push({
      tenantId: bucket.tenantId,
      userId: bucket.userId,
      suggestedModuleTemplateId: bucket.suggestedModuleTemplateId,
      score: Math.round(bucket.score * 100) / 100,
      contributingSignalIds: Object.freeze(sortedIds),
    });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
    if (a.suggestedModuleTemplateId !== b.suggestedModuleTemplateId) {
      return a.suggestedModuleTemplateId < b.suggestedModuleTemplateId ? -1 : 1;
    }
    return 0;
  });

  return Object.freeze(out);
}

/**
 * Convenience: filter aggregations to those that meet the proposal
 * threshold. Pure.
 */
export function filterAboveThreshold(
  scores: readonly AggregatedScore[],
  threshold: number,
): readonly AggregatedScore[] {
  return scores.filter((s) => s.score >= threshold);
}
