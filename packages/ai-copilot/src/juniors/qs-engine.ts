/**
 * Quantity-Surveying engine — PURE, deterministic construction-cost math
 * grounded in the construction dossier
 * (`Docs/research/construction-built-environment.md` §2, §5, §8).
 *
 * Carries the QS truth for the estate's construction programme (mine
 * camps/plants/civils + buildings) so the Cost Engineer junior reasons
 * over real numbers, not placeholders:
 *
 *   • NRM2 §2.2 first-principles unit-rate build-up
 *       rate = (Labour + Plant + Materials)·(1 + waste) + OH&P  — prelims priced separately
 *   • NRM1 elemental cost plan (RIBA 0–4 planning tool)
 *   • §5 post-contract money machine — IPC gross/net valuation, retention
 *     (½ at PC, ½ at making-good-defects), variation valuation, final account
 *   • §8.1 Earned Value Management (CPI/SPI/EAC/ETC/VAC/TCPI)
 *
 * Currency-agnostic by construction: every monetary field is a bare number
 * paired with an explicit `currency_code` carried by the caller. No TZS/USD
 * is ever hard-coded here (CLAUDE.md multi-currency rule); rendering uses
 * `formatCurrency` at the surface layer.
 *
 * No I/O, no Claude, no DB, no logging — only arithmetic. This keeps the
 * domain truth unit-testable and lets the LLM port narrate over verified
 * numbers instead of inventing them.
 */

// ─────────────────────────────────────────────────────────────────────
// NRM2 §2.2 — first-principles unit-rate build-up
// ─────────────────────────────────────────────────────────────────────

export interface RateBuildupInput {
  /** All-in labour hourly rate (basic + statutory on-costs + non-productive time). */
  readonly labour_all_in_rate: number;
  /** Labour output constant — hours required per measured unit. */
  readonly labour_hours_per_unit: number;
  /** Delivered material cost per measured unit (before waste/handling). */
  readonly material_cost_per_unit: number;
  /** Plant/equipment hire-or-owned cost attributable per measured unit. */
  readonly plant_cost_per_unit: number;
  /** Material waste allowance, fraction (e.g. 0.05 = 5 %). */
  readonly waste_fraction: number;
  /** Combined head-office overhead + profit, fraction applied to net cost. */
  readonly ohp_fraction: number;
}

export interface RateBuildupResult {
  readonly labour: number;
  readonly material_with_waste: number;
  readonly plant: number;
  readonly net_cost: number;
  readonly ohp: number;
  readonly unit_rate: number;
}

/**
 * NRM2 unit rate from first principles. Preliminaries are deliberately
 * EXCLUDED — dossier §2.2: time-related + fixed prelims are priced
 * separately in NRM2, never smeared into measured rates.
 */
export function buildUnitRate(input: RateBuildupInput): RateBuildupResult {
  if (input.waste_fraction < 0 || input.ohp_fraction < 0) {
    throw new Error('qs-engine.buildUnitRate: waste_fraction and ohp_fraction must be >= 0');
  }
  const labour = round2(input.labour_all_in_rate * input.labour_hours_per_unit);
  const material_with_waste = round2(input.material_cost_per_unit * (1 + input.waste_fraction));
  const plant = round2(input.plant_cost_per_unit);
  const net_cost = round2(labour + material_with_waste + plant);
  const ohp = round2(net_cost * input.ohp_fraction);
  return { labour, material_with_waste, plant, net_cost, ohp, unit_rate: round2(net_cost + ohp) };
}

// ─────────────────────────────────────────────────────────────────────
// NRM1 elemental cost plan (RIBA 0–4 planning tool)
// ─────────────────────────────────────────────────────────────────────

export interface BoqLine {
  readonly code: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  /** Measured rate (typically the buildUnitRate output). */
  readonly rate: number;
}

export interface CostPlanInput {
  readonly measured_works: ReadonlyArray<BoqLine>;
  /** Time-related + fixed prelims, priced separately (NRM2 §2.2). */
  readonly preliminaries: number;
  /** Design/project-team fees, fraction of works+prelims (NRM1). */
  readonly fees_fraction: number;
  /** Risk allowance, fraction (NRM1 — design/construction/employer-change/other). */
  readonly risk_fraction: number;
  /** Inflation/escalation allowance to the cost-plan base date, fraction (NRM1). */
  readonly inflation_fraction: number;
}

export interface CostPlanResult {
  readonly measured_works_total: number;
  readonly preliminaries: number;
  readonly works_plus_prelims: number;
  readonly fees: number;
  readonly risk_allowance: number;
  readonly inflation_allowance: number;
  readonly base_cost: number;
  readonly elemental_breakdown: ReadonlyArray<{ readonly code: string; readonly amount: number }>;
}

/**
 * NRM1 elemental cost plan. Order matters: prelims add to works, fees apply
 * to (works+prelims), then risk and inflation stack on the subtotal so the
 * board sees a defensible base cost — not a single padded lump.
 */
export function buildCostPlan(input: CostPlanInput): CostPlanResult {
  const elemental = input.measured_works.map((l) => ({
    code: l.code,
    amount: round2(l.quantity * l.rate),
  }));
  const measured_works_total = round2(elemental.reduce((s, e) => s + e.amount, 0));
  const works_plus_prelims = round2(measured_works_total + input.preliminaries);
  const fees = round2(works_plus_prelims * input.fees_fraction);
  const subtotal = round2(works_plus_prelims + fees);
  const risk_allowance = round2(subtotal * input.risk_fraction);
  const inflation_allowance = round2((subtotal + risk_allowance) * input.inflation_fraction);
  return {
    measured_works_total,
    preliminaries: round2(input.preliminaries),
    works_plus_prelims,
    fees,
    risk_allowance,
    inflation_allowance,
    base_cost: round2(subtotal + risk_allowance + inflation_allowance),
    elemental_breakdown: elemental,
  };
}

// ─────────────────────────────────────────────────────────────────────
// §5 — Interim Payment Certificate (IPC) gross → net valuation
// ─────────────────────────────────────────────────────────────────────

export interface IpcInput {
  /** Gross value of work properly executed to date. */
  readonly work_done_to_date: number;
  /** Value of materials on/off site eligible for payment. */
  readonly materials_on_site: number;
  /** Cumulative value of certified variations to date (signed). */
  readonly variations_to_date: number;
  /** Retention percentage withheld from each gross valuation, fraction. */
  readonly retention_fraction: number;
  /** Retention cap as a fraction of contract sum (limit of retention, NRM/JCT). */
  readonly retention_limit_fraction: number;
  /** Contract sum, for the retention cap. */
  readonly contract_sum: number;
  /** Total of all previously certified net amounts. */
  readonly previously_certified: number;
}

export interface IpcResult {
  readonly gross_valuation: number;
  readonly retention_held: number;
  readonly retention_capped: boolean;
  readonly net_after_retention: number;
  readonly net_due_this_certificate: number;
}

/**
 * §5 interim-certificate math. Gross valuation = work + materials +
 * variations; retention is withheld up to its contractual limit (cannot
 * exceed limit·contract_sum); net due = (gross − retention) − prior
 * certified. A negative result is a legitimate over-certification clawback,
 * not an error, so it is returned as-is for the certifier to action.
 */
export function valuateIpc(input: IpcInput): IpcResult {
  const gross_valuation = round2(
    input.work_done_to_date + input.materials_on_site + input.variations_to_date,
  );
  const uncappedRetention = gross_valuation * input.retention_fraction;
  const retentionCap = input.contract_sum * input.retention_limit_fraction;
  const retention_held = round2(Math.min(uncappedRetention, retentionCap));
  const net_after_retention = round2(gross_valuation - retention_held);
  return {
    gross_valuation,
    retention_held,
    retention_capped: uncappedRetention > retentionCap,
    net_after_retention,
    net_due_this_certificate: round2(net_after_retention - input.previously_certified),
  };
}

/**
 * §5 retention-release schedule: half released at Practical Completion, the
 * balance at the Certificate of Making Good Defects.
 */
export function retentionReleaseSchedule(totalRetention: number): {
  readonly at_practical_completion: number;
  readonly at_making_good_defects: number;
} {
  const half = round2(totalRetention / 2);
  return { at_practical_completion: half, at_making_good_defects: round2(totalRetention - half) };
}

// ─────────────────────────────────────────────────────────────────────
// §5 — Variation valuation (BOQ rate / pro-rata / fair-rate-or-daywork)
// ─────────────────────────────────────────────────────────────────────

export type VariationBasis = 'boq_rate' | 'pro_rata' | 'fair_rate' | 'dayworks';

export interface VariationInput {
  readonly quantity: number;
  /** Applicable rate (BOQ, pro-rata adjusted, or fair rate). Ignored for dayworks. */
  readonly rate?: number;
  /** Dayworks build-up — used only when basis === 'dayworks'. */
  readonly dayworks?: {
    readonly labour: number;
    readonly plant: number;
    readonly materials: number;
    /** Daywork percentage addition on prime cost, fraction. */
    readonly percentage_addition: number;
  };
  readonly basis: VariationBasis;
}

export interface VariationResult {
  readonly basis: VariationBasis;
  readonly value: number;
}

/**
 * §5 variation valuation. Work similar to BOQ → BOQ rate; partly similar →
 * pro-rata rate; genuinely new → fair rate or dayworks (prime cost + %).
 */
export function valuateVariation(input: VariationInput): VariationResult {
  if (input.basis === 'dayworks') {
    const dw = input.dayworks;
    if (!dw) throw new Error('qs-engine.valuateVariation: dayworks build-up required for dayworks basis');
    const prime = dw.labour + dw.plant + dw.materials;
    return { basis: 'dayworks', value: round2(prime * (1 + dw.percentage_addition)) };
  }
  if (input.rate === undefined) {
    throw new Error(`qs-engine.valuateVariation: rate required for ${input.basis} basis`);
  }
  return { basis: input.basis, value: round2(input.quantity * input.rate) };
}

// ─────────────────────────────────────────────────────────────────────
// §5 — Final account reconciliation
// ─────────────────────────────────────────────────────────────────────

export interface FinalAccountInput {
  readonly original_contract_sum: number;
  /** Net of omissions/additions on remeasured work. */
  readonly remeasured_adjustment: number;
  readonly total_variations: number;
  readonly settled_claims: number;
  readonly fluctuations: number;
  readonly total_certified_to_date: number;
}

export interface FinalAccountResult {
  readonly final_contract_sum: number;
  readonly balance_to_release: number;
  readonly variance_vs_original: number;
  readonly variance_vs_original_pct: number;
}

/** §5 final-account reconciliation → final contract sum + residual balance. */
export function reconcileFinalAccount(input: FinalAccountInput): FinalAccountResult {
  const final_contract_sum = round2(
    input.original_contract_sum +
      input.remeasured_adjustment +
      input.total_variations +
      input.settled_claims +
      input.fluctuations,
  );
  const variance = round2(final_contract_sum - input.original_contract_sum);
  return {
    final_contract_sum,
    balance_to_release: round2(final_contract_sum - input.total_certified_to_date),
    variance_vs_original: variance,
    variance_vs_original_pct:
      input.original_contract_sum === 0 ? 0 : round2((variance / input.original_contract_sum) * 100),
  };
}

// ─────────────────────────────────────────────────────────────────────
// §8.1 — Earned Value Management
// ─────────────────────────────────────────────────────────────────────

export interface EvmInput {
  /** PV / BCWS — budgeted cost of work scheduled. */
  readonly planned_value: number;
  /** EV / BCWP — budgeted cost of work performed. */
  readonly earned_value: number;
  /** AC / ACWP — actual cost of work performed. */
  readonly actual_cost: number;
  /** Budget at completion (the cost-plan base cost). */
  readonly budget_at_completion: number;
}

export interface EvmResult {
  readonly cpi: number;
  readonly spi: number;
  readonly cost_variance: number;
  readonly schedule_variance: number;
  /** EAC = BAC / CPI (typical-performance forecast). */
  readonly estimate_at_completion: number;
  /** ETC = EAC − AC. */
  readonly estimate_to_complete: number;
  /** VAC = BAC − EAC. */
  readonly variance_at_completion: number;
  /** TCPI = (BAC − EV) / (BAC − AC). */
  readonly to_complete_performance_index: number;
  readonly cost_status: 'under_budget' | 'on_budget' | 'over_budget';
  readonly schedule_status: 'ahead' | 'on_schedule' | 'behind';
}

/**
 * §8.1 EVM. CPI and SPI MUST be read together — a project can be under
 * budget (CPI>1) yet behind schedule (SPI<1). Guards against /0 when no
 * actual cost / planned value exists yet.
 */
export function computeEvm(input: EvmInput): EvmResult {
  const cpi = input.actual_cost === 0 ? 0 : round3(input.earned_value / input.actual_cost);
  const spi = input.planned_value === 0 ? 0 : round3(input.earned_value / input.planned_value);
  const eac = cpi === 0 ? input.budget_at_completion : round2(input.budget_at_completion / cpi);
  const denomTcpi = input.budget_at_completion - input.actual_cost;
  return {
    cpi,
    spi,
    cost_variance: round2(input.earned_value - input.actual_cost),
    schedule_variance: round2(input.earned_value - input.planned_value),
    estimate_at_completion: eac,
    estimate_to_complete: round2(eac - input.actual_cost),
    variance_at_completion: round2(input.budget_at_completion - eac),
    to_complete_performance_index:
      denomTcpi === 0 ? 0 : round3((input.budget_at_completion - input.earned_value) / denomTcpi),
    cost_status: bandCenter(cpi, 'under_budget', 'on_budget', 'over_budget'),
    schedule_status: bandCenter(spi, 'ahead', 'on_schedule', 'behind'),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** Index > 1.0 → favourable, == 1.0 → neutral, < 1.0 → unfavourable. */
function bandCenter<A, B, C>(index: number, high: A, mid: B, low: C): A | B | C {
  if (index > 1) return high;
  if (index < 1) return low;
  return mid;
}
