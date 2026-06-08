/**
 * Capability brain-tool — `mining.forecast.run`.
 *
 * Wraps `@borjie/forecast-engine` as a chat-callable `ToolHandler` so the MD
 * can emit a calibrated forecast on a turn. The engine produces a conformal,
 * floor-beating, evidence-stamped `ForecastResult`; we then APPEND it to the
 * caller's rule-based decision via the engine's `appendForecastPrediction`
 * port so the forecast is, by construction, ADVISORY — it can NEVER replace a
 * rule-based decision (CLAUDE.md: "Predictions APPEND … Never replace.").
 *
 * Rails honoured:
 *   - Evidence-required: every `ForecastResult` carries ≥1 typed evidence id;
 *     the append throws on an empty chain, and we surface the ids in
 *     `evidenceSummary` so the Auditor sees a non-empty chain.
 *   - Predictions APPEND: the result is wrapped as `mode:'append'` with the
 *     rule-based decision carried UNCHANGED under `ruleBasedDecision`.
 *   - No process.env reads — the engine is injected at bootstrap.
 *   - Immutable: the handler never mutates its inputs.
 *
 * The tool is a WRITE tool only in the sense that it produces an artifact the
 * surface may persist; it performs NO money / licence / ledger write, so it
 * never touches the HITL rails. The artifact flows to the proposal sink for
 * the surfaced (proposal-gated) UI.
 *
 * @module composition/modality-capability/forecast-tool
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import {
  appendForecastPrediction,
  type ForecastEngine,
  type ForecastRequest,
  type RuleBasedDecision,
  type AppendedForecastEnvelope,
} from '@borjie/forecast-engine';

/** The tool name registered into the brain extra-skills set. */
export const FORECAST_TOOL_NAME = 'mining.forecast.run';

/**
 * Coerce the loosely-typed tool params into a `ForecastRequest`. The engine
 * re-validates with zod (`ForecastRequestSchema.parse`) so a malformed input
 * surfaces as a typed error rather than a bad forecast.
 */
function toForecastRequest(
  params: Record<string, unknown>,
  tenantId: string | null,
): ForecastRequest {
  const target =
    typeof params['target'] === 'string'
      ? (params['target'] as string)
      : 'mining.A1.commodity_price';
  const rawSeries = params['series'];
  const values =
    rawSeries && typeof rawSeries === 'object' && Array.isArray((rawSeries as { values?: unknown }).values)
      ? ((rawSeries as { values: unknown[] }).values.filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        ))
      : Array.isArray(params['values'])
        ? (params['values'] as unknown[]).filter(
            (v): v is number => typeof v === 'number' && Number.isFinite(v),
          )
        : [];
  const seriesId =
    rawSeries && typeof rawSeries === 'object' && typeof (rawSeries as { seriesId?: unknown }).seriesId === 'string'
      ? ((rawSeries as { seriesId: string }).seriesId)
      : `${tenantId ?? 'global'}:${target}`;
  const horizon =
    typeof params['horizon'] === 'number' && Number.isFinite(params['horizon'])
      ? Math.max(1, Math.trunc(params['horizon'] as number))
      : 6;
  const seasonLength =
    rawSeries && typeof rawSeries === 'object' && typeof (rawSeries as { seasonLength?: unknown }).seasonLength === 'number'
      ? Number((rawSeries as { seasonLength: number }).seasonLength)
      : undefined;
  return {
    tenantId,
    target,
    horizon,
    series: {
      seriesId,
      values,
      ...(seasonLength ? { seasonLength } : {}),
    },
  };
}

/** Extract the rule-based decision the forecast appends to (advisory wrap). */
function toRuleBasedDecision(
  params: Record<string, unknown>,
  target: string,
): RuleBasedDecision {
  const raw = params['ruleBasedDecision'];
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    return {
      decisionId:
        typeof r['decisionId'] === 'string' ? (r['decisionId'] as string) : `${target}:advisory`,
      rule: typeof r['rule'] === 'string' ? (r['rule'] as string) : `${target}.rule`,
      decision: r['decision'] ?? null,
    };
  }
  // No rule-based decision supplied — the forecast still APPENDS to a
  // synthetic placeholder so the "never standalone authority" shape holds.
  return {
    decisionId: `${target}:advisory`,
    rule: `${target}.no_rule_supplied`,
    decision: null,
  };
}

export interface ForecastCapabilityToolDeps {
  /** The forecast engine, constructed once at bootstrap. */
  readonly engine: ForecastEngine;
}

/**
 * Build the `mining.forecast.run` ToolHandler. The engine is injected so the
 * handler stays pure of bootstrap concerns (no keys, no env). The returned
 * `data` is the FULL append envelope (rule-based decision UNCHANGED + the
 * advisory prediction) so the surface can render the calibrated interval and
 * the proposal sink can synthesize a UI for it.
 */
export function buildForecastCapabilityTool(
  deps: ForecastCapabilityToolDeps,
): ToolHandler {
  return {
    name: FORECAST_TOOL_NAME,
    description:
      'Run a calibrated, conformal time-series forecast for a mining-estate target ' +
      '(price / FX / royalty / production / demand / attrition). Returns an ADVISORY ' +
      'prediction that APPENDS to — never replaces — a rule-based decision. Every ' +
      'forecast carries a calibrated prediction interval, a beats-floor flag, and ≥1 ' +
      'evidence id.',
    parameters: {
      type: 'object',
      required: ['target', 'series'],
      properties: {
        target: {
          type: 'string',
          description:
            'Logical forecast target id, e.g. mining.A1.commodity_price, mining.A2.fx_rate, mining.A6.royalty_accrual.',
        },
        series: {
          type: 'object',
          description: 'The history to extrapolate from: { seriesId, values:number[], seasonLength? }.',
        },
        horizon: { type: 'number', description: 'Steps ahead to forecast (default 6).' },
        ruleBasedDecision: {
          type: 'object',
          description:
            'The authoritative rule-based decision the forecast appends to (advisory wrap). Optional.',
        },
      },
    },
    async execute(params, context) {
      const tenantId =
        context.tenant && typeof context.tenant.tenantId === 'string'
          ? context.tenant.tenantId
          : null;
      try {
        const request = toForecastRequest(params, tenantId);
        if (request.series.values.length === 0) {
          return {
            ok: false,
            error:
              'forecast requires a non-empty numeric series (params.series.values or params.values)',
          };
        }
        const result = await deps.engine.forecast(request);
        const decision = toRuleBasedDecision(params, request.target);
        // APPEND — the rule-based decision is carried through UNCHANGED.
        const envelope: AppendedForecastEnvelope = appendForecastPrediction(
          decision,
          result,
        );
        const evidenceIds = result.evidenceIds.map((e) => e.id);
        return {
          ok: true,
          data: {
            kind: 'forecast' as const,
            envelope,
            forecastId: result.forecastId,
            target: result.target,
            horizon: result.horizon,
            baselineBeaten: result.baselineBeaten,
            conformalCoverage: result.conformalCoverage,
            // Surface the median + calibrated interval so a UI can render
            // them without re-deriving from the points array.
            median: result.points.map((p) => p.point),
            lower: result.intervals.map((i) => i.lower),
            upper: result.intervals.map((i) => i.upper),
            evidence_ids: evidenceIds,
            authority: 'advisory' as const,
          },
          evidenceSummary: `Advisory forecast for ${result.target} (h=${result.horizon}, coverage=${(
            result.conformalCoverage * 100
          ).toFixed(0)}%, beatsFloor=${result.baselineBeaten}); evidence [${evidenceIds.join(', ')}]`,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
