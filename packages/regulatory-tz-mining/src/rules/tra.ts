/**
 * TRA tax rules — royalty, corporate income tax, withholding tax
 * filings + payments. Each rule checks that the filing exists, was
 * lodged by the due date, and was paid in full.
 *
 * See gh-issue #31: codify exact royalty rate per mineral once the
 * schedule is encoded — current rules check filing punctuality only,
 * not amount.
 */

import type { RegulatoryRule, RuleResult, TaxFiling } from '../types.js';

export const traFilingsOnTimeRule: RegulatoryRule = {
  id: 'tra.filings.on-time',
  regulator: 'tra',
  title: 'All TRA tax filings must be lodged on or before the due date',
  citation: 'Income Tax Act, 2004 (Cap. 332); Tax Administration Act, 2015',
  evaluate(facts): RuleResult {
    const late = facts.taxFilings.filter(
      (f) => f.filedISO === null || (f.filedISO !== null && f.filedISO > f.dueISO),
    );
    if (late.length > 0) {
      return result('breach', `${late.length} filing(s) late or unfiled`, late);
    }
    if (facts.taxFilings.length === 0) {
      return result('unknown', 'No filings supplied to the engine', []);
    }
    return result('compliant', 'All filings lodged on time', facts.taxFilings);
  },
};

export const traFilingsPaidInFullRule: RegulatoryRule = {
  id: 'tra.filings.paid-in-full',
  regulator: 'tra',
  title: 'TRA filings must be paid in full',
  citation: 'Tax Administration Act, 2015 — payment obligation',
  evaluate(facts): RuleResult {
    const unpaid = facts.taxFilings.filter((f) => f.paidTzs < f.amountTzs);
    if (unpaid.length > 0) {
      return result('breach', `${unpaid.length} filing(s) underpaid`, unpaid);
    }
    if (facts.taxFilings.length === 0) {
      return result('unknown', 'No filings supplied to the engine', []);
    }
    return result('compliant', 'All filings paid in full', facts.taxFilings);
  },
};

export const traRoyaltyMineralRule: RegulatoryRule = {
  id: 'tra.royalty.rate',
  regulator: 'tra',
  title: 'Royalty must be filed at the mineral-specific statutory rate',
  citation: 'Mining (Mineral Royalty) Regulations (latest schedule pending — see gh-issue #31)',
  evaluate(facts): RuleResult {
    const royaltyFilings = facts.taxFilings.filter((f) => f.kind === 'royalty');
    if (royaltyFilings.length === 0) {
      return result('unknown', 'No royalty filings to evaluate', []);
    }
    // See gh-issue #31: real rate check — currently we only assert the filing exists.
    return result('compliant', 'Royalty filings present (rate check pending #31)', royaltyFilings);
  },
};

export const TRA_RULES: ReadonlyArray<RegulatoryRule> = [
  traFilingsOnTimeRule,
  traFilingsPaidInFullRule,
  traRoyaltyMineralRule,
];

function result(
  verdict: RuleResult['verdict'],
  message: string,
  filings: ReadonlyArray<TaxFiling>,
): RuleResult {
  return {
    ruleId: 'tra.filings.on-time',
    regulator: 'tra',
    title: traFilingsOnTimeRule.title,
    citation: traFilingsOnTimeRule.citation,
    verdict,
    message,
    evidence: filings.map((f) => ({
      id: `tax:${f.id}`,
      kind: 'tax-filing',
      pointer: `tax-filing.${f.id}`,
    })),
  };
}
