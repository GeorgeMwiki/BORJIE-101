/**
 * Tanzania mining regulator adapter — orchestrates the per-regulator
 * rule sets, returns a structured RegulatoryAnalysis, and derives
 * prioritised remediation recommendations.
 */

import {
  regulatoryFactsSchema,
  regulatoryRecommendationContextSchema,
  type RegulatoryAnalysis,
  type RegulatoryFacts,
  type RegulatoryRecommendation,
  type RegulatoryRecommendationContext,
  type RegulatoryRule,
  type RuleResult,
  type Verdict,
} from './types.js';
import { NEMC_RULES } from './rules/nemc.js';
import { TUMEMADINI_RULES } from './rules/tumemadini.js';
import { BOT_RULES } from './rules/bot.js';
import { TRA_RULES } from './rules/tra.js';
import { GEPG_RULES } from './rules/gepg.js';
import { NOOP_LOGGER, type Logger } from './ports.js';

export interface RegulatoryAdvisorDeps {
  readonly logger?: Logger;
  /** Override rule set — useful for tests or per-region tailoring. */
  readonly rules?: ReadonlyArray<RegulatoryRule>;
}

export interface RegulatoryAdvisor {
  analyze(facts: RegulatoryFacts): Promise<RegulatoryAnalysis>;
  recommend(
    context: RegulatoryRecommendationContext,
  ): Promise<ReadonlyArray<RegulatoryRecommendation>>;
}

export const DEFAULT_RULES: ReadonlyArray<RegulatoryRule> = [
  ...NEMC_RULES,
  ...TUMEMADINI_RULES,
  ...BOT_RULES,
  ...TRA_RULES,
  ...GEPG_RULES,
];

export function createRegulatoryTzAdvisor(
  deps: RegulatoryAdvisorDeps = {},
): RegulatoryAdvisor {
  const logger = deps.logger ?? NOOP_LOGGER;
  const rules = deps.rules ?? DEFAULT_RULES;
  return {
    async analyze(rawFacts) {
      const facts = regulatoryFactsSchema.parse(rawFacts);
      logger.info('regulatory-tz.analyze.start', {
        rules: rules.length,
        asOfISO: facts.asOfISO,
      });
      const results = rules.map((r) => r.evaluate(facts));
      const summary = summariseResults(results);
      const analysis: RegulatoryAnalysis = {
        asOfISO: facts.asOfISO,
        results,
        summary,
        computedAtISO: new Date().toISOString(),
      };
      logger.info('regulatory-tz.analyze.done', summary);
      return analysis;
    },
    async recommend(rawContext) {
      const context = regulatoryRecommendationContextSchema.parse(rawContext);
      const recs = deriveRecommendations(context);
      logger.info('regulatory-tz.recommend.done', { count: recs.length });
      return recs;
    },
  };
}

function summariseResults(results: ReadonlyArray<RuleResult>): {
  compliantCount: number;
  warningCount: number;
  breachCount: number;
  unknownCount: number;
} {
  const counters: Record<Verdict, number> = {
    compliant: 0,
    warning: 0,
    breach: 0,
    unknown: 0,
  };
  for (const r of results) counters[r.verdict]++;
  return {
    compliantCount: counters.compliant,
    warningCount: counters.warning,
    breachCount: counters.breach,
    unknownCount: counters.unknown,
  };
}

export function deriveRecommendations(
  context: RegulatoryRecommendationContext,
): ReadonlyArray<RegulatoryRecommendation> {
  const out: RegulatoryRecommendation[] = [];
  for (const r of context.analysis.results) {
    if (r.verdict === 'breach' || r.verdict === 'warning') {
      out.push({
        id: `remediate.${r.ruleId}`,
        ruleId: r.ruleId,
        title: `Remediate: ${r.title}`,
        rationale: r.message,
        severity: r.verdict === 'breach' ? 'critical' : 'high',
        evidence:
          r.evidence.length > 0
            ? r.evidence
            : [{ id: `fact:${r.ruleId}`, kind: 'fact', pointer: `rule.${r.ruleId}` }],
      });
    }
  }
  return out;
}
