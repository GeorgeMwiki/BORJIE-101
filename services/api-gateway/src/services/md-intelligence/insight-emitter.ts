/**
 * Insight emitter — emit 0-3 NON-OBVIOUS insights the MD would surface.
 *
 * Hard rule (CLAUDE.md hard invariant + spec): every insight MUST be
 * grounded in real data points the resolvers returned in this turn.
 * NEVER invent statistics, NEVER hallucinate trends, NEVER fabricate
 * peer numbers. If a node returns `{status: 'awaiting data source'}`,
 * it CANNOT be cited.
 *
 * Inputs:
 *   - `domain` — the asked-about domain
 *   - `fullPicture` — the bundle of resolved sub-area statuses for the
 *     domain (from the domain-depth resolvers)
 *   - `correlations` — the result of correlate() for this turn
 *   - `comparisons` — optional comparison results keyed by metric id
 *
 * Output: 0-3 typed insights, each with a headline (sw + en), rationale,
 * suggested actions (≤ 2), confidence (0..1), and a `grounding`
 * pointer to the data points that justify the claim.
 */

import type { DomainId, SubAreaStatus } from '../domain-depth/types';
import type { CorrelationResult, TouchEdge } from './correlation-engine';
import type { ComparisonResult } from './comparison-framework';

export type InsightKind =
  | 'opportunity'
  | 'risk'
  | 'anomaly'
  | 'trend'
  | 'comparison';

export interface InsightHeadline {
  readonly en: string;
  readonly sw: string;
}

export interface InsightAction {
  readonly label: InsightHeadline;
  readonly actionId: string;
}

export interface Insight {
  readonly kind: InsightKind;
  readonly headline: InsightHeadline;
  readonly rationale: InsightHeadline;
  readonly suggestedActions: ReadonlyArray<InsightAction>;
  readonly confidence: number;
  readonly grounding: ReadonlyArray<string>;
}

export interface FullPictureEntry {
  readonly subAreaId: string;
  readonly status: SubAreaStatus;
}

export interface EmitInsightsInput {
  readonly domain: DomainId;
  readonly fullPicture: ReadonlyArray<FullPictureEntry>;
  readonly correlations?: CorrelationResult;
  readonly comparisons?: ReadonlyArray<ComparisonResult>;
  readonly limit?: number;
}

export interface EmitInsightsResult {
  readonly insights: ReadonlyArray<Insight>;
  readonly groundedDataPoints: number;
  readonly rejectedForUngrounded: number;
}

const DEFAULT_LIMIT = 3;

/**
 * Emit grounded insights. Deterministic, side-effect-free.
 *
 * The emitter does NOT call an LLM — it runs pure heuristics over the
 * resolved data and the correlation/comparison results. If an LLM is
 * needed in the future (e.g. for prose rationale), it should be wired
 * BEHIND this function with the same grounding guarantees.
 */
export function emit(input: EmitInsightsInput): EmitInsightsResult {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const grounded = input.fullPicture.filter(
    (e) => e.status.status !== 'unknown',
  );

  const candidates: Insight[] = [];

  // Risk: amber/red sub-areas surface as risks
  for (const entry of grounded) {
    if (entry.status.status === 'amber' || entry.status.status === 'red') {
      candidates.push(riskInsight(entry));
    }
  }

  // Anomaly: a comparison shows a >25% delta vs historical / peer
  for (const comparison of input.comparisons ?? []) {
    const anomaly = anomalyFromComparison(comparison);
    if (anomaly) candidates.push(anomaly);
  }

  // Opportunity: peer p25 outperforms tenant on a cost-like metric
  for (const comparison of input.comparisons ?? []) {
    const opp = opportunityFromComparison(comparison);
    if (opp) candidates.push(opp);
  }

  // Trend: comparison shows a sustained 30d vs 90d direction
  for (const comparison of input.comparisons ?? []) {
    const trend = trendFromComparison(comparison);
    if (trend) candidates.push(trend);
  }

  // Comparison: surface a high-strength cross-domain touch as a
  // composite insight (only when the touched edge has strength ≥ 0.7).
  if (input.correlations) {
    for (const touch of input.correlations.touches) {
      if (touch.strength >= 0.7) {
        candidates.push(comparisonInsight(input.domain, touch));
      }
    }
  }

  // Filter ungrounded
  const validated: Insight[] = [];
  let rejected = 0;
  for (const c of candidates) {
    if (isGrounded(c, grounded, input.comparisons ?? [])) {
      validated.push(c);
    } else {
      rejected += 1;
    }
  }

  const ranked = validated
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);

  return Object.freeze({
    insights: Object.freeze(ranked.map((i) => Object.freeze(i))),
    groundedDataPoints: grounded.length,
    rejectedForUngrounded: rejected,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Heuristic builders (small, focused, single-purpose)
// ─────────────────────────────────────────────────────────────────────

function riskInsight(entry: FullPictureEntry): Insight {
  const note = entry.status.note ?? '';
  return {
    kind: 'risk',
    headline: {
      en: `${entry.subAreaId} status ${entry.status.status}`,
      sw: `${entry.subAreaId} hali ni ${entry.status.status}`,
    },
    rationale: {
      en: `Sub-area is amber/red. ${note}`.trim(),
      sw: `Eneo dogo ni amba/nyekundu. ${note}`.trim(),
    },
    suggestedActions: [
      {
        actionId: `view_sub_area:${entry.subAreaId}`,
        label: {
          en: 'View full sub-area',
          sw: 'Tazama eneo kamili',
        },
      },
    ],
    confidence: entry.status.status === 'red' ? 0.85 : 0.65,
    grounding: [entry.subAreaId],
  };
}

function anomalyFromComparison(c: ComparisonResult): Insight | null {
  const vs30 = c.delta.vsDay30;
  if (vs30 === null) return null;
  if (Math.abs(vs30) < 0.25) return null;
  const direction = vs30 > 0 ? 'above' : 'below';
  return {
    kind: 'anomaly',
    headline: {
      en: `${c.metricId} is ${Math.round(vs30 * 100)}% ${direction} the 30-day mean`,
      sw: `${c.metricId} ni asilimia ${Math.round(vs30 * 100)} ${direction === 'above' ? 'juu' : 'chini'} ya wastani wa siku 30`,
    },
    rationale: {
      en: 'Confirm input tonnages or reconcile manual entries before submitting.',
      sw: 'Hakiki uzito wa malighafi au pitia ingizo za mikono kabla ya kuwasilisha.',
    },
    suggestedActions: [
      {
        actionId: `audit_metric:${c.metricId}`,
        label: { en: 'Audit metric inputs', sw: 'Kagua data za kipimo' },
      },
    ],
    confidence: Math.min(0.9, 0.5 + Math.abs(vs30)),
    grounding: [c.metricId],
  };
}

function opportunityFromComparison(c: ComparisonResult): Insight | null {
  const p25 = c.peer?.p25;
  if (p25 === null || p25 === undefined) return null;
  if (c.tenant <= p25) return null;
  const saving = (c.tenant - p25) / c.tenant;
  if (saving < 0.1) return null;
  return {
    kind: 'opportunity',
    headline: {
      en: `Peer p25 outperforms by ${Math.round(saving * 100)}% on ${c.metricId}`,
      sw: `Wenzako wa p25 wanafanya vyema kwa asilimia ${Math.round(saving * 100)} kwenye ${c.metricId}`,
    },
    rationale: {
      en: 'Top quartile peers operate at a meaningfully lower number. Worth a review.',
      sw: 'Wenzako wa robo ya juu wana namba ya chini zaidi. Inafaa kukagua.',
    },
    suggestedActions: [
      {
        actionId: `benchmark_review:${c.metricId}`,
        label: { en: 'Open peer benchmark', sw: 'Fungua benchmark ya wenzako' },
      },
    ],
    confidence: Math.min(0.85, 0.4 + saving),
    grounding: [c.metricId],
  };
}

function trendFromComparison(c: ComparisonResult): Insight | null {
  const v30 = c.delta.vsDay30;
  const v90 = c.delta.vsDay90;
  if (v30 === null || v90 === null) return null;
  if (Math.sign(v30) !== Math.sign(v90)) return null;
  if (Math.abs(v90) < 0.05) return null;
  const direction = v90 > 0 ? 'rising' : 'declining';
  return {
    kind: 'trend',
    headline: {
      en: `${c.metricId} sustained ${direction} over 90 days`,
      sw: `${c.metricId} imeendelea ${direction === 'rising' ? 'kupanda' : 'kushuka'} kwa siku 90`,
    },
    rationale: {
      en: 'The 30-day move agrees with the 90-day move. Treat as a trend, not a one-off.',
      sw: 'Mwelekeo wa siku 30 unakubaliana na wa siku 90. Hii ni mwelekeo, sio bahati.',
    },
    suggestedActions: [
      {
        actionId: `trend_review:${c.metricId}`,
        label: { en: 'Drill into trend', sw: 'Chimba kwenye mwelekeo' },
      },
    ],
    confidence: Math.min(0.8, 0.4 + Math.abs(v90)),
    grounding: [c.metricId],
  };
}

function comparisonInsight(domain: DomainId, touch: TouchEdge): Insight {
  return {
    kind: 'comparison',
    headline: {
      en: `${domain} state touches ${touch.touchedDomain} (${Math.round(touch.strength * 100)}% link)`,
      sw: `Hali ya ${domain} inagusana na ${touch.touchedDomain} (uhusiano wa asilimia ${Math.round(touch.strength * 100)})`,
    },
    rationale: {
      en: touch.rationale,
      sw: touch.rationale,
    },
    suggestedActions: [
      {
        actionId: `open_panel:${touch.touchedDomain}`,
        label: { en: 'Open touched domain', sw: 'Fungua eneo lililogusana' },
      },
    ],
    confidence: touch.strength,
    grounding: [touch.from, touch.to],
  };
}

function isGrounded(
  insight: Insight,
  fullPicture: ReadonlyArray<FullPictureEntry>,
  comparisons: ReadonlyArray<ComparisonResult>,
): boolean {
  if (insight.grounding.length === 0) return false;
  const knownSubAreas = new Set(fullPicture.map((e) => e.subAreaId));
  const knownMetrics = new Set(comparisons.map((c) => c.metricId));
  for (const g of insight.grounding) {
    if (!knownSubAreas.has(g) && !knownMetrics.has(g)) return false;
  }
  return true;
}
