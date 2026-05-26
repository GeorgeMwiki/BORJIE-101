/**
 * NEMC rules — EPP (Environmental Project Plan) and EIA (Environmental
 * Impact Assessment) coverage + expiry.
 *
 * See gh-issue #31: extend rule set with NEMC monitoring-report cadence,
 * audit-report cadence, and pollutant-discharge thresholds once the source
 * statutes are encoded.
 */

import type { RegulatoryRule, RuleResult } from '../types.js';

export const nemcEiaCoverageRule: RegulatoryRule = {
  id: 'nemc.eia.coverage',
  regulator: 'nemc',
  title: 'Active mining project must have current EIA / EPP cover',
  citation: 'Environmental Management Act (Cap. 191), s. 81',
  evaluate(facts): RuleResult {
    const nowISO = facts.asOfISO;
    const active = facts.eiaApprovals.filter(
      (e) => e.approvedISO <= nowISO && e.expiresISO >= nowISO,
    );
    if (active.length === 0) {
      return {
        ruleId: nemcEiaCoverageRule.id,
        regulator: 'nemc',
        title: nemcEiaCoverageRule.title,
        citation: nemcEiaCoverageRule.citation,
        verdict: 'breach',
        message: 'No current EIA / EPP approval covers the as-of date.',
        evidence: facts.eiaApprovals.map((e) => ({
          id: `eia:${e.id}`,
          kind: 'eia',
          pointer: `eia.${e.id}`,
        })),
      };
    }
    const expiringSoon = active.filter(
      (e) => daysBetween(e.expiresISO, nowISO) <= 60,
    );
    if (expiringSoon.length > 0) {
      return {
        ruleId: nemcEiaCoverageRule.id,
        regulator: 'nemc',
        title: nemcEiaCoverageRule.title,
        citation: nemcEiaCoverageRule.citation,
        verdict: 'warning',
        message: `EIA / EPP expires within 60 days (${expiringSoon[0]?.expiresISO}).`,
        evidence: expiringSoon.map((e) => ({
          id: `eia:${e.id}`,
          kind: 'eia',
          pointer: `eia.${e.id}`,
        })),
      };
    }
    return {
      ruleId: nemcEiaCoverageRule.id,
      regulator: 'nemc',
      title: nemcEiaCoverageRule.title,
      citation: nemcEiaCoverageRule.citation,
      verdict: 'compliant',
      message: 'Current EIA / EPP cover is in place.',
      evidence: active.map((e) => ({
        id: `eia:${e.id}`,
        kind: 'eia',
        pointer: `eia.${e.id}`,
      })),
    };
  },
};

export const NEMC_RULES: ReadonlyArray<RegulatoryRule> = [nemcEiaCoverageRule];

function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (new Date(aISO).getTime() - new Date(bISO).getTime()) / (24 * 60 * 60 * 1000),
  );
}
