/**
 * Insight engine \u2014 evaluate, filter, prioritise.
 *
 * Evaluates all rules against the session context, deduplicates, respects
 * per-session rate limits and category-level cooldowns, returns the top N
 * insights for delivery. All pure functions.
 */

import { INSIGHT_RULES } from './insight-rules.js';
import type {
  InsightContext,
  InsightPriority,
  ProactiveInsight,
  SessionInsightState,
} from './types.js';

const MAX_INSIGHTS_PER_SESSION = 3;
const MAX_CRITICAL_PER_DAY = 1;
const DISMISSAL_COOLDOWN_HOURS = 24;
const MIN_INSIGHT_INTERVAL_SECONDS = 30;

const PRIORITY_WEIGHTS: Readonly<Record<InsightPriority, number>> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

export function evaluateInsights(
  context: InsightContext,
): readonly ProactiveInsight[] {
  const out: ProactiveInsight[] = [];
  for (const rule of INSIGHT_RULES) {
    try {
      const result = rule.evaluate(context);
      if (result) out.push(result);
    } catch {
      // rule errors silently skipped \u2014 one bad rule must never break others
    }
  }
  return out;
}

export function prioritise(
  insights: readonly ProactiveInsight[],
  max = MAX_INSIGHTS_PER_SESSION,
): readonly ProactiveInsight[] {
  return [...insights]
    .sort(
      (a, b) => PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority],
    )
    .slice(0, max);
}

export function shouldShow(
  insight: ProactiveInsight,
  session: SessionInsightState,
  now: Date,
): boolean {
  if (session.shownInsightIds.includes(insight.id)) return false;
  if (session.dismissedInsightIds.includes(insight.id)) return false;
  if (session.insightsShownThisSession >= MAX_INSIGHTS_PER_SESSION) return false;
  if (
    insight.priority === 'critical' &&
    session.criticalInsightsShownToday >= MAX_CRITICAL_PER_DAY
  ) {
    return false;
  }
  const cooldown = session.dismissedCategories.find(
    (d) => d.category === insight.category,
  );
  if (cooldown) {
    const hours =
      (now.getTime() - new Date(cooldown.dismissedAt).getTime()) /
      (60 * 60 * 1000);
    if (hours < DISMISSAL_COOLDOWN_HOURS) return false;
  }
  if (session.lastInsightShownAt) {
    const seconds =
      (now.getTime() - new Date(session.lastInsightShownAt).getTime()) / 1000;
    if (seconds < MIN_INSIGHT_INTERVAL_SECONDS) return false;
  }
  if (insight.expiresAt && new Date(insight.expiresAt).getTime() < now.getTime()) {
    return false;
  }
  return true;
}

export function filterShowable(
  insights: readonly ProactiveInsight[],
  session: SessionInsightState,
  now: Date,
): readonly ProactiveInsight[] {
  return insights.filter((i) => shouldShow(i, session, now));
}

export function getProactiveInsights(
  context: InsightContext,
  session: SessionInsightState,
  now: Date = new Date(),
): readonly ProactiveInsight[] {
  const all = evaluateInsights(context);
  const showable = filterShowable(all, session, now);
  return prioritise(showable);
}
