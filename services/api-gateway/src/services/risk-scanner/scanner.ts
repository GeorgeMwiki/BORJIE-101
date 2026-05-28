/**
 * Risk Scanner — runs the typed rule catalog against the live state.
 *
 * Public surface:
 *
 *   `scanRisks(tenantId, deps?, options?) => Promise<Risk[]>`
 *
 * The scanner gathers the state snapshot once (cheap reads, all bounded
 * to the tenant via the GUC the api-gateway middleware binds), then
 * iterates every rule in the catalog. Survivors are ranked by severity
 * weight / max(1, timeToImpactDays); ties are broken by exposureTzs
 * then ruleId so the FE order is stable across calls.
 *
 * RLS is enforced upstream — the Drizzle client passed in via
 * `RiskScannerDeps` is already tenant-bound. The scanner NEVER reaches
 * across tenants.
 *
 * Resolver failures are swallowed and surface as `null` state fields so
 * a rule that cannot read its backing data simply declines to fire.
 */

import { sql } from 'drizzle-orm';
import { RISK_RULES } from './scan-rules';
import {
  scoreRisk,
  SEVERITY_WEIGHT,
  type Risk,
  type RiskKind,
  type RiskRule,
  type RiskScannerState,
  type RiskSeverity,
  type ScanRisksOptions,
} from './types';

// ─── Dependency surface ─────────────────────────────────────────────

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface RiskScannerDeps {
  /** Tenant-bound Drizzle client. Null → all reads degrade to null. */
  readonly db: DbLike | null;
  /** Wall-clock injection for deterministic tests. */
  readonly now?: () => Date;
  /** State overrides — used by tests to short-circuit resolvers. */
  readonly stateOverride?: Partial<RiskScannerState>;
}

// ─── Resolver helpers ───────────────────────────────────────────────

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === 'bigint') return Number(v);
  return null;
}

async function safeExecute(
  db: DbLike,
  query: unknown,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  try {
    const res = await db.execute(query);
    return rowsOf(res);
  } catch {
    return [];
  }
}

// ─── State resolvers (one per groups of fields) ────────────────────

async function resolveCashFlow(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const cashRows = await safeExecute(
    db,
    sql`SELECT
      COALESCE(SUM(balance_tzs), 0)::bigint AS cash_total
    FROM cash_balances
    WHERE tenant_id = ${tenantId}`,
  );
  const cashOnHandTzs = asNum(cashRows[0]?.cash_total) ?? null;

  const burnRows = await safeExecute(
    db,
    sql`SELECT COALESCE(AVG(amount_tzs), 0)::numeric AS daily_burn
    FROM cash_flow_daily
    WHERE tenant_id = ${tenantId}
      AND captured_at > NOW() - INTERVAL '30 days'`,
  );
  const dailyBurn = asNum(burnRows[0]?.daily_burn) ?? null;
  let cashRunwayDays: number | null = null;
  if (cashOnHandTzs !== null && dailyBurn !== null && dailyBurn > 0) {
    cashRunwayDays = Math.floor(cashOnHandTzs / dailyBurn);
  }

  const arRows = await safeExecute(
    db,
    sql`SELECT
      COALESCE(SUM(CASE WHEN aging_days > 60 THEN amount_tzs ELSE 0 END), 0)::bigint AS overdue,
      COALESCE(SUM(amount_tzs), 0)::bigint AS total
    FROM accounts_receivable
    WHERE tenant_id = ${tenantId}`,
  );
  const overdue = asNum(arRows[0]?.overdue) ?? 0;
  const monthly = asNum(arRows[0]?.total) ?? 0;
  const arOverdue60dPctOfMonthly = monthly > 0 ? (overdue / monthly) * 100 : null;

  const payrollRows = await safeExecute(
    db,
    sql`SELECT
      EXTRACT(DAY FROM (next_run_at - NOW()))::int AS days_to_run,
      total_amount_tzs::numeric AS amount
    FROM payroll_schedule
    WHERE tenant_id = ${tenantId}
    ORDER BY next_run_at ASC
    LIMIT 1`,
  );
  const payrollDueInDays = asNum(payrollRows[0]?.days_to_run);
  const payrollAmountTzs = asNum(payrollRows[0]?.amount);

  return {
    cashRunwayDays,
    arOverdue60dPctOfMonthly,
    payrollDueInDays,
    payrollAmountTzs,
    cashOnHandTzs,
  };
}

async function resolveRegulatory(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const nemcRows = await safeExecute(
    db,
    sql`SELECT
      EXTRACT(DAY FROM (expires_at - NOW()))::int AS days_left
    FROM licences
    WHERE tenant_id = ${tenantId}
      AND kind = 'nemc_eia'
      AND status = 'active'
    ORDER BY expires_at ASC
    LIMIT 1`,
  );
  const nemcEiaDaysToExpiry = asNum(nemcRows[0]?.days_left);

  const botRows = await safeExecute(
    db,
    sql`SELECT
      EXTRACT(DAY FROM (expires_at - NOW()))::int AS days_left
    FROM licences
    WHERE tenant_id = ${tenantId}
      AND kind = 'bot_export'
      AND status = 'active'
    ORDER BY expires_at ASC
    LIMIT 1`,
  );
  const botExportLicenceDaysToExpiry = asNum(botRows[0]?.days_left);

  const traRows = await safeExecute(
    db,
    sql`SELECT
      EXTRACT(DAY FROM (NOW() - due_at))::int AS days_overdue,
      COALESCE(penalty_accrual_tzs, 0)::numeric AS penalty
    FROM regulatory_filings
    WHERE tenant_id = ${tenantId}
      AND filing_kind = 'royalty'
      AND status = 'overdue'
    ORDER BY due_at ASC
    LIMIT 1`,
  );
  const traFilingDaysOverdue = asNum(traRows[0]?.days_overdue);
  const traPenaltyAccrualTzs = asNum(traRows[0]?.penalty);

  return {
    nemcEiaDaysToExpiry,
    botExportLicenceDaysToExpiry,
    traFilingDaysOverdue,
    traPenaltyAccrualTzs,
  };
}

async function resolveOperational(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const prodRows = await safeExecute(
    db,
    sql`SELECT
      month_offset,
      mom_delta_pct::numeric AS delta
    FROM production_mom_summary
    WHERE tenant_id = ${tenantId}
    ORDER BY month_offset DESC
    LIMIT 3`,
  );
  let productionMomMonthsDown = 0;
  let productionMomDeltaPct: number | null = null;
  for (const row of prodRows) {
    const d = asNum(row.delta);
    if (d !== null && d < 0) {
      productionMomMonthsDown += 1;
      productionMomDeltaPct =
        productionMomDeltaPct === null
          ? d
          : Math.min(productionMomDeltaPct, d);
    }
  }

  const fuelRows = await safeExecute(
    db,
    sql`SELECT
      FLOOR(
        COALESCE(SUM(litres_remaining), 0) /
        NULLIF(COALESCE(MAX(daily_burn_litres), 0), 0)
      )::int AS days_left
    FROM fuel_inventory
    WHERE tenant_id = ${tenantId}`,
  );
  const fuelDaysRemaining = asNum(fuelRows[0]?.days_left);

  const eqRows = await safeExecute(
    db,
    sql`SELECT
      equipment_kind,
      COUNT(*)::int AS failure_count,
      30 AS window_days
    FROM equipment_failures
    WHERE tenant_id = ${tenantId}
      AND failed_at > NOW() - INTERVAL '30 days'
    GROUP BY equipment_kind
    HAVING COUNT(*) >= 2`,
  );
  const equipmentRepeatFailures = eqRows.map((r) => ({
    equipmentKind: String(r.equipment_kind ?? 'unknown'),
    count: asNum(r.failure_count) ?? 0,
    windowDays: asNum(r.window_days) ?? 30,
  }));

  return {
    productionMomMonthsDown,
    productionMomDeltaPct,
    fuelDaysRemaining,
    equipmentRepeatFailures,
  };
}

async function resolveHrAndCompliance(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const attRows = await safeExecute(
    db,
    sql`SELECT COUNT(*)::int AS attrition_count
    FROM workforce_separations
    WHERE tenant_id = ${tenantId}
      AND role IN ('supervisor', 'site_manager')
      AND separated_at > NOW() - INTERVAL '90 days'`,
  );
  const supervisorAttrition90d = asNum(attRows[0]?.attrition_count) ?? 0;

  const icaRows = await safeExecute(
    db,
    sql`SELECT COUNT(*)::int AS expired_active
    FROM workforce_certifications
    WHERE tenant_id = ${tenantId}
      AND cert_kind = 'ica'
      AND expires_at < NOW()
      AND active = TRUE`,
  );
  const operatorsWithExpiredIcaActive = asNum(icaRows[0]?.expired_active) ?? 0;

  const royRows = await safeExecute(
    db,
    sql`SELECT
      ((current_draft_tzs - trailing_avg_tzs) /
       NULLIF(trailing_avg_tzs, 0) * 100)::numeric AS dev_pct
    FROM royalty_drafts_with_trend
    WHERE tenant_id = ${tenantId}
    ORDER BY draft_date DESC
    LIMIT 1`,
  );
  const royaltyDraftPctDeviation = asNum(royRows[0]?.dev_pct);

  const regRows = await safeExecute(
    db,
    sql`SELECT
      MAX(CASE WHEN regulator = 'nemc' AND status_tone = 'amber' THEN 1 ELSE 0 END)::int AS nemc_amber,
      MAX(CASE WHEN regulator = 'osha' AND status_tone = 'amber' THEN 1 ELSE 0 END)::int AS osha_amber
    FROM regulator_status
    WHERE tenant_id = ${tenantId}`,
  );
  const nemcAmber = (asNum(regRows[0]?.nemc_amber) ?? 0) > 0;
  const oshaAmber = (asNum(regRows[0]?.osha_amber) ?? 0) > 0;

  const incRows = await safeExecute(
    db,
    sql`SELECT COUNT(*)::int AS open_count
    FROM incidents
    WHERE tenant_id = ${tenantId}
      AND status = 'open'`,
  );
  const openIncidents = asNum(incRows[0]?.open_count) ?? 0;

  return {
    supervisorAttrition90d,
    operatorsWithExpiredIcaActive,
    royaltyDraftPctDeviation,
    nemcAmber,
    oshaAmber,
    openIncidents,
  };
}

async function resolveCounterpartyAndMarket(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const buyerRows = await safeExecute(
    db,
    sql`SELECT
      buyer_id,
      buyer_name,
      late_payment_count::int AS late_count,
      crb_score_delta::int AS crb_delta
    FROM buyer_credit_signals
    WHERE tenant_id = ${tenantId}
    LIMIT 10`,
  );
  const buyerLatePayments = buyerRows.map((r) => ({
    buyerId: String(r.buyer_id ?? 'unknown'),
    buyerName: String(r.buyer_name ?? 'Unknown buyer'),
    latePaymentCount: asNum(r.late_count) ?? 0,
    crbScoreDelta: asNum(r.crb_delta),
  }));

  const supRows = await safeExecute(
    db,
    sql`SELECT
      supplier_id,
      supplier_name,
      off_spec_count::int AS off_spec
    FROM supplier_quality_signals
    WHERE tenant_id = ${tenantId}
      AND window_days = 60
    LIMIT 10`,
  );
  const supplierQualityIssues = supRows.map((r) => ({
    supplierId: String(r.supplier_id ?? 'unknown'),
    supplierName: String(r.supplier_name ?? 'Unknown supplier'),
    offSpecCount: asNum(r.off_spec) ?? 0,
  }));

  const lbmaRows = await safeExecute(
    db,
    sql`SELECT
      ((current_fix - mean_30d) / NULLIF(std_30d, 0))::numeric AS sigma_delta
    FROM lbma_fix_summary
    WHERE asset = 'gold'
    ORDER BY captured_at DESC
    LIMIT 1`,
  );
  const lbmaFixDelta30dSigma = asNum(lbmaRows[0]?.sigma_delta);

  const fxRows = await safeExecute(
    db,
    sql`SELECT
      (intraday_high - intraday_low) / NULLIF(intraday_low, 0) * 100 AS vol_pct
    FROM fx_rates_intraday
    WHERE pair = 'USD/TZS'
    ORDER BY captured_at DESC
    LIMIT 1`,
  );
  const fxUsdTzsVolatilityPctIntraday = asNum(fxRows[0]?.vol_pct);

  const revRows = await safeExecute(
    db,
    sql`SELECT COALESCE(SUM(amount_tzs), 0)::bigint AS monthly_revenue
    FROM ledger_entries
    WHERE tenant_id = ${tenantId}
      AND entry_kind = 'revenue'
      AND posted_at > NOW() - INTERVAL '30 days'`,
  );
  const monthlyRevenueTzs = asNum(revRows[0]?.monthly_revenue);

  return {
    buyerLatePayments,
    supplierQualityIssues,
    lbmaFixDelta30dSigma,
    fxUsdTzsVolatilityPctIntraday,
    monthlyRevenueTzs,
  };
}

async function resolveEstateAndSecurity(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const sucRows = await safeExecute(
    db,
    sql`SELECT
      EXTRACT(DAY FROM (NOW() - last_reviewed_at))::int AS days_overdue,
      principal_owner_age_years::int AS age
    FROM succession_plans
    WHERE tenant_id = ${tenantId}
    ORDER BY last_reviewed_at ASC
    LIMIT 1`,
  );
  const successionReviewOverdueDays = asNum(sucRows[0]?.days_overdue);
  const principalOwnerAgeYears = asNum(sucRows[0]?.age);

  const insRows = await safeExecute(
    db,
    sql`SELECT
      id,
      policy_kind,
      EXTRACT(DAY FROM (expires_at - NOW()))::int AS days_left
    FROM insurance_policies
    WHERE tenant_id = ${tenantId}
      AND expires_at < NOW() + INTERVAL '60 days'
    ORDER BY expires_at ASC
    LIMIT 20`,
  );
  const insurancePoliciesExpiring30d = insRows
    .map((r) => ({
      policyId: String(r.id ?? 'unknown'),
      policyKind: String(r.policy_kind ?? 'unknown'),
      daysToExpiry: asNum(r.days_left) ?? 999,
    }))
    .filter((p) => p.daysToExpiry <= 60);

  const accRows = await safeExecute(
    db,
    sql`SELECT COUNT(*)::int AS anomaly_count
    FROM security_audit_events
    WHERE tenant_id = ${tenantId}
      AND event_kind = 'access_anomaly'
      AND occurred_at > NOW() - INTERVAL '1 hour'`,
  );
  const accessAnomaliesLastHour = asNum(accRows[0]?.anomaly_count) ?? 0;

  const faRows = await safeExecute(
    db,
    sql`SELECT
      COUNT(*) FILTER (WHERE event_kind = 'auth_failed')::int AS failed_auths,
      COUNT(*) FILTER (WHERE event_kind = 'suspicious_action')::int AS suspicious
    FROM security_audit_events
    WHERE tenant_id = ${tenantId}
      AND occurred_at > NOW() - INTERVAL '15 minutes'`,
  );
  const failedAuthSpike = asNum(faRows[0]?.failed_auths) ?? 0;
  const suspiciousActionCount = asNum(faRows[0]?.suspicious) ?? 0;

  return {
    successionReviewOverdueDays,
    principalOwnerAgeYears,
    insurancePoliciesExpiring30d,
    accessAnomaliesLastHour,
    failedAuthSpike,
    suspiciousActionCount,
  };
}

async function resolveReputationalAndTax(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const csrRows = await safeExecute(
    db,
    sql`SELECT COUNT(*)::int AS grievance_count
    FROM grievances
    WHERE tenant_id = ${tenantId}
      AND party_type = 'community'
      AND created_at > NOW() - INTERVAL '60 days'`,
  );
  const csrGrievances60d = asNum(csrRows[0]?.grievance_count) ?? 0;

  const cdaRows = await safeExecute(
    db,
    sql`SELECT COUNT(*)::int AS overdue_count
    FROM cda_milestones
    WHERE tenant_id = ${tenantId}
      AND status = 'overdue'`,
  );
  const cdaMilestonesOverdue = asNum(cdaRows[0]?.overdue_count) ?? 0;

  const whRows = await safeExecute(
    db,
    sql`SELECT
      COALESCE(SUM(payable_tzs), 0)::numeric AS payable,
      COALESCE(SUM(provision_tzs), 0)::numeric AS provision
    FROM withholding_tax_summary
    WHERE tenant_id = ${tenantId}`,
  );
  const withholdingTaxPayableTzs = asNum(whRows[0]?.payable);
  const withholdingProvisionTzs = asNum(whRows[0]?.provision);

  const traRows = await safeExecute(
    db,
    sql`SELECT
      BOOL_OR(inquiry_open) AS open_flag,
      MAX(EXTRACT(DAY FROM (NOW() - last_filed_at))::int) AS overdue_days
    FROM tra_correspondence
    WHERE tenant_id = ${tenantId}`,
  );
  const traInquiryOpen = Boolean(traRows[0]?.open_flag);
  const traFilingOverdueDays = asNum(traRows[0]?.overdue_days);

  return {
    csrGrievances60d,
    cdaMilestonesOverdue,
    withholdingTaxPayableTzs,
    withholdingProvisionTzs,
    traInquiryOpen,
    traFilingOverdueDays,
  };
}

async function resolveLegal(
  db: DbLike,
  tenantId: string,
): Promise<Partial<RiskScannerState>> {
  const conRows = await safeExecute(
    db,
    sql`SELECT
      id,
      counterparty_name,
      EXTRACT(DAY FROM (expires_at - NOW()))::int AS days_left,
      annual_value_tzs::numeric AS annual_value,
      EXISTS(
        SELECT 1 FROM contract_renewal_workflows w
        WHERE w.contract_id = contracts.id
          AND w.status IN ('drafting','negotiation')
      ) AS renewal_in_flight
    FROM contracts
    WHERE tenant_id = ${tenantId}
      AND expires_at > NOW()
      AND expires_at < NOW() + INTERVAL '60 days'
    ORDER BY annual_value_tzs DESC NULLS LAST
    LIMIT 3`,
  );
  const top3ContractsExpiring60d = conRows.map((r) => ({
    contractId: String(r.id ?? 'unknown'),
    counterpartyName: String(r.counterparty_name ?? 'Unknown'),
    daysToExpiry: asNum(r.days_left) ?? 999,
    annualValueTzs: asNum(r.annual_value),
    hasRenewalInFlight: Boolean(r.renewal_in_flight),
  }));

  const dispRows = await safeExecute(
    db,
    sql`SELECT
      counterparty_id,
      counterparty_name,
      COUNT(*)::int AS dispute_count
    FROM disputes
    WHERE tenant_id = ${tenantId}
      AND opened_at > NOW() - INTERVAL '90 days'
    GROUP BY counterparty_id, counterparty_name
    HAVING COUNT(*) >= 2`,
  );
  const disputeEscalations = dispRows.map((r) => ({
    counterpartyId: String(r.counterparty_id ?? 'unknown'),
    counterpartyName: String(r.counterparty_name ?? 'Unknown'),
    disputeCount90d: asNum(r.dispute_count) ?? 0,
  }));

  const scopeRows = await safeExecute(
    db,
    sql`SELECT id, name FROM sites WHERE tenant_id = ${tenantId} LIMIT 50`,
  );
  const knownScopes = scopeRows.map((r) => ({
    id: String(r.id ?? 'unknown'),
    label: String(r.name ?? 'Unknown site'),
  }));

  return {
    top3ContractsExpiring60d,
    disputeEscalations,
    knownScopes,
  };
}

// ─── State assembler ────────────────────────────────────────────────

/**
 * Default empty state — every field set to its conservative "no signal"
 * value. The resolvers overwrite the populated fields.
 */
function emptyState(tenantId: string, nowIso: string): RiskScannerState {
  return {
    tenantId,
    nowIso,
    cashRunwayDays: null,
    arOverdue60dPctOfMonthly: null,
    payrollDueInDays: null,
    payrollAmountTzs: null,
    cashOnHandTzs: null,
    nemcEiaDaysToExpiry: null,
    botExportLicenceDaysToExpiry: null,
    traFilingDaysOverdue: null,
    traPenaltyAccrualTzs: null,
    productionMomMonthsDown: 0,
    productionMomDeltaPct: null,
    fuelDaysRemaining: null,
    equipmentRepeatFailures: [],
    supervisorAttrition90d: 0,
    operatorsWithExpiredIcaActive: 0,
    royaltyDraftPctDeviation: null,
    nemcAmber: false,
    oshaAmber: false,
    openIncidents: 0,
    buyerLatePayments: [],
    supplierQualityIssues: [],
    lbmaFixDelta30dSigma: null,
    fxUsdTzsVolatilityPctIntraday: null,
    monthlyRevenueTzs: null,
    successionReviewOverdueDays: null,
    principalOwnerAgeYears: null,
    insurancePoliciesExpiring30d: [],
    accessAnomaliesLastHour: 0,
    failedAuthSpike: 0,
    suspiciousActionCount: 0,
    csrGrievances60d: 0,
    cdaMilestonesOverdue: 0,
    withholdingTaxPayableTzs: null,
    withholdingProvisionTzs: null,
    traInquiryOpen: false,
    traFilingOverdueDays: null,
    top3ContractsExpiring60d: [],
    disputeEscalations: [],
    knownScopes: [],
  };
}

export async function buildScannerState(
  tenantId: string,
  deps: RiskScannerDeps,
): Promise<RiskScannerState> {
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const base = emptyState(tenantId, nowIso);
  if (!deps.db) {
    return deps.stateOverride
      ? { ...base, ...deps.stateOverride }
      : base;
  }

  const [cash, regulatory, operational, hrAndComp, cpAndMkt, estAndSec, repAndTax, legal] =
    await Promise.all([
      resolveCashFlow(deps.db, tenantId),
      resolveRegulatory(deps.db, tenantId),
      resolveOperational(deps.db, tenantId),
      resolveHrAndCompliance(deps.db, tenantId),
      resolveCounterpartyAndMarket(deps.db, tenantId),
      resolveEstateAndSecurity(deps.db, tenantId),
      resolveReputationalAndTax(deps.db, tenantId),
      resolveLegal(deps.db, tenantId),
    ]);

  const combined: RiskScannerState = {
    ...base,
    ...cash,
    ...regulatory,
    ...operational,
    ...hrAndComp,
    ...cpAndMkt,
    ...estAndSec,
    ...repAndTax,
    ...legal,
  };
  return deps.stateOverride ? { ...combined, ...deps.stateOverride } : combined;
}

// ─── Public surface ────────────────────────────────────────────────

const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 10;

function meetsSeverityFloor(
  severity: RiskSeverity,
  floor: RiskSeverity | undefined,
): boolean {
  if (!floor) return true;
  return SEVERITY_WEIGHT[severity] >= SEVERITY_WEIGHT[floor];
}

/**
 * Apply the typed catalog to the gathered state. Returns risks ranked
 * by severity / max(1, ttd), ties broken by exposureTzs then id.
 * Caller can pre-filter via `kindFilter` / `minSeverity` / `scopeIds`.
 */
export function evaluateRisks(
  state: RiskScannerState,
  options?: ScanRisksOptions,
): ReadonlyArray<Risk> {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(MIN_LIMIT, options?.limit ?? DEFAULT_LIMIT),
  );
  const kindFilter = options?.kindFilter
    ? new Set<RiskKind>(options.kindFilter)
    : null;
  const scopeFilter = options?.scopeIds
    ? new Set<string>(options.scopeIds)
    : null;
  const minSeverity = options?.minSeverity;

  const candidates: Risk[] = [];
  for (const rule of RISK_RULES) {
    if (kindFilter && !kindFilter.has(rule.kind)) continue;
    let detected = false;
    try {
      detected = rule.detect(state);
    } catch {
      continue;
    }
    if (!detected) continue;
    let risk: Risk | null = null;
    try {
      risk = rule.evaluate(state);
    } catch {
      continue;
    }
    if (!risk) continue;
    if (!meetsSeverityFloor(risk.severity, minSeverity)) continue;
    if (scopeFilter) {
      const intersects =
        risk.relatedScopes.length === 0 ||
        risk.relatedScopes.some((id) => scopeFilter.has(id));
      if (!intersects) continue;
    }
    candidates.push(risk);
  }

  candidates.sort((a, b) => {
    const sa = scoreRisk(a);
    const sb = scoreRisk(b);
    if (sa !== sb) return sb - sa;
    const ea = a.exposureTzs ?? 0;
    const eb = b.exposureTzs ?? 0;
    if (ea !== eb) return eb - ea;
    return a.id.localeCompare(b.id);
  });

  // Dedup by ruleId (defensive — catalog ids are already unique).
  const seen = new Set<string>();
  const deduped: Risk[] = [];
  for (const risk of candidates) {
    if (seen.has(risk.ruleId)) continue;
    seen.add(risk.ruleId);
    deduped.push(risk);
    if (deduped.length >= limit) break;
  }
  return Object.freeze(deduped);
}

export async function scanRisks(
  tenantId: string,
  deps: RiskScannerDeps,
  options?: ScanRisksOptions,
): Promise<ReadonlyArray<Risk>> {
  const state = await buildScannerState(tenantId, deps);
  return evaluateRisks(state, options);
}

// ─── Catalog metadata ──────────────────────────────────────────────

export function listRules(): ReadonlyArray<RiskRule> {
  return RISK_RULES;
}

export function countRulesByKind(): Readonly<Record<RiskKind, number>> {
  const counts: Record<RiskKind, number> = {
    cash_flow: 0,
    regulatory: 0,
    operational: 0,
    hr: 0,
    compliance: 0,
    counterparty: 0,
    market: 0,
    estate: 0,
    security: 0,
    reputational: 0,
    tax: 0,
    legal: 0,
  };
  for (const rule of RISK_RULES) {
    counts[rule.kind] += 1;
  }
  return Object.freeze(counts);
}
