/**
 * KYC risk scoring.
 *
 * Pure scoring against a set of weighted, named factors. Caller injects
 * the KYC facts (typically read from `@borjie/compliance-pack`); this
 * module never reaches out to network or DB.
 */

import type { KycFact, KycRiskReport, RiskBand } from './types.js';

interface FactorDef {
  readonly code: string;
  readonly label: string;
  readonly weight: number;
  readonly hit: (f: KycFact) => boolean;
  readonly blocking: boolean;
}

// Sanctioned/PEP/adverse-media-heavy buyers are always treated as
// high-risk and surfaced as blockers. Lighter-weight factors raise the
// numeric score without forcing a block.
const FACTORS: ReadonlyArray<FactorDef> = [
  {
    code: 'sanctions',
    label: 'Sanctions list hit',
    weight: 60,
    hit: (f) => f.sanctionsHit,
    blocking: true,
  },
  {
    code: 'pep',
    label: 'Politically Exposed Person',
    weight: 25,
    hit: (f) => f.pepFlag,
    blocking: false,
  },
  {
    code: 'adverse-media',
    label: 'Adverse media coverage',
    weight: 15,
    hit: (f) => f.adverseMediaCount >= 3,
    blocking: false,
  },
  {
    code: 'thin-history',
    label: 'Less than 2 years in business',
    weight: 10,
    hit: (f) => f.yearsInBusiness < 2,
    blocking: false,
  },
  {
    code: 'unaudited',
    label: 'No audited financials',
    weight: 8,
    hit: (f) => !f.auditedFinancials,
    blocking: false,
  },
  {
    code: 'no-trade-history',
    label: 'No completed cross-border trade history',
    weight: 6,
    hit: (f) => f.completedTradeUsd <= 0,
    blocking: false,
  },
];

const BAND_THRESHOLDS: ReadonlyArray<{ band: RiskBand; max: number }> = [
  { band: 'low', max: 20 },
  { band: 'medium', max: 50 },
  { band: 'high', max: Infinity },
];

export function scoreKyc(facts: KycFact): KycRiskReport {
  const evaluations = FACTORS.map((def) => {
    const hit = def.hit(facts);
    return {
      code: def.code,
      label: def.label,
      weight: def.weight,
      hit,
      blocking: def.blocking && hit,
    };
  });

  const score = Math.min(
    100,
    evaluations.reduce((s, e) => s + (e.hit ? e.weight : 0), 0),
  );

  const blockers = evaluations
    .filter((e) => e.blocking)
    .map((e) => e.label);

  // If any blocker hit, force high. Otherwise threshold by score.
  const band: RiskBand = blockers.length > 0
    ? 'high'
    : (BAND_THRESHOLDS.find((t) => score <= t.max)?.band ?? 'high');

  return {
    buyerId: facts.buyerId,
    tenantId: facts.tenantId,
    band,
    score,
    factors: evaluations.map((e) => ({
      code: e.code,
      label: e.label,
      weight: e.weight,
      hit: e.hit,
    })),
    blockers,
  };
}
