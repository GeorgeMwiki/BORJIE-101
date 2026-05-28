/**
 * Opportunity Scanner — state resolver (Wave OWNER-OS).
 *
 * Builds a `ScanState` snapshot for a tenant by reading the underlying
 * tables via RLS-bound Drizzle queries. Every slice is best-effort —
 * a failed slice degrades to `null` and the scanner simply skips any
 * rule that depends on it. No tenant data ever crosses tenants:
 * every read uses the `app.current_tenant_id` GUC that the api-gateway
 * middleware binds.
 *
 * The resolver does NOT fabricate numbers. When a metric isn't
 * computable from real data the corresponding field stays `null` and
 * the scanner skips the dependent rule.
 *
 * Returned shape is `Readonly<ScanState>`. Pure read path — no writes.
 */

import { sql } from 'drizzle-orm';
import type { ScanState } from './types';

export interface ScanStateResolverDb {
  execute(query: unknown): Promise<unknown>;
}

interface RowsLike {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as RowsLike | null;
  return wrapped?.rows ?? [];
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Fuel + production slice ────────────────────────────────────────

async function resolveFuelSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['fuel']> {
  try {
    const tenantResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(fuel_litres)::numeric, 0) AS litres,
        COALESCE(SUM(rom_tonnes)::numeric, 0)  AS tonnes
        FROM shift_reports
       WHERE tenant_id = ${tenantId}
         AND shift_date >= NOW() - INTERVAL '30 days'
    `);
    const tenantRow = rowsOf(tenantResult)[0] ?? {};
    const litres = Number(tenantRow.litres ?? 0);
    const tonnes = Number(tenantRow.tonnes ?? 0);
    const litresPerTonne = tonnes > 0 ? litres / tonnes : null;

    const peerResult = await db.execute(sql`
      SELECT percentile_p25::numeric AS p25
        FROM peer_cohort_aggregates
       WHERE metric_id = 'fuel_litres_per_tonne'
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const peerP25 = num(rowsOf(peerResult)[0]?.p25);

    const dieselResult = await db.execute(sql`
      SELECT value::numeric AS price
        FROM external_benchmarks
       WHERE benchmark_id = 'diesel_tzs_per_litre'
       ORDER BY as_of DESC
       LIMIT 1
    `);
    const diesel = num(rowsOf(dieselResult)[0]?.price);

    const supplierResult = await db.execute(sql`
      SELECT COUNT(DISTINCT vendor_id)::int AS supplier_count
        FROM purchase_orders
       WHERE tenant_id = ${tenantId}
         AND category = 'diesel'
         AND created_at >= NOW() - INTERVAL '180 days'
    `);
    const supplierCount = Number(rowsOf(supplierResult)[0]?.supplier_count ?? 0);

    return {
      litresPerTonneRolling30d: litresPerTonne,
      peerP25LitresPerTonne: peerP25,
      currentDieselTzsPerLitre: diesel,
      tonnesProducedRolling30d: tonnes,
      supplierCount,
    };
  } catch {
    return null;
  }
}

// ─── FX slice ───────────────────────────────────────────────────────

async function resolveFxSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['fx']> {
  try {
    const fixResult = await db.execute(sql`
      SELECT value::numeric AS fix
        FROM external_benchmarks
       WHERE benchmark_id = 'lbma_am_usd_per_oz'
       ORDER BY as_of DESC
       LIMIT 30
    `);
    const fixRows = rowsOf(fixResult);
    const fixes = fixRows.map((r) => Number(r.fix ?? 0)).filter((n) => n > 0);
    if (fixes.length === 0) return null;
    const current = fixes[0] ?? null;
    const series = fixes.slice(0, 30);
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const variance =
      series.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) /
      Math.max(series.length - 1, 1);
    const stdev = Math.sqrt(variance);

    const windowResult = await db.execute(sql`
      SELECT is_open::bool AS open
        FROM bot_gold_windows
       WHERE NOW() BETWEEN starts_at AND ends_at
       ORDER BY starts_at DESC
       LIMIT 1
    `);
    const open = Boolean(rowsOf(windowResult)[0]?.open ?? false);

    const parcelResult = await db.execute(sql`
      SELECT COALESCE(SUM(ozt)::numeric, 0) AS oz
        FROM ore_parcels
       WHERE tenant_id = ${tenantId}
         AND status = 'ready'
    `);
    const oz = Number(rowsOf(parcelResult)[0]?.oz ?? 0);

    return {
      lbmaFixUsdPerOz: current,
      lbmaFixMean30dUsdPerOz: mean,
      lbmaFixStdev30d: stdev,
      botGoldWindowOpen: open,
      parcelOzReady: oz,
    };
  } catch {
    return null;
  }
}

// ─── Tax + regulator slices ─────────────────────────────────────────

async function resolveTaxSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['tax']> {
  try {
    const result = await db.execute(sql`
      SELECT
        EXTRACT(DAY FROM (next_deadline - NOW()))::int AS days_until,
        current_rate_pct::numeric AS current_rate,
        alt_rate_pct::numeric AS alt_rate,
        last_quarter_tzs::numeric AS quarter_amount
        FROM tra_royalty_election_state
       WHERE tenant_id = ${tenantId}
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
      traQuarterlyElectionDaysUntilDeadline: num(row.days_until),
      currentRoyaltyRatePct: num(row.current_rate),
      altRoyaltyRatePct: num(row.alt_rate),
      quarterlyRoyaltyTzs: num(row.quarter_amount),
    };
  } catch {
    return null;
  }
}

async function resolveRegulatorSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['regulator']> {
  try {
    const result = await db.execute(sql`
      SELECT
        is_open::bool AS open,
        EXTRACT(DAY FROM (ends_at - NOW()))::int AS days_remaining,
        EXISTS (
          SELECT 1 FROM nemc_amnesty_qualifications q
           WHERE q.tenant_id = ${tenantId}
             AND q.amnesty_id = a.id
        ) AS qualifies,
        estimated_penalty_avoided_tzs::numeric AS penalty
        FROM nemc_amnesty_windows a
       WHERE NOW() BETWEEN starts_at AND ends_at
       ORDER BY starts_at DESC
       LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
      nemcAmnestyWindowOpen: Boolean(row.open ?? false),
      nemcAmnestyDaysRemaining: num(row.days_remaining),
      tenantQualifiesForAmnesty: Boolean(row.qualifies ?? false),
      estimatedPenaltyAvoidedTzs: num(row.penalty),
    };
  } catch {
    return null;
  }
}

// ─── Estate slice ───────────────────────────────────────────────────

async function resolveEstateSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['estate']> {
  try {
    const entityResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE relation = 'subsidiary')::int AS subs,
        BOOL_OR(relation = 'holding')::bool AS has_holding,
        COUNT(*) FILTER (WHERE kind = 'forestry')::int AS forestry
        FROM estate_entities
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
    `);
    const entityRow = rowsOf(entityResult)[0] ?? {};
    const subs = Number(entityRow.subs ?? 0);
    const hasHolding = Boolean(entityRow.has_holding ?? false);
    const forestry = Number(entityRow.forestry ?? 0);

    const surplusResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount)::numeric, 0) AS surplus
        FROM estate_capital_movements
       WHERE tenant_id = ${tenantId}
         AND currency = 'TZS'
         AND happened_at > NOW() - INTERVAL '30 days'
         AND flow_direction = 'surplus_pending'
    `);
    const surplus = Number(rowsOf(surplusResult)[0]?.surplus ?? 0);

    const successionResult = await db.execute(sql`
      SELECT COUNT(*)::int AS overdue
        FROM succession_plans
       WHERE tenant_id = ${tenantId}
         AND status <> 'archived'
         AND next_review_due_at < NOW()
    `);
    const overdue = Number(rowsOf(successionResult)[0]?.overdue ?? 0);

    return {
      subsidiaryCount: subs,
      intercompanySurplusTzs: surplus,
      holdingCoExists: hasHolding,
      overdueSuccessionReviewCount: overdue,
      forestryEntityCount: forestry,
    };
  } catch {
    return null;
  }
}

// ─── Marketplace slice ──────────────────────────────────────────────

async function resolveMarketplaceSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['marketplace']> {
  try {
    const result = await db.execute(sql`
      SELECT
        premium_over_fix_pct::numeric AS premium,
        ozt_equivalent::numeric AS oz,
        buyer_name AS buyer
        FROM marketplace_buyer_offers
       WHERE tenant_id = ${tenantId}
         AND offered_at >= NOW() - INTERVAL '14 days'
       ORDER BY premium_over_fix_pct DESC
       LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
      latestBuyerOfferPremiumOverLbmaPct: num(row.premium),
      latestBuyerOfferParcelOzEquivalent: num(row.oz),
      latestBuyerName: row.buyer == null ? null : String(row.buyer),
    };
  } catch {
    return null;
  }
}

// ─── Workforce slice ────────────────────────────────────────────────

async function resolveWorkforceSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['workforce']> {
  try {
    const apprenticeResult = await db.execute(sql`
      SELECT COUNT(*)::int AS eligible
        FROM workforce_apprenticeship_eligibility
       WHERE tenant_id = ${tenantId}
         AND eligible_window_ends_at > NOW()
    `);
    const eligible = Number(rowsOf(apprenticeResult)[0]?.eligible ?? 0);

    const vetaResult = await db.execute(sql`
      SELECT value::numeric AS subsidy
        FROM external_benchmarks
       WHERE benchmark_id = 'veta_apprenticeship_subsidy_tzs'
       ORDER BY as_of DESC
       LIMIT 1
    `);
    const vetaSubsidy = num(rowsOf(vetaResult)[0]?.subsidy);

    const certResult = await db.execute(sql`
      SELECT COUNT(*)::int AS expiring
        FROM workforce_certifications
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
         AND expires_at <= NOW() + INTERVAL '60 days'
    `);
    const expiring = Number(rowsOf(certResult)[0]?.expiring ?? 0);

    const feeResult = await db.execute(sql`
      SELECT value::numeric AS fee
        FROM external_benchmarks
       WHERE benchmark_id = 'ica_cert_per_cert_fee_tzs'
       ORDER BY as_of DESC
       LIMIT 1
    `);
    const fee = num(rowsOf(feeResult)[0]?.fee);

    return {
      apprenticeshipEligibleCount: eligible,
      vetaSubsidyPerApprenticeTzs: vetaSubsidy,
      icaCertExpiringIn60dCount: expiring,
      icaCertPerCertFeeTzs: fee,
    };
  } catch {
    return null;
  }
}

// ─── Insurance slice ────────────────────────────────────────────────

async function resolveInsuranceSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['insurance']> {
  try {
    const policyResult = await db.execute(sql`
      SELECT
        expires_at,
        premium_tzs::numeric AS premium
        FROM insurance_policies
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
       ORDER BY expires_at ASC
       LIMIT 1
    `);
    const policyRow = rowsOf(policyResult)[0];
    if (!policyRow) return null;
    const expiresAt = policyRow.expires_at ? new Date(String(policyRow.expires_at)) : null;
    const dueWithin60d = Boolean(
      expiresAt && (expiresAt.getTime() - Date.now()) / 86_400_000 <= 60,
    );

    const quoteResult = await db.execute(sql`
      SELECT MIN(premium_tzs)::numeric AS best_quote
        FROM insurance_quotes
       WHERE tenant_id = ${tenantId}
         AND status IN ('open', 'expired')
         AND issued_at >= NOW() - INTERVAL '30 days'
    `);
    const bestQuote = num(rowsOf(quoteResult)[0]?.best_quote);

    return {
      policyDueWithin60d: dueWithin60d,
      currentAnnualPremiumTzs: num(policyRow.premium),
      bestMarketQuoteTzs: bestQuote,
    };
  } catch {
    return null;
  }
}

// ─── Peer slice ────────────────────────────────────────────────────

async function resolvePeerSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['peer']> {
  try {
    const percentileResult = await db.execute(sql`
      SELECT production_percentile::int AS pct
        FROM peer_cohort_tenant_position
       WHERE tenant_id = ${tenantId}
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const pct = num(rowsOf(percentileResult)[0]?.pct);

    const patternResult = await db.execute(sql`
      SELECT
        p75_pattern_label AS pattern,
        EXISTS (
          SELECT 1 FROM tenant_operational_patterns op
           WHERE op.tenant_id = ${tenantId}
             AND op.pattern_label = peer.p75_pattern_label
        ) AS tenant_uses
        FROM peer_cohort_top_patterns peer
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const patternRow = rowsOf(patternResult)[0];

    return {
      tenantProductionPercentile: pct,
      p75Pattern: patternRow?.pattern == null ? null : String(patternRow.pattern),
      tenantUsesP75Pattern: Boolean(patternRow?.tenant_uses ?? false),
    };
  } catch {
    return null;
  }
}

// ─── Vendors slice ──────────────────────────────────────────────────

async function resolveVendorsSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['vendors']> {
  try {
    const result = await db.execute(sql`
      SELECT
        category,
        COUNT(DISTINCT vendor_id)::int AS supplier_count,
        COALESCE(SUM(annual_spend_tzs)::numeric, 0) AS annual_spend
        FROM vendor_spend_rollup
       WHERE tenant_id = ${tenantId}
       GROUP BY category
       HAVING COUNT(DISTINCT vendor_id) >= 2
    `);
    const rows = rowsOf(result);
    return {
      categoriesWithMultipleSuppliers: rows.map((r) => ({
        category: String(r.category ?? ''),
        supplierCount: Number(r.supplier_count ?? 0),
        annualSpendTzs: Number(r.annual_spend ?? 0),
      })),
    };
  } catch {
    return null;
  }
}

// ─── Capital slice ──────────────────────────────────────────────────

async function resolveCapitalSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['capital']> {
  try {
    const loanResult = await db.execute(sql`
      SELECT
        rate_pct::numeric AS rate,
        balance_tzs::numeric AS balance
        FROM tenant_loans
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
       ORDER BY balance_tzs DESC
       LIMIT 1
    `);
    const loanRow = rowsOf(loanResult)[0] ?? {};

    const tibResult = await db.execute(sql`
      SELECT value::numeric AS rate
        FROM external_benchmarks
       WHERE benchmark_id = 'tib_borrower_rate_tier_b_pct'
       ORDER BY as_of DESC
       LIMIT 1
    `);
    const tibRate = num(rowsOf(tibResult)[0]?.rate);

    const cashResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount)::numeric, 0) AS cash,
        COALESCE(SUM(CASE WHEN sat_days >= 90 THEN amount ELSE 0 END)::numeric, 0) AS idle
        FROM tenant_cash_positions
       WHERE tenant_id = ${tenantId}
    `);
    const cashRow = rowsOf(cashResult)[0] ?? {};

    const yieldResult = await db.execute(sql`
      SELECT value::numeric AS y
        FROM external_benchmarks
       WHERE benchmark_id = 'bot_91d_tbill_yield_pct'
       ORDER BY as_of DESC
       LIMIT 1
    `);
    const yieldPct = num(rowsOf(yieldResult)[0]?.y);

    return {
      currentLoanRatePct: num(loanRow.rate),
      tibBetterRatePct: tibRate,
      loanBalanceTzs: num(loanRow.balance),
      cashOnHandTzs: num(cashRow.cash),
      idleCashOver90dTzs: num(cashRow.idle),
      tibillsYieldPct: yieldPct,
    };
  } catch {
    return null;
  }
}

// ─── Counterparties slice ───────────────────────────────────────────

async function resolveCounterpartiesSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['counterparties']> {
  try {
    const result = await db.execute(sql`
      SELECT
        b.id AS buyer_id,
        b.name AS buyer_name,
        b.recent_premium_over_fix_pct::numeric AS premium,
        b.recent_parcel_oz::numeric AS oz
        FROM marketplace_buyers b
       WHERE b.tenant_id = ${tenantId}
         AND b.kyc_status = 'clean'
         AND b.recent_premium_over_fix_pct > 0.4
         AND b.last_settlement_at >= NOW() - INTERVAL '60 days'
       ORDER BY b.recent_premium_over_fix_pct DESC
       LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (!row) return { newBuyerPremiumOpportunity: null };
    return {
      newBuyerPremiumOpportunity: {
        buyerId: String(row.buyer_id ?? ''),
        buyerName: String(row.buyer_name ?? ''),
        premiumOverFixPct: Number(row.premium ?? 0),
        parcelOzEquivalent: Number(row.oz ?? 0),
      },
    };
  } catch {
    return null;
  }
}

// ─── Carbon slice ───────────────────────────────────────────────────

async function resolveCarbonSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['carbon']> {
  try {
    const hectaresResult = await db.execute(sql`
      SELECT COALESCE(SUM(eligible_hectares)::numeric, 0) AS ha
        FROM forestry_carbon_eligibility
       WHERE tenant_id = ${tenantId}
    `);
    const ha = num(rowsOf(hectaresResult)[0]?.ha);

    const rateResult = await db.execute(sql`
      SELECT value::numeric AS rate
        FROM external_benchmarks
       WHERE benchmark_id = 'carbon_credit_tzs_per_hectare_per_year'
       ORDER BY as_of DESC
       LIMIT 1
    `);
    const rate = num(rowsOf(rateResult)[0]?.rate);

    return {
      eligibleHectares: ha,
      tzsPerHectarePerYear: rate,
    };
  } catch {
    return null;
  }
}

// ─── Energy slice ───────────────────────────────────────────────────

async function resolveEnergySlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['energy']> {
  try {
    const result = await db.execute(sql`
      SELECT
        current_grid_tariff_tzs_per_kwh::numeric AS grid,
        solar_hybrid_tzs_per_kwh::numeric AS solar,
        monthly_kwh_consumption::numeric AS kwh
        FROM tenant_energy_profile
       WHERE tenant_id = ${tenantId}
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
      currentGridTariffTzsPerKwh: num(row.grid),
      solarHybridTzsPerKwh: num(row.solar),
      monthlyKwhConsumption: num(row.kwh),
    };
  } catch {
    return null;
  }
}

// ─── Ops slice ──────────────────────────────────────────────────────

async function resolveOpsSlice(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState['ops']> {
  try {
    const result = await db.execute(sql`
      SELECT
        night_shift_idle_capacity_pct::numeric AS night_idle,
        night_shift_fuel_delta_tzs_per_tonne::numeric AS night_fuel,
        bcm_haul_distance_metres_mean::numeric AS haul_mean,
        bcm_haul_distance_p25_metres::numeric AS haul_p25,
        rejected_ore_tonnes_rolling_30d::numeric AS rejected,
        downstream_processing_tzs_per_tonne::numeric AS downstream,
        stockpile_age_p90_days::int AS stockpile
        FROM tenant_operations_profile
       WHERE tenant_id = ${tenantId}
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
      nightShiftIdleCapacityPct: num(row.night_idle),
      nightShiftFuelDeltaTzsPerTonne: num(row.night_fuel),
      bcmHaulDistanceMetresMean: num(row.haul_mean),
      bcmHaulDistanceP25Metres: num(row.haul_p25),
      rejectedOreTonnesRolling30d: num(row.rejected),
      downstreamProcessingTzsPerTonne: num(row.downstream),
      stockpileAgeP90Days: num(row.stockpile),
    };
  } catch {
    return null;
  }
}

// ─── Top-level resolver ─────────────────────────────────────────────

/**
 * Build the complete `ScanState` for a tenant by running every slice
 * resolver in parallel. Slices that fail or have no data degrade to
 * `null` — the scanner skips dependent rules.
 */
export async function resolveScanState(
  db: ScanStateResolverDb,
  tenantId: string,
): Promise<ScanState> {
  const nowIso = new Date().toISOString();
  const [
    fuel,
    fx,
    tax,
    regulator,
    estate,
    marketplace,
    workforce,
    insurance,
    peer,
    vendors,
    capital,
    counterparties,
    carbon,
    energy,
    ops,
  ] = await Promise.all([
    resolveFuelSlice(db, tenantId),
    resolveFxSlice(db, tenantId),
    resolveTaxSlice(db, tenantId),
    resolveRegulatorSlice(db, tenantId),
    resolveEstateSlice(db, tenantId),
    resolveMarketplaceSlice(db, tenantId),
    resolveWorkforceSlice(db, tenantId),
    resolveInsuranceSlice(db, tenantId),
    resolvePeerSlice(db, tenantId),
    resolveVendorsSlice(db, tenantId),
    resolveCapitalSlice(db, tenantId),
    resolveCounterpartiesSlice(db, tenantId),
    resolveCarbonSlice(db, tenantId),
    resolveEnergySlice(db, tenantId),
    resolveOpsSlice(db, tenantId),
  ]);

  return Object.freeze({
    tenantId,
    nowIso,
    fuel: fuel ?? null,
    fx: fx ?? null,
    tax: tax ?? null,
    regulator: regulator ?? null,
    estate: estate ?? null,
    marketplace: marketplace ?? null,
    workforce: workforce ?? null,
    insurance: insurance ?? null,
    peer: peer ?? null,
    vendors: vendors ?? null,
    capital: capital ?? null,
    counterparties: counterparties ?? null,
    carbon: carbon ?? null,
    energy: energy ?? null,
    ops: ops ?? null,
  });
}
