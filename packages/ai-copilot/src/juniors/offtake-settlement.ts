/**
 * Off-take settlement math — DETERMINISTIC NET-revenue engine.
 *
 * Pure, side-effect-free functions implementing the commercial-book
 * pricing mechanics from `Docs/research/mining-estate-operating-model.md`
 * §5.1 / §5.3:
 *   - concentrate quality specs + precious-metals payabilities,
 *   - treatment & refining charges (TC/RC),
 *   - deleterious-element penalties (As, Hg, Sb, F, Cl, U, Bi …),
 *   - NET (not gross) payable revenue.
 *
 * Worked grounding: copper concentrate captures ~85–96.5 % of LME after
 * TC/RC (dossier §5.3). The MD must compute NET, never gross.
 *
 * MONEY MATH NOTE: these functions only ADVISE. No value computed here
 * posts to a ledger. Any settlement that becomes binding must route
 * through `LedgerService.post()` (double-entry, SoD: proposer != approver
 * != recorder) — never a direct write. See CAPABILITY_SPEC_WAVE3 §
 * "Commercial Book" + the project hard rules.
 *
 * All amounts are returned in a caller-supplied currency code; this
 * module never hard-codes TZS/USD — it computes in the unit the inputs
 * are denominated in and the caller renders via `formatCurrency`.
 */

// ─────────────────────────────────────────────────────────────────────
// Domain inputs (plain types — Zod lives in the junior boundary)
// ─────────────────────────────────────────────────────────────────────

/** A precious / base metal line in the concentrate, with its payable terms. */
export interface PayableMetal {
  /** Metal symbol, e.g. 'Cu', 'Au', 'Ag', 'Pb', 'Zn', 'Co'. */
  readonly metal: string;
  /**
   * Assay grade. For base metals use a mass fraction (0..1, e.g. 0.28 for
   * 28 % Cu concentrate). For precious metals carried per dry-tonne use
   * grams-per-tonne via `grade_g_per_t` instead.
   */
  readonly grade_fraction?: number;
  readonly grade_g_per_t?: number;
  /** Payable fraction (0..1) the smelter pays for, e.g. 0.965 for 96.5 % Cu. */
  readonly payable_fraction: number;
  /**
   * Minimum-deduction unit deducted before payability, in the SAME unit
   * as the grade (e.g. 1.0 %-unit of Cu, or 1 g/t Au deduction). The
   * classic copper term is "pay for grade minus 1 unit, capped at the
   * payable fraction".
   */
  readonly min_deduction_unit?: number;
  /** Reference price per priced-unit (per tonne of contained metal, or per gram). */
  readonly reference_price_per_unit: number;
  /** 'mass_fraction' → priced per dry-tonne of concentrate via grade × price-per-tonne-metal. */
  readonly pricing_basis: 'mass_fraction' | 'per_gram';
}

/** A deleterious-element penalty band (As, Hg, Sb, Bi, F, Cl, U …). */
export interface DeleteriousPenalty {
  readonly element: string;
  /** Assayed concentration, ppm. */
  readonly assay_ppm: number;
  /** Penalty-free threshold, ppm — penalties apply only ABOVE this. */
  readonly threshold_ppm: number;
  /** Charge per ppm-over-threshold, per dry-tonne of concentrate. */
  readonly charge_per_ppm_over: number;
  /** Hard cargo-rejection ceiling, ppm. Above this the cargo is rejectable. */
  readonly reject_above_ppm?: number;
}

export interface OfftakeTerms {
  /** Dry mass of concentrate, tonnes. */
  readonly dmt: number;
  /** Treatment charge per dmt (smelter fee). */
  readonly tc_per_dmt: number;
  /**
   * Refining charges keyed by metal, per payable unit (per priced-unit of
   * the metal, e.g. per lb-Cu equivalent expressed per-tonne, or per gram
   * of Au). Caller supplies in the same per-unit basis as the metal price.
   */
  readonly rc_per_payable_unit: Readonly<Record<string, number>>;
  readonly metals: ReadonlyArray<PayableMetal>;
  readonly penalties: ReadonlyArray<DeleteriousPenalty>;
  /** Fixed freight / insurance / moisture allowance off the top, total. */
  readonly freight_insurance_total?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Outputs
// ─────────────────────────────────────────────────────────────────────

export interface MetalSettlementLine {
  readonly metal: string;
  readonly contained_units: number;
  readonly payable_units: number;
  readonly gross_value: number;
  readonly rc_charge: number;
  readonly net_value: number;
}

export interface PenaltyLine {
  readonly element: string;
  readonly ppm_over_threshold: number;
  readonly penalty_charge: number;
  readonly cargo_rejectable: boolean;
}

export interface OfftakeSettlement {
  readonly gross_value: number;
  readonly tc_charge: number;
  readonly rc_charge_total: number;
  readonly penalty_charge_total: number;
  readonly freight_insurance_total: number;
  readonly net_payable_value: number;
  /** NET / GROSS × 100 — the "85–96.5 % of LME" realisation (dossier §5.3). */
  readonly payable_pct_of_gross: number;
  readonly metal_lines: ReadonlyArray<MetalSettlementLine>;
  readonly penalty_lines: ReadonlyArray<PenaltyLine>;
  readonly cargo_rejectable: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Contained metal units in the cargo:
 *  - mass_fraction → tonnes of contained metal = dmt × grade_fraction
 *  - per_gram      → grams of contained metal   = dmt × grade_g_per_t
 */
function containedUnits(metal: PayableMetal, dmt: number): number {
  if (metal.pricing_basis === 'mass_fraction') {
    return dmt * (metal.grade_fraction ?? 0);
  }
  return dmt * (metal.grade_g_per_t ?? 0);
}

/**
 * Payable units after applying the min-deduction-unit and the payable
 * fraction. Classic copper term: pay for (grade − 1 unit) capped at the
 * payable fraction of the contained metal.
 */
function payableUnits(metal: PayableMetal, dmt: number): number {
  const contained = containedUnits(metal, dmt);
  const deductionUnits =
    metal.pricing_basis === 'mass_fraction'
      ? dmt * (metal.min_deduction_unit ?? 0)
      : dmt * (metal.min_deduction_unit ?? 0);
  const afterDeduction = Math.max(0, contained - deductionUnits);
  const cappedByPayable = contained * metal.payable_fraction;
  return Math.min(afterDeduction, cappedByPayable);
}

function settleMetal(
  metal: PayableMetal,
  dmt: number,
  rcPerUnit: number,
): MetalSettlementLine {
  const contained = containedUnits(metal, dmt);
  const payable = payableUnits(metal, dmt);
  const gross = payable * metal.reference_price_per_unit;
  const rc = payable * rcPerUnit;
  return {
    metal: metal.metal,
    contained_units: round2(contained),
    payable_units: round2(payable),
    gross_value: round2(gross),
    rc_charge: round2(rc),
    net_value: round2(gross - rc),
  };
}

function settlePenalty(p: DeleteriousPenalty, dmt: number): PenaltyLine {
  const over = Math.max(0, p.assay_ppm - p.threshold_ppm);
  const charge = over * p.charge_per_ppm_over * dmt;
  const rejectable = p.reject_above_ppm !== undefined && p.assay_ppm > p.reject_above_ppm;
  return {
    element: p.element,
    ppm_over_threshold: round2(over),
    penalty_charge: round2(charge),
    cargo_rejectable: rejectable,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Main engine — DETERMINISTIC NET revenue
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the NET payable settlement for an off-take cargo.
 *
 * gross  = Σ payable_units × reference_price
 * net    = gross − TC − Σ RC − Σ penalties − freight/insurance
 *
 * Returns NET (not gross) — the dossier's core requirement (§5.3).
 */
export function computeOfftakeSettlement(terms: OfftakeTerms): OfftakeSettlement {
  const metalLines = terms.metals.map((m) =>
    settleMetal(m, terms.dmt, terms.rc_per_payable_unit[m.metal] ?? 0),
  );
  const penaltyLines = terms.penalties.map((p) => settlePenalty(p, terms.dmt));

  const gross = metalLines.reduce((s, l) => s + l.gross_value, 0);
  const rcTotal = metalLines.reduce((s, l) => s + l.rc_charge, 0);
  const tcCharge = terms.tc_per_dmt * terms.dmt;
  const penaltyTotal = penaltyLines.reduce((s, l) => s + l.penalty_charge, 0);
  const freight = terms.freight_insurance_total ?? 0;

  const net = gross - tcCharge - rcTotal - penaltyTotal - freight;
  const payablePct = gross > 0 ? (net / gross) * 100 : 0;
  const rejectable = penaltyLines.some((l) => l.cargo_rejectable);

  return {
    gross_value: round2(gross),
    tc_charge: round2(tcCharge),
    rc_charge_total: round2(rcTotal),
    penalty_charge_total: round2(penaltyTotal),
    freight_insurance_total: round2(freight),
    net_payable_value: round2(net),
    payable_pct_of_gross: round2(payablePct),
    metal_lines: metalLines,
    penalty_lines: penaltyLines,
    cargo_rejectable: rejectable,
  };
}

/**
 * Sanity band from dossier §5.3: a healthy copper-style concentrate
 * realises ~85–96.5 % of gross after TC/RC. Flags settlements whose
 * realisation falls outside the expected band so the junior can surface
 * an unusually punitive (or implausibly generous) term sheet.
 */
export function realisationBandFlag(
  payablePctOfGross: number,
  lowPct = 85,
  highPct = 96.5,
): 'below_band' | 'in_band' | 'above_band' {
  if (payablePctOfGross < lowPct) return 'below_band';
  if (payablePctOfGross > highPct) return 'above_band';
  return 'in_band';
}
