/**
 * Tumemadini (Mining Commission) rules — Primary Mining Licence (PML),
 * Prospecting Licence (PL), Special Mining Licence (SML), and Mining
 * Licence (ML) currency + annual-fee compliance.
 *
 * TODO: expand with local-content compliance and processing-licence
 * rules once the Mining (Local Content) Regulations are encoded.
 */

import type { Licence, RegulatoryRule, RuleResult } from '../types.js';

export const tumemadiniLicenceCurrencyRule: RegulatoryRule = {
  id: 'tumemadini.licence.currency',
  regulator: 'tumemadini',
  title: 'All mining licences must be active and within their validity period',
  citation: 'Mining Act (Cap. 123), ss. 32, 41, 48 — PL / PML / ML',
  evaluate(facts): RuleResult {
    const expired = facts.licences.filter(
      (l) => l.expiresISO < facts.asOfISO || l.status !== 'active',
    );
    if (expired.length > 0) {
      return verdict('breach', `${expired.length} licence(s) expired or non-active`, expired, tumemadiniLicenceCurrencyRule);
    }
    const renewSoon = facts.licences.filter(
      (l) => daysBetween(l.expiresISO, facts.asOfISO) <= 90,
    );
    if (renewSoon.length > 0) {
      return verdict('warning', `${renewSoon.length} licence(s) expire within 90 days`, renewSoon, tumemadiniLicenceCurrencyRule);
    }
    if (facts.licences.length === 0) {
      return verdict('unknown', 'No licences supplied to the rule engine', [], tumemadiniLicenceCurrencyRule);
    }
    return verdict('compliant', 'All supplied licences are current', facts.licences, tumemadiniLicenceCurrencyRule);
  },
};

export const tumemadiniLicenceMixRule: RegulatoryRule = {
  id: 'tumemadini.licence.mix',
  regulator: 'tumemadini',
  title: 'Operation must hold the right licence class for its production volume',
  citation: 'Mining Act (Cap. 123) — PML capped, SML / ML required above threshold',
  evaluate(facts): RuleResult {
    // TODO: real PML production cap (currently rule-of-thumb 5000 t/yr).
    const pmlOnly = facts.licences.every((l) => l.kind === 'PML');
    if (pmlOnly && facts.annualProductionTonnes > 5000) {
      return verdict(
        'breach',
        `Annual production ${facts.annualProductionTonnes}t exceeds PML cap; upgrade to ML / SML.`,
        facts.licences,
        tumemadiniLicenceMixRule,
      );
    }
    return verdict('compliant', 'Licence class matches production profile.', facts.licences, tumemadiniLicenceMixRule);
  },
};

export const TUMEMADINI_RULES: ReadonlyArray<RegulatoryRule> = [
  tumemadiniLicenceCurrencyRule,
  tumemadiniLicenceMixRule,
];

function verdict(
  v: RuleResult['verdict'],
  message: string,
  licences: ReadonlyArray<Licence>,
  rule: RegulatoryRule,
): RuleResult {
  return {
    ruleId: rule.id,
    regulator: rule.regulator,
    title: rule.title,
    citation: rule.citation,
    verdict: v,
    message,
    evidence: licences.map((l) => ({
      id: `licence:${l.id}`,
      kind: 'licence',
      pointer: `licence.${l.id}`,
    })),
  };
}

function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (new Date(aISO).getTime() - new Date(bISO).getTime()) / (24 * 60 * 60 * 1000),
  );
}
