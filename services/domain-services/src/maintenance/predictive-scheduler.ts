/**
 * Predictive Maintenance Scheduler (Wave 8)
 *
 * PURE-LOGIC module. No DB, no LLM, no side effects. Given a snapshot of
 * asset components, it answers:
 *   1. Which components should we inspect in the next N days, in what order?
 *   2. Which components should we replace vs. repair, given a capex budget?
 *   3. How will a given component's condition degrade over the next N days?
 *
 * WHY a deterministic model:
 *   - Reactive FAR monitoring (the existing flow) fires on an overdue date.
 *     That catches problems late. A predictive layer surfaces components that
 *     are slipping into "poor" before the due-date trigger ever runs.
 *   - Deterministic = auditable. Customer-research S7/S13 compliance demands
 *     evidence-linked decisions. LLM opacity is a liability here.
 *   - Inputs-out: same input, same output. Tenant-isolated. Immutable.
 *
 * Industry half-lives (component age vs. expected lifespan):
 *   - HVAC:        ~15 years
 *   - Plumbing:    ~40 years
 *   - Roofing:     ~20 years
 *   - Electrical:  ~30 years
 *   - Structural:  ~50 years
 *   Source: ASHRAE Service Life Handbook, BOMA asset-class tables.
 *
 * Repair-vs-replace rule of thumb:
 *   If cumulative lifetime repair cost > 50% of replacement cost AND age > 50%
 *   of expected life — replace. Below either — repair. This is the standard
 *   "50% rule" used by institutional property managers.
 */

// ============================================================================
// Types
// ============================================================================

export type ComponentCondition =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'critical';

export type ComponentCategory =
  | 'hvac'
  | 'plumbing'
  | 'roofing'
  | 'electrical'
  | 'structural'
  | 'mechanical'
  | 'other';

export type SeasonalProfile = 'dry' | 'wet' | 'neutral';

export interface PredictiveComponentInput {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly name: string;
  readonly category: ComponentCategory;
  /** ISO timestamp when the component was installed. Null = unknown. */
  readonly installedAt: string | null;
  /** Expected useful life in months. Falls back to category default if null. */
  readonly expectedLifespanMonths: number | null;
  readonly currentCondition: ComponentCondition;
  /** ISO timestamp of last inspection. Null = never inspected. */
  readonly lastInspectionAt: string | null;
  /**
   * Criticality score 1-5 (1 = cosmetic, 5 = safety-critical). Safety-critical
   * components get priority no matter their condition.
   */
  readonly criticality: 1 | 2 | 3 | 4 | 5;
  /** Estimated replacement cost in minor currency units (cents / TZS). */
  readonly replacementCostCents: number;
  /** Cumulative lifetime repair spend in minor currency units. */
  readonly cumulativeRepairCostCents: number;
}

export interface InspectionRecommendation {
  readonly componentId: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly priorityScore: number;
  readonly recommendedWithinDays: number;
  readonly rationale: readonly string[];
}

export type ReplaceVsRepairAction = 'repair' | 'replace' | 'defer';

export interface ReplacementRecommendation {
  readonly componentId: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly action: ReplaceVsRepairAction;
  readonly estimatedCostCents: number;
  /** Benefit / cost ratio. Higher = more bang per shilling. */
  readonly costBenefitRatio: number;
  readonly rationale: readonly string[];
}

export interface DegradationForecast {
  readonly componentId: string;
  readonly tenantId: string;
  readonly forwardDays: number;
  readonly startCondition: ComponentCondition;
  readonly endCondition: ComponentCondition;
  /** Fractional "condition points" lost over the horizon. 0-4 scale. */
  readonly pointsLost: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default expected lifespan in months per category.
 * Used when a component lacks an explicit `expectedLifespanMonths`.
 */
const DEFAULT_LIFESPAN_MONTHS: Record<ComponentCategory, number> = {
  hvac: 15 * 12,
  plumbing: 40 * 12,
  roofing: 20 * 12,
  electrical: 30 * 12,
  structural: 50 * 12,
  mechanical: 15 * 12,
  other: 20 * 12,
};

/**
 * Inspection cadence (days) per category — the target gap between visits
 * assuming a "good" condition. Degraded conditions shrink the window.
 */
const BASE_INSPECTION_INTERVAL_DAYS: Record<ComponentCategory, number> = {
  hvac: 90,
  plumbing: 180,
  roofing: 180,
  electrical: 365,
  structural: 365,
  mechanical: 90,
  other: 180,
};

/**
 * Numeric condition points. Higher = worse. Used to drive scoring arithmetic
 * and forecast math without branching on every condition value.
 */
const CONDITION_POINTS: Record<ComponentCondition, number> = {
  excellent: 0,
  good: 1,
  fair: 2,
  poor: 3,
  critical: 4,
};

const CONDITION_BY_POINTS: readonly ComponentCondition[] = [
  'excellent',
  'good',
  'fair',
  'poor',
  'critical',
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Return age in whole months. 0 if installedAt missing or in the future.
 * WHY: age-weighting assumes non-negative values; clamp keeps the score sane.
 */
function ageInMonths(installedAt: string | null, now: Date): number {
  if (!installedAt) return 0;
  const installed = new Date(installedAt).getTime();
  if (Number.isNaN(installed)) return 0;
  const months = (now.getTime() - installed) / (MS_PER_DAY * 30.4375);
  return months > 0 ? months : 0;
}

function daysSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  const diff = (now.getTime() - t) / MS_PER_DAY;
  return diff > 0 ? diff : 0;
}

function lifespanMonths(component: PredictiveComponentInput): number {
  return (
    component.expectedLifespanMonths ??
    DEFAULT_LIFESPAN_MONTHS[component.category]
  );
}

/**
 * Dry-season in Tanzania (Jun-Oct) stresses HVAC and mechanical systems;
 * wet-season (Mar-May, Nov) stresses roofing, structural and electrical.
 * Any other month is neutral.
 */
export function seasonalProfile(now: Date): SeasonalProfile {
  const m = now.getUTCMonth() + 1; // 1-12
  if (m >= 6 && m <= 10) return 'dry';
  if (m === 3 || m === 4 || m === 5 || m === 11) return 'wet';
  return 'neutral';
}

function seasonalBoost(
  category: ComponentCategory,
  profile: SeasonalProfile
): number {
  if (profile === 'dry' && (category === 'hvac' || category === 'mechanical')) {
    return 10;
  }
  if (
    profile === 'wet' &&
    (category === 'roofing' ||
      category === 'structural' ||
      category === 'electrical')
  ) {
    return 10;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Score a component's inspection priority on a 0-100 scale.
 *
 * Weights (WHY these weights):
 *   - Condition (0-40 pts):  current state is the dominant signal.
 *   - Age ratio (0-25 pts):  components past 50% of life need more eyes.
 *   - Inspection gap (0-15): long since last look = more risk.
 *   - Criticality (0-10):    safety-critical gets a hard floor.
 *   - Seasonal (0-10):       weather-driven stress boost.
 *
 * Pure: same (component, now) -> same score.
 */
export function scorePriority(
  component: PredictiveComponentInput,
  now: Date
): number {
  const conditionScore =
    (CONDITION_POINTS[component.currentCondition] / 4) * 40;

  const age = ageInMonths(component.installedAt, now);
  const life = lifespanMonths(component);
  const ageRatio = life > 0 ? age / life : 0;
  const ageScore = clamp(ageRatio, 0, 1.5) * (25 / 1.5);

  const gapDays = daysSince(component.lastInspectionAt, now);
  const baseInterval = BASE_INSPECTION_INTERVAL_DAYS[component.category];
  const gapRatio = Number.isFinite(gapDays) ? gapDays / baseInterval : 2;
  const gapScore = clamp(gapRatio, 0, 2) * (15 / 2);

  const criticalityScore = ((component.criticality - 1) / 4) * 10;

  const seasonalScore = seasonalBoost(
    component.category,
    seasonalProfile(now)
  );

  const total =
    conditionScore + ageScore + gapScore + criticalityScore + seasonalScore;

  return Math.round(clamp(total, 0, 100) * 100) / 100;
}

/**
 * Return prioritized inspection recommendations for components likely to need
 * attention within `horizonDays`. Components already in excellent condition
 * with fresh inspections are filtered out (noise reduction).
 *
 * Output is deterministically sorted: priority DESC, then componentId ASC
 * (stable tie-break, so identical inputs always produce identical lists).
 */
export function recommendInspections(
  components: readonly PredictiveComponentInput[],
  horizonDays: number,
  now: Date
): readonly InspectionRecommendation[] {
  const horizon = horizonDays > 0 ? horizonDays : 0;

  const scored = components.map((c) => {
    const score = scorePriority(c, now);
    const rationale = buildInspectionRationale(c, score, now);
    const withinDays = suggestedInspectionWindow(c, score, horizon);
    return {
      componentId: c.id,
      tenantId: c.tenantId,
      propertyId: c.propertyId,
      priorityScore: score,
      recommendedWithinDays: withinDays,
      rationale,
    } satisfies InspectionRecommendation;
  });

  const filtered = scored.filter((r) => shouldRecommend(r, horizon));

  return [...filtered].sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return a.componentId.localeCompare(b.componentId);
  });
}

function shouldRecommend(
  rec: InspectionRecommendation,
  horizonDays: number
): boolean {
  // Skip if the suggested window falls entirely outside the caller's horizon.
  if (rec.recommendedWithinDays > horizonDays) return false;
  // Skip truly cold components (score under 15 means excellent + recent).
  if (rec.priorityScore < 15) return false;
  return true;
}

function suggestedInspectionWindow(
  component: PredictiveComponentInput,
  priorityScore: number,
  horizonDays: number
): number {
  if (component.currentCondition === 'critical') return 1;
  if (priorityScore >= 80) return Math.min(7, horizonDays);
  if (priorityScore >= 60) return Math.min(14, horizonDays);
  if (priorityScore >= 40) return Math.min(30, horizonDays);
  return Math.min(BASE_INSPECTION_INTERVAL_DAYS[component.category], horizonDays);
}

function buildInspectionRationale(
  component: PredictiveComponentInput,
  score: number,
  now: Date
): readonly string[] {
  const reasons: string[] = [];
  if (
    component.currentCondition === 'poor' ||
    component.currentCondition === 'critical'
  ) {
    reasons.push(`condition is ${component.currentCondition}`);
  }
  const age = ageInMonths(component.installedAt, now);
  const life = lifespanMonths(component);
  if (life > 0 && age / life >= 0.5) {
    reasons.push(
      `component has reached ${Math.round((age / life) * 100)}% of expected life`
    );
  }
  const gap = daysSince(component.lastInspectionAt, now);
  if (!Number.isFinite(gap)) {
    reasons.push('component has never been inspected');
  } else if (gap > BASE_INSPECTION_INTERVAL_DAYS[component.category]) {
    reasons.push(
      `last inspection was ${Math.round(gap)} days ago (target cadence ${BASE_INSPECTION_INTERVAL_DAYS[component.category]}d)`
    );
  }
  if (component.criticality >= 4) {
    reasons.push(`safety-critical (criticality=${component.criticality})`);
  }
  const profile = seasonalProfile(now);
  if (seasonalBoost(component.category, profile) > 0) {
    reasons.push(`${profile}-season stress factor for ${component.category}`);
  }
  if (reasons.length === 0) {
    reasons.push(`routine check (priority score ${score})`);
  }
  return reasons;
}

/**
 * Decide, per component, whether to repair, replace, or defer — then pack as
 * many as the budget allows, sorted by cost-benefit ratio.
 *
 * Cost-benefit = (priority score) / (estimatedCostCents / 10000).
 * Higher ratio = more risk reduction per shilling.
 *
 * Budget is consumed greedily by ratio DESC. Components that don't fit are
 * returned with action='defer' so callers see everything considered.
 */
export function recommendReplacements(
  components: readonly PredictiveComponentInput[],
  budgetCents: number,
  now: Date
): readonly ReplacementRecommendation[] {
  const effectiveBudget = budgetCents > 0 ? budgetCents : 0;

  const evaluated = components.map((c) => evaluateAction(c, now));

  const sorted = [...evaluated].sort((a, b) => {
    if (b.costBenefitRatio !== a.costBenefitRatio) {
      return b.costBenefitRatio - a.costBenefitRatio;
    }
    return a.componentId.localeCompare(b.componentId);
  });

  let remaining = effectiveBudget;
  return sorted.map((rec) => {
    if (rec.action === 'defer') return rec;
    if (rec.estimatedCostCents <= remaining) {
      remaining = remaining - rec.estimatedCostCents;
      return rec;
    }
    return {
      ...rec,
      action: 'defer' as const,
      rationale: [...rec.rationale, 'deferred: exceeds remaining budget'],
    };
  });
}

function evaluateAction(
  component: PredictiveComponentInput,
  now: Date
): ReplacementRecommendation {
  const score = scorePriority(component, now);
  const age = ageInMonths(component.installedAt, now);
  const life = lifespanMonths(component);
  const ageRatio = life > 0 ? age / life : 0;
  const repairRatio =
    component.replacementCostCents > 0
      ? component.cumulativeRepairCostCents / component.replacementCostCents
      : 0;

  // 50% rule: replace if age past half-life AND repairs past 50% of new cost,
  // OR the component is already critical.
  const shouldReplace =
    component.currentCondition === 'critical' ||
    (ageRatio >= 0.5 && repairRatio >= 0.5);

  const shouldDefer =
    component.currentCondition === 'excellent' ||
    (component.currentCondition === 'good' && ageRatio < 0.5);

  const action: ReplaceVsRepairAction = shouldReplace
    ? 'replace'
    : shouldDefer
      ? 'defer'
      : 'repair';

  const estimatedCostCents =
    action === 'replace'
      ? component.replacementCostCents
      : action === 'repair'
        ? Math.round(component.replacementCostCents * 0.25)
        : 0;

  const costBenefitRatio =
    estimatedCostCents > 0 ? (score * 10000) / estimatedCostCents : 0;

  const rationale: string[] = [];
  if (shouldReplace) {
    rationale.push(
      `50% rule: age ${Math.round(ageRatio * 100)}% of life, repairs ${Math.round(repairRatio * 100)}% of new cost`
    );
  }
  if (component.currentCondition === 'critical') {
    rationale.push('condition is critical — immediate replacement warranted');
  }
  if (shouldDefer) {
    rationale.push(
      `defer: condition ${component.currentCondition}, age ${Math.round(ageRatio * 100)}% of life`
    );
  }
  if (!shouldReplace && !shouldDefer) {
    rationale.push(
      `repair recommended: condition ${component.currentCondition}, age ratio ${ageRatio.toFixed(2)}`
    );
  }

  return {
    componentId: component.id,
    tenantId: component.tenantId,
    propertyId: component.propertyId,
    action,
    estimatedCostCents,
    costBenefitRatio: Math.round(costBenefitRatio * 100) / 100,
    rationale,
  };
}

/**
 * Project how a component's condition will degrade over `forwardDays`.
 *
 * Model: linear decay, rate-per-day = 4 / (expected-life-days). A component
 * that runs its full expected life drops from excellent (0 pts) to critical
 * (4 pts) over that life. Age-accelerator kicks in past half-life (1.5x rate)
 * to reflect real-world non-linearity. Purely deterministic — no LLM.
 */
export function forecastConditionDegradation(
  component: PredictiveComponentInput,
  forwardDays: number,
  now: Date
): DegradationForecast {
  const days = forwardDays > 0 ? forwardDays : 0;
  const lifeDays = (lifespanMonths(component) * 365) / 12;
  const baseRate = lifeDays > 0 ? 4 / lifeDays : 0;

  const age = ageInMonths(component.installedAt, now);
  const life = lifespanMonths(component);
  const ageRatio = life > 0 ? age / life : 0;
  const accelerator = ageRatio >= 0.5 ? 1.5 : 1.0;

  const pointsLost = clamp(baseRate * days * accelerator, 0, 4);

  const startPoints = CONDITION_POINTS[component.currentCondition];
  const endPointsRaw = startPoints + pointsLost;
  const endIdx = clamp(Math.round(endPointsRaw), 0, 4);

  return {
    componentId: component.id,
    tenantId: component.tenantId,
    forwardDays: days,
    startCondition: component.currentCondition,
    endCondition: CONDITION_BY_POINTS[endIdx],
    pointsLost: Math.round(pointsLost * 10000) / 10000,
  };
}
