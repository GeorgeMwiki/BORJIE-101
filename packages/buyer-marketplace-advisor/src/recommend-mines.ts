/**
 * Mine recommendation engine.
 *
 * Scores candidate mines for a buyer's need across four dimensions:
 *   - volume capacity (can the mine deliver the requested tonnes?)
 *   - grade fit (does the mine's average grade clear the buyer's floor?)
 *   - price fit (is the indicative price within the buyer's ceiling?)
 *   - region preference (is the mine in a preferred region?)
 *
 * Pure function; no I/O.
 */

import {
  buyerNeedSchema,
  type BuyerNeed,
  type MineProfile,
  type MineRecommendation,
} from './types.js';

interface Factor {
  readonly label: string;
  readonly weight: number;
  readonly contribution: number;
}

const WEIGHT_VOLUME = 35;
const WEIGHT_GRADE = 25;
const WEIGHT_PRICE = 25;
const WEIGHT_REGION = 10;
const WEIGHT_COMPLIANCE = 5;

export function rankMines(
  rawNeed: BuyerNeed,
  mines: ReadonlyArray<MineProfile>,
): ReadonlyArray<MineRecommendation> {
  const need = buyerNeedSchema.parse(rawNeed);
  const filtered = mines.filter(
    (m) => m.tenantId === need.tenantId && m.commodity === need.commodity,
  );

  const ranked = filtered
    .map((mine) => scoreMine(need, mine))
    .filter((r): r is MineRecommendation => r !== null)
    .sort((a, b) => b.fitScore - a.fitScore);

  return ranked;
}

function scoreMine(
  need: BuyerNeed,
  mine: MineProfile,
): MineRecommendation | null {
  const factors: Factor[] = [];

  // Volume — monthly output must cover at least 25% of buyer need to
  // be considered. Past that, contribution scales linearly to 100%.
  const volumeRatio = Math.min(1, mine.monthlyOutputTonnes / need.volumeTonnes);
  if (volumeRatio < 0.25) return null;
  factors.push({
    label: 'volume-capacity',
    weight: WEIGHT_VOLUME,
    contribution: volumeRatio * WEIGHT_VOLUME,
  });

  // Grade — if buyer specified a floor, exclude when below it.
  let gradeContribution = WEIGHT_GRADE;
  if (need.minGrade !== undefined) {
    if (mine.averageGrade < need.minGrade) {
      // Hard fail: buyer cannot accept this grade. Exclude entirely.
      return null;
    }
    const ratio = Math.min(1, mine.averageGrade / (need.minGrade * 1.5));
    gradeContribution = ratio * WEIGHT_GRADE;
  }
  factors.push({
    label: 'grade-fit',
    weight: WEIGHT_GRADE,
    contribution: gradeContribution,
  });

  // Price — if buyer specified ceiling, exclude when above it.
  let priceContribution = WEIGHT_PRICE * 0.75;
  if (need.maxPriceUsdPerTonne !== undefined) {
    if (mine.indicativePriceUsdPerTonne > need.maxPriceUsdPerTonne) {
      // Hard fail: price exceeds ceiling.
      return null;
    }
    const headroom =
      1 - mine.indicativePriceUsdPerTonne / need.maxPriceUsdPerTonne;
    priceContribution = (0.75 + headroom * 0.25) * WEIGHT_PRICE;
  }
  factors.push({
    label: 'price-fit',
    weight: WEIGHT_PRICE,
    contribution: priceContribution,
  });

  // Region preference.
  let regionContribution = WEIGHT_REGION * 0.4;
  if (
    need.preferredRegions.length > 0 &&
    need.preferredRegions.includes(mine.regionId)
  ) {
    regionContribution = WEIGHT_REGION;
  } else if (need.preferredRegions.length === 0) {
    regionContribution = WEIGHT_REGION * 0.7;
  }
  factors.push({
    label: 'region-preference',
    weight: WEIGHT_REGION,
    contribution: regionContribution,
  });

  // Compliance posture — penalize medium/high risk.
  const complianceMap = { low: 1.0, medium: 0.5, high: 0.0 } as const;
  const compliancePenalty = complianceMap[mine.complianceRisk];
  factors.push({
    label: 'compliance-posture',
    weight: WEIGHT_COMPLIANCE,
    contribution: compliancePenalty * WEIGHT_COMPLIANCE,
  });

  const fitScore = factors.reduce((s, f) => s + f.contribution, 0);
  if (fitScore <= 0) return null;

  return {
    mineId: mine.id,
    mineName: mine.name,
    fitScore: Math.round(fitScore * 100) / 100,
    rationale: buildRationale(need, mine, factors),
    indicativePriceUsdPerTonne: mine.indicativePriceUsdPerTonne,
    availableTonnes: mine.monthlyOutputTonnes,
    estimatedLeadTimeDays: mine.baseLeadTimeDays,
    factors,
  };
}

function buildRationale(
  need: BuyerNeed,
  mine: MineProfile,
  factors: ReadonlyArray<Factor>,
): string {
  const top = [...factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map((f) => f.label);
  return (
    `${mine.name} ranks high for ${need.commodity} on ${top.join(', ')}. ` +
    `Monthly output ${mine.monthlyOutputTonnes.toFixed(0)}t covers ` +
    `${Math.round((mine.monthlyOutputTonnes / need.volumeTonnes) * 100)}% of ` +
    `the requested ${need.volumeTonnes.toFixed(0)}t.`
  );
}
