/**
 * Vendor Score Calculator — SCAFFOLDED 9
 *
 * Deterministic vendor scoring. Returns a 0–100 composite score plus the
 * per-factor subscores that went into it, so the narration layer (powered
 * by Anthropic in `vendor-matcher.ts`) can speak truthfully about WHY a
 * vendor ranked where it did.
 *
 * Weights (sum to 1.0):
 *   skill:          0.30  — overlap between the work order's required
 *                            skills and the vendor's specialties.
 *   responsiveness: 0.20  — inverse of `averageResponseTimeHours`,
 *                            capped at 24h.
 *   quality:        0.25  — `ratings.quality` (0–5) scaled to 0–1.
 *   onTime:         0.15  — `metrics.onTimeCompletionPct` (0–100)
 *                            scaled to 0–1.
 *   cost:           0.10  — cost competitiveness relative to the
 *                            budget midpoint (if provided) or to the
 *                            cohort median.
 *
 * The calculator is pure and monotonic in each input — improving any one
 * subscore without degrading another cannot produce a LOWER composite,
 * which matters for the rating-worker unit tests.
 */

export interface WorkOrderSignal {
  requiredSkills: string[];
  emergency: boolean;
  serviceArea?: string;
  budgetMidpoint?: number;
}

export interface VendorSignal {
  id: string;
  specialties: string[];
  serviceAreas: string[];
  averageResponseTimeHours: number;
  ratings: { overall: number; quality: number; communication: number; value: number };
  onTimeCompletionPct: number;
  hourlyRate: number | null;
  emergencyAvailable: boolean;
}

export interface SubScores {
  skill: number;
  responsiveness: number;
  quality: number;
  onTime: number;
  cost: number;
}

export interface ScoreResult {
  vendorId: string;
  composite: number; // 0..100
  subScores: SubScores; // each 0..1
  reasons: string[];
  concerns: string[];
}

export const DEFAULT_WEIGHTS = {
  skill: 0.3,
  responsiveness: 0.2,
  quality: 0.25,
  onTime: 0.15,
  cost: 0.1,
} as const;

const RESPONSE_TIME_CAP_HOURS = 24;

// ---------------------------------------------------------------------------
// Subscore helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function scoreSkillOverlap(
  required: string[],
  vendorSpecialties: string[]
): number {
  if (required.length === 0) return 1; // nothing demanded → perfect match
  const set = new Set(vendorSpecialties.map((s) => s.toLowerCase()));
  const hits = required.filter((r) => set.has(r.toLowerCase())).length;
  return clamp01(hits / required.length);
}

export function scoreResponsiveness(avgResponseHours: number): number {
  if (avgResponseHours <= 0) return 1;
  if (avgResponseHours >= RESPONSE_TIME_CAP_HOURS) return 0;
  return clamp01(1 - avgResponseHours / RESPONSE_TIME_CAP_HOURS);
}

export function scoreQuality(quality0to5: number): number {
  return clamp01(quality0to5 / 5);
}

export function scoreOnTime(pct0to100: number): number {
  return clamp01(pct0to100 / 100);
}

/**
 * Cost subscore: "closer to the budget midpoint is better, but going
 * UNDER the budget is always at least as good as matching it exactly."
 * If no budget is provided we return 0.5 so vendors are neither rewarded
 * nor penalised on cost.
 */
export function scoreCost(
  vendorHourlyRate: number | null,
  budgetMidpoint?: number
): number {
  if (vendorHourlyRate === null || vendorHourlyRate <= 0) return 0.5;
  if (!budgetMidpoint || budgetMidpoint <= 0) return 0.5;

  if (vendorHourlyRate <= budgetMidpoint) return 1;
  // Above budget: linear drop off — at 2x budget, score is 0.
  const overage = vendorHourlyRate / budgetMidpoint - 1;
  return clamp01(1 - overage);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function calculateVendorScore(
  workOrder: WorkOrderSignal,
  vendor: VendorSignal,
  weights: typeof DEFAULT_WEIGHTS = DEFAULT_WEIGHTS
): ScoreResult {
  const subScores: SubScores = {
    skill: scoreSkillOverlap(workOrder.requiredSkills, vendor.specialties),
    responsiveness: scoreResponsiveness(vendor.averageResponseTimeHours),
    quality: scoreQuality(vendor.ratings.quality),
    onTime: scoreOnTime(vendor.onTimeCompletionPct),
    cost: scoreCost(vendor.hourlyRate, workOrder.budgetMidpoint),
  };

  const raw =
    subScores.skill * weights.skill +
    subScores.responsiveness * weights.responsiveness +
    subScores.quality * weights.quality +
    subScores.onTime * weights.onTime +
    subScores.cost * weights.cost;

  const composite = Math.round(raw * 1000) / 10; // 0..100 with one decimal

  const reasons: string[] = [];
  const concerns: string[] = [];

  if (subScores.skill >= 0.8) reasons.push('Strong specialty match for required skills');
  else if (subScores.skill < 0.5) concerns.push('Partial specialty match for required skills');

  if (subScores.responsiveness >= 0.8) reasons.push('Consistently fast response time');
  else if (subScores.responsiveness < 0.4) concerns.push('Slow historical response time');

  if (subScores.quality >= 0.8) reasons.push('High customer quality rating');
  else if (subScores.quality < 0.5) concerns.push('Below-average quality rating');

  if (subScores.onTime >= 0.85) reasons.push('Reliable on-time completion');
  else if (subScores.onTime < 0.6) concerns.push('Missed SLAs in recent history');

  if (workOrder.emergency && !vendor.emergencyAvailable) {
    concerns.push('Vendor does not offer emergency availability');
  }

  return {
    vendorId: vendor.id,
    composite,
    subScores,
    reasons,
    concerns,
  };
}

/**
 * Score a batch of vendors against a single work order, sorted by
 * descending composite.
 */
export function rankVendors(
  workOrder: WorkOrderSignal,
  vendors: VendorSignal[],
  weights?: typeof DEFAULT_WEIGHTS
): ScoreResult[] {
  return vendors
    .map((v) => calculateVendorScore(workOrder, v, weights))
    .sort((a, b) => b.composite - a.composite);
}
