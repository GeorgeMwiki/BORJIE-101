/**
 * Risk Modeler — safety + regulatory + geological risk scoring.
 * Composite 0-100 score per category + overall.
 *
 * Writes via typed `db.insert(riskSnapshots)` (migration 0011).
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const RiskCategory = z.enum(['safety', 'regulatory', 'geological', 'financial', 'community', 'fx']);

export const RiskFactor = z.object({
  factor_key: z.string().min(1),
  category: RiskCategory,
  weight: z.number().min(0).max(1),
  raw_score_0_100: z.number().min(0).max(100),
  evidence_id: z.string().min(1),
});

export const RiskModelerInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().optional(),
  factors: z.array(RiskFactor).min(1),
  context: z
    .object({
      dormancy_score: z.number().min(0).max(100).optional(),
      ppe_compliance_pct: z.number().min(0).max(100).optional(),
      geology_score: z.number().min(0).max(1).optional(),
      usd_contracts_outstanding: z.number().int().nonnegative().optional(),
      cash_runway_days_worst: z.number().optional(),
    })
    .default({}),
});
export type RiskModelerInput = z.infer<typeof RiskModelerInputSchema>;

export const RiskModelerOutput = AuditedOutputBase.extend({
  composite_score_0_100: z.number().min(0).max(100),
  band: z.enum(['green', 'amber', 'red']),
  category_scores: z.array(
    z.object({ category: RiskCategory, score_0_100: z.number().min(0).max(100), top_drivers: z.array(z.string()) }),
  ),
  top_5_risks: z.array(z.object({ factor_key: z.string(), category: RiskCategory, severity: z.number().min(0).max(100), mitigation: z.string() })),
  recommended_escalations: z.array(z.string()),
});
export type RiskModelerOutput = z.infer<typeof RiskModelerOutput>;

export const RISK_MODELER_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Risk Modeler',
  mandate:
    'Compute a composite risk score (0-100) per category (safety / regulatory / geological / financial / community / fx) and an overall band; surface top-5 risks with mitigations.',
  tools: 'factor_query, dormancy_score_lookup, ppe_compliance_lookup, geology_score_lookup.',
  evidence:
    'Every category score MUST cite the factor_keys and evidence_ids that drove it. Composite is sum(weight * raw_score) per category, then mean across categories.',
  outputSchema:
    '{ "composite_score_0_100": number, "band": "green"|"amber"|"red", "category_scores": [...], ' +
    '"top_5_risks": [...], "recommended_escalations": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.7,
  autonomyDomain: 'scoring + recommendation; never executes mitigations directly',
  hardRules: [
    'Safety category score MUST be the maximum (not mean) of its raw factor scores — one critical control failure dominates.',
    'Red band (composite > 70) must produce at least one recommended_escalation.',
    'Always include a financial-runway factor when context.cash_runway_days_worst < 30.',
  ],
});

function buildUserPrompt(input: RiskModelerInput): string {
  return [
    `TENANT: ${input.tenantId}${input.siteId ? `  SITE: ${input.siteId}` : ''}`,
    `FACTORS (${input.factors.length}):`,
    JSON.stringify(input.factors, null, 2).slice(0, 4_000),
    `CONTEXT:`,
    JSON.stringify(input.context, null, 2),
  ].join('\n');
}

export function createRiskModeler(deps: JuniorDeps) {
  return {
    async processInput(input: RiskModelerInput): Promise<RiskModelerOutput> {
      const validated = RiskModelerInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'risk-modeler',
        schema: RiskModelerOutput,
        systemPrompt: RISK_MODELER_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      if (deps.db) {
        try {
          const schemas = await loadJuniorSchemas();
          const riskSnapshots = schemas?.riskSnapshots as unknown;
          if (riskSnapshots) {
            await deps.db
              .insert(riskSnapshots)
              .values({
                id: randomUUID(),
                tenantId: validated.tenantId,
                siteId: validated.siteId ?? null,
                compositeScore: String(output.composite_score_0_100),
                band: output.band,
                summary: output,
              })
              .onConflictDoNothing();
          }
        } catch (err) {
          deps.logger?.warn('risk-modeler: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type RiskModeler = ReturnType<typeof createRiskModeler>;

export function createDefaultRiskModeler(): RiskModeler {
  let cached: RiskModeler | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createRiskModeler(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
