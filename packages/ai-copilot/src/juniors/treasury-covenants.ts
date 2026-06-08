/**
 * Treasury covenants + hedging stance — DETERMINISTIC project-finance math.
 *
 * Pure, side-effect-free functions implementing the lender-coverage and
 * reserve-tail discipline from
 * `Docs/research/mining-estate-operating-model.md` §7.2:
 *   - DSCR  ≥ ~1.5x   (period cash flow vs debt service)
 *   - LLCR  1.7–2.0x  (NPV of cash flow over loan life vs debt outstanding)
 *   - PLCR  > 2.0x    (NPV of cash flow over project life vs debt outstanding)
 *   - reserve-tail ratio ≥ 30 % at final repayment (mine outlives the loan)
 *   - DSRA covers shortfalls when DSCR dips below 1.0x
 *   - Equator Principles / IFC PS E&S gate (§7.3) surfaced as a flag.
 *
 * Plus a board-policy-bounded hedging stance (§5.4): the hedge book
 * protects committed debt service / capex against price falls while
 * preserving upside — never speculative.
 *
 * MONEY MATH NOTE: these functions only ADVISE. No covenant computation,
 * DSRA top-up, or hedge here moves money. Any funding of a DSRA, hedge
 * margin call, or debt-service payment must route through
 * `LedgerService.post()` (double-entry, SoD: proposer != approver !=
 * recorder) — never a direct write.
 *
 * Currency-agnostic: all amounts are in a single caller-supplied currency
 * code; this module never hard-codes TZS/USD. Ratios are unitless.
 */

// ─────────────────────────────────────────────────────────────────────
// Covenant thresholds (dossier §7.2 — defaults; overridable per facility)
// ─────────────────────────────────────────────────────────────────────

export interface CovenantThresholds {
  readonly dscr_min: number;
  readonly llcr_min: number;
  readonly plcr_min: number;
  readonly reserve_tail_min_pct: number;
}

export const DEFAULT_COVENANT_THRESHOLDS: CovenantThresholds = {
  dscr_min: 1.5,
  llcr_min: 1.7,
  plcr_min: 2.0,
  reserve_tail_min_pct: 30,
};

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

export interface CovenantInputs {
  /** Cash flow available for debt service this period (CFADS). */
  readonly cfads_period: number;
  /** Total debt service this period (principal + interest). */
  readonly debt_service_period: number;
  /** NPV of CFADS over the remaining loan life (for LLCR). */
  readonly npv_cfads_loan_life: number;
  /** NPV of CFADS over the remaining project life (for PLCR). */
  readonly npv_cfads_project_life: number;
  /** Senior debt currently outstanding. */
  readonly debt_outstanding: number;
  /** Reserves remaining at the loan's final-repayment date. */
  readonly reserves_at_final_repayment: number;
  /** Total proven+probable reserves at financial close. */
  readonly total_reserves: number;
  /** Cash currently sitting in the Debt Service Reserve Account. */
  readonly dsra_balance: number;
  /**
   * Months of forward debt service the DSRA must cover (typical: 6).
   * The required DSRA balance = (debt_service_period / period_months) ×
   * dsra_required_months, approximated as debt_service_period ×
   * (dsra_required_months / period_months).
   */
  readonly dsra_required_months?: number;
  readonly period_months?: number;
  /** Whether the facility has passed the Equator Principles / IFC PS gate. */
  readonly equator_principles_cleared?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Outputs
// ─────────────────────────────────────────────────────────────────────

export type CovenantStatus = 'pass' | 'breach';

export interface RatioResult {
  readonly value: number;
  readonly threshold: number;
  readonly status: CovenantStatus;
  readonly headroom: number;
}

export interface DsraResult {
  readonly balance: number;
  readonly required: number;
  readonly shortfall: number;
  readonly status: CovenantStatus;
}

export interface CovenantAssessment {
  readonly dscr: RatioResult;
  readonly llcr: RatioResult;
  readonly plcr: RatioResult;
  readonly reserve_tail: RatioResult;
  readonly dsra: DsraResult;
  readonly es_gate_cleared: boolean;
  readonly any_breach: boolean;
  readonly breaches: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ratio with a guarded denominator; a higher value is better. */
function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return numerator > 0 ? Number.POSITIVE_INFINITY : 0;
  return numerator / denominator;
}

function gradeRatio(value: number, threshold: number): RatioResult {
  const v = Number.isFinite(value) ? round3(value) : value;
  return {
    value: v,
    threshold,
    status: value >= threshold ? 'pass' : 'breach',
    headroom: Number.isFinite(value) ? round3(value - threshold) : Number.POSITIVE_INFINITY,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Main engine — DETERMINISTIC covenant assessment
// ─────────────────────────────────────────────────────────────────────

export function assessCovenants(
  input: CovenantInputs,
  thresholds: CovenantThresholds = DEFAULT_COVENANT_THRESHOLDS,
): CovenantAssessment {
  const dscr = gradeRatio(
    safeRatio(input.cfads_period, input.debt_service_period),
    thresholds.dscr_min,
  );
  const llcr = gradeRatio(
    safeRatio(input.npv_cfads_loan_life, input.debt_outstanding),
    thresholds.llcr_min,
  );
  const plcr = gradeRatio(
    safeRatio(input.npv_cfads_project_life, input.debt_outstanding),
    thresholds.plcr_min,
  );

  const reserveTailPct =
    input.total_reserves > 0
      ? (input.reserves_at_final_repayment / input.total_reserves) * 100
      : 0;
  const reserveTail = gradeRatio(reserveTailPct, thresholds.reserve_tail_min_pct);

  const periodMonths = input.period_months ?? 12;
  const requiredMonths = input.dsra_required_months ?? 6;
  const dsraRequired = round2(
    input.debt_service_period * (requiredMonths / periodMonths),
  );
  const dsraShortfall = Math.max(0, dsraRequired - input.dsra_balance);
  const dsra: DsraResult = {
    balance: round2(input.dsra_balance),
    required: dsraRequired,
    shortfall: round2(dsraShortfall),
    status: dsraShortfall > 0 ? 'breach' : 'pass',
  };

  const breaches: string[] = [];
  if (dscr.status === 'breach') breaches.push('dscr');
  if (llcr.status === 'breach') breaches.push('llcr');
  if (plcr.status === 'breach') breaches.push('plcr');
  if (reserveTail.status === 'breach') breaches.push('reserve_tail');
  if (dsra.status === 'breach') breaches.push('dsra');

  const esGate = input.equator_principles_cleared ?? false;

  return {
    dscr,
    llcr,
    plcr,
    reserve_tail: reserveTail,
    dsra,
    es_gate_cleared: esGate,
    any_breach: breaches.length > 0,
    breaches,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Hedging stance (dossier §5.4) — operational hedges only, never spec
// ─────────────────────────────────────────────────────────────────────

export interface HedgingInputs {
  /**
   * Committed cash outflow that MUST be protected (debt service +
   * committed sustaining capex over the policy horizon).
   */
  readonly committed_outflow: number;
  /** Expected unhedged revenue exposed to commodity price over the horizon. */
  readonly exposed_revenue: number;
  /** Notional already hedged (forwards/collars/options) over the horizon. */
  readonly already_hedged_notional: number;
  /** Board-policy ceiling on the hedge ratio (0..1), e.g. 0.50 = 50 % cap. */
  readonly board_max_hedge_ratio: number;
  /** DSCR right now — drives how aggressively to lock in downside cover. */
  readonly current_dscr: number;
  readonly dscr_min?: number;
}

export type HedgeStance = 'increase_cover' | 'hold' | 'reduce_cover' | 'no_action';

export interface HedgingRecommendation {
  readonly target_hedge_ratio: number;
  readonly current_hedge_ratio: number;
  readonly recommended_incremental_notional: number;
  readonly stance: HedgeStance;
  readonly board_cap_respected: boolean;
  readonly instruments_suggested: ReadonlyArray<string>;
  readonly rationale: string;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Recommend a hedge stance bounded by the board-approved policy ceiling.
 *
 * Principle (dossier §5.4): cover committed debt service / capex against
 * price falls while preserving upside — never speculate. The natural
 * target hedge ratio = committed_outflow / exposed_revenue, capped by
 * the board policy. When DSCR is thin we lean toward downside-only
 * instruments (puts / zero-cost collars) so upside is preserved.
 */
export function recommendHedgeStance(input: HedgingInputs): HedgingRecommendation {
  const dscrMin = input.dscr_min ?? DEFAULT_COVENANT_THRESHOLDS.dscr_min;
  const naturalTarget =
    input.exposed_revenue > 0 ? input.committed_outflow / input.exposed_revenue : 0;
  const targetRatio = clamp01(Math.min(naturalTarget, input.board_max_hedge_ratio));

  const currentRatio =
    input.exposed_revenue > 0
      ? clamp01(input.already_hedged_notional / input.exposed_revenue)
      : 0;

  const targetNotional = targetRatio * input.exposed_revenue;
  const incremental = round2(targetNotional - input.already_hedged_notional);

  const gap = targetRatio - currentRatio;
  let stance: HedgeStance;
  if (Math.abs(gap) < 0.02) stance = input.already_hedged_notional > 0 ? 'hold' : 'no_action';
  else if (gap > 0) stance = 'increase_cover';
  else stance = 'reduce_cover';

  const tightDscr = input.current_dscr < dscrMin;
  const instruments = tightDscr
    ? ['protective_puts', 'zero_cost_collar']
    : ['forwards', 'collar'];

  const boardCapRespected = targetRatio <= input.board_max_hedge_ratio + 1e-9;

  const rationale = tightDscr
    ? `DSCR ${round3(input.current_dscr)} below ${dscrMin}x — lock downside via puts/collar (preserve upside), target ${Math.round(targetRatio * 100)}% cover capped by board policy.`
    : `DSCR ${round3(input.current_dscr)} healthy — hedge committed debt service/capex to ${Math.round(targetRatio * 100)}% (board cap ${Math.round(input.board_max_hedge_ratio * 100)}%), no speculation.`;

  return {
    target_hedge_ratio: round3(targetRatio),
    current_hedge_ratio: round3(currentRatio),
    recommended_incremental_notional: incremental,
    stance,
    board_cap_respected: boardCapRespected,
    instruments_suggested: instruments,
    rationale,
  };
}
