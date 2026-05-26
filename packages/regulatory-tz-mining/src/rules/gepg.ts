/**
 * GePG (Government electronic Payment Gateway) rules — every regulator
 * fee or royalty payment must go through a GePG-issued control number.
 *
 * See gh-issue #31: encode the regulator-specific GePG billing-codes
 * when the GePG integration contract is signed.
 */

import type { GepgControlNumber, RegulatoryRule, RuleResult } from '../types.js';

export const gepgControlNumberFreshRule: RegulatoryRule = {
  id: 'gepg.cn.freshness',
  regulator: 'gepg',
  title: 'GePG control numbers must be settled before they expire',
  citation: 'GePG Circular No. 1 of 2017 (latest revision pending — see gh-issue #31)',
  evaluate(facts): RuleResult {
    const lapsed = facts.gepgControlNumbers.filter(
      (cn) => !cn.paid && cn.expiresISO < facts.asOfISO,
    );
    if (lapsed.length > 0) {
      return result(
        'breach',
        `${lapsed.length} GePG control number(s) expired before payment.`,
        lapsed,
      );
    }
    const dueSoon = facts.gepgControlNumbers.filter(
      (cn) => !cn.paid && daysBetween(cn.expiresISO, facts.asOfISO) <= 7,
    );
    if (dueSoon.length > 0) {
      return result(
        'warning',
        `${dueSoon.length} unpaid GePG control number(s) expire within 7 days.`,
        dueSoon,
      );
    }
    if (facts.gepgControlNumbers.length === 0) {
      return result('unknown', 'No GePG control numbers supplied', []);
    }
    return result('compliant', 'All GePG control numbers handled in time.', facts.gepgControlNumbers);
  },
};

export const gepgPaymentAmountRule: RegulatoryRule = {
  id: 'gepg.cn.amount',
  regulator: 'gepg',
  title: 'GePG payments must match the control-number amount',
  citation: 'GePG Operational Manual (section pending — see gh-issue #31)',
  evaluate(facts): RuleResult {
    // We don't ingest the paid-amount per CN in the current schema —
    // mark as unknown until the LMBM extends gepgControlNumberSchema
    // to include the paid amount.
    if (facts.gepgControlNumbers.length === 0) {
      return result('unknown', 'No GePG control numbers supplied', []);
    }
    return result(
      'unknown',
      'Paid-amount field not yet ingested; extend GePG schema — see gh-issue #31.',
      facts.gepgControlNumbers,
    );
  },
};

export const GEPG_RULES: ReadonlyArray<RegulatoryRule> = [
  gepgControlNumberFreshRule,
  gepgPaymentAmountRule,
];

function result(
  verdict: RuleResult['verdict'],
  message: string,
  cns: ReadonlyArray<GepgControlNumber>,
): RuleResult {
  return {
    ruleId: 'gepg.cn.freshness',
    regulator: 'gepg',
    title: gepgControlNumberFreshRule.title,
    citation: gepgControlNumberFreshRule.citation,
    verdict,
    message,
    evidence: cns.map((cn) => ({
      id: `gepg:${cn.controlNumber}`,
      kind: 'gepg-cn',
      pointer: `gepg.${cn.controlNumber}`,
    })),
  };
}

function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (new Date(aISO).getTime() - new Date(bISO).getTime()) / (24 * 60 * 60 * 1000),
  );
}
