/**
 * Forecast Modeler — production forecasts, cash forecasts, scenario
 * simulation. Pure quantitative — feeds the Daily Owner Brief, Weekly
 * Strategy Memo, and Investor Pack.
 *
 * Schema gap: `forecasts` raw SQL; TODO(#30).
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const ForecastKind = z.enum(['production', 'cash', 'cost', 'revenue', 'fx_exposure']);

export const ForecastModelerInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().optional(),
  kind: ForecastKind,
  horizon_days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
  historical_series: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number() }))
    .min(7, 'need at least 7 days of history'),
  exogenous_inputs: z
    .object({
      bot_rate_tzs_per_usd: z.number().positive().optional(),
      lbma_au_usd_per_oz: z.number().positive().optional(),
      lme_cu_usd_per_t: z.number().positive().optional(),
      rainfall_mm_forecast_30d: z.number().nonnegative().optional(),
    })
    .default({}),
  scenarios: z.array(z.enum(['best', 'base', 'worst'])).default(['best', 'base', 'worst']),
});
export type ForecastModelerInput = z.infer<typeof ForecastModelerInputSchema>;

export const ScenarioSeries = z.object({
  scenario: z.enum(['best', 'base', 'worst']),
  points: z.array(z.object({ date: z.string(), value: z.number() })),
  cumulative: z.number(),
});

export const ForecastModelerOutput = AuditedOutputBase.extend({
  kind: ForecastKind,
  horizon_days: z.number().int().positive(),
  formula: z.string().min(1),
  series_by_scenario: z.array(ScenarioSeries).min(1),
  inputs_used: z.array(z.string()),
  caveats: z.array(z.string()),
});
export type ForecastModelerOutput = z.infer<typeof ForecastModelerOutput>;

export const FORECAST_MODELER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Forecast Modeler',
  mandate:
    'Produce best / base / worst scenarios for production, cash, cost, revenue, or FX exposure over a 7/30/90/180/365 day horizon. Always declare the formula + inputs used.',
  tools: 'historical_series_query, exogenous_feed_lookup, monte_carlo_simulate.',
  evidence:
    'Cite each historical_series date entry and each exogenous feed source. Calculated forecasts MUST include the formula and the inputs (AGENT_PROMPT_LIBRARY §0).',
  outputSchema:
    '{ "kind": ForecastKind, "horizon_days": int, "formula": string, "series_by_scenario": [...], ' +
    '"inputs_used": string[], "caveats": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'forecasting only; outputs are advisory and feed report-writer',
  hardRules: [
    'Always emit best/base/worst (never single-point) unless the user explicitly restricts.',
    'Never extrapolate beyond 365 days without an explicit "speculative" caveat.',
    'Cash forecast MUST account for known committed AP/AR obligations from the cost engineer feed.',
  ],
});

function buildUserPrompt(input: ForecastModelerInput): string {
  return [
    `TENANT: ${input.tenantId}  KIND: ${input.kind}  HORIZON_DAYS: ${input.horizon_days}`,
    input.siteId ? `SITE: ${input.siteId}` : '',
    `HISTORICAL_SERIES (${input.historical_series.length} points):`,
    JSON.stringify(input.historical_series).slice(0, 3_000),
    `EXOGENOUS:`,
    JSON.stringify(input.exogenous_inputs, null, 2),
    `SCENARIOS: ${JSON.stringify(input.scenarios)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function createForecastModeler(deps: JuniorDeps) {
  return {
    async processInput(input: ForecastModelerInput): Promise<ForecastModelerOutput> {
      const validated = ForecastModelerInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'forecast-modeler',
        schema: ForecastModelerOutput,
        systemPrompt: FORECAST_MODELER_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 3500,
      });

      if (deps.db) {
        try {
          const { sql } = await import('drizzle-orm');
          const summary = JSON.stringify(output);
          // TODO(#30): typed insert against `forecasts`.
          await deps.db.execute(
            sql`INSERT INTO forecasts
                  (id, tenant_id, site_id, kind, horizon_days, summary, computed_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.siteId ?? null},
                        ${validated.kind}, ${validated.horizon_days},
                        ${summary}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('forecast-modeler: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type ForecastModeler = ReturnType<typeof createForecastModeler>;

export function createDefaultForecastModeler(): ForecastModeler {
  let cached: ForecastModeler | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createForecastModeler(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
