/**
 * Role-default KPI templates (Wave PERF-1).
 *
 * Five seeds cover the most common Tanzanian mining-org headcount.
 * Tenants override or extend them via the `kpi_templates` table —
 * see Docs/DESIGN/EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC.md §3.
 *
 * Each role's `kpi_definitions[].weight` array MUST sum to 1.0;
 * `validateRoleTemplate` enforces this at load time.
 */

import {
  EmployeePerfFollowupError,
  SEED_TENANT_ID,
  type Kpi,
  type RoleKey,
  type RoleKpiTemplate,
} from '../types.js';

// -----------------------------------------------------------------------------
// Foreman — operational supervisor
// -----------------------------------------------------------------------------

const FOREMAN_KPIS: ReadonlyArray<Kpi> = [
  {
    id: 'foreman.tonnage_hauled_pct_of_plan',
    label: 'Tonnage hauled (vs. planned)',
    target: 0.95,
    weight: 0.45,
    measure_fn_name: 'tonnage_pct_of_plan',
    direction: 'higher_is_better',
  },
  {
    id: 'foreman.safety_incidents',
    label: 'Safety incidents',
    target: 0,
    weight: 0.3,
    measure_fn_name: 'safety_incidents_count',
    direction: 'lower_is_better',
  },
  {
    id: 'foreman.briefings_on_time',
    label: 'On-time daily briefings',
    target: 1.0,
    weight: 0.15,
    measure_fn_name: 'briefings_on_time_pct',
    direction: 'higher_is_better',
  },
  {
    id: 'foreman.stockpile_reconciliation_accuracy',
    label: 'Stockpile reconciliation accuracy',
    target: 0.98,
    weight: 0.1,
    measure_fn_name: 'stockpile_reconciliation_pct',
    direction: 'higher_is_better',
  },
];

// -----------------------------------------------------------------------------
// Geologist
// -----------------------------------------------------------------------------

const GEOLOGIST_KPIS: ReadonlyArray<Kpi> = [
  {
    id: 'geologist.surveys_completed_pct',
    label: 'Surveys completed (vs. planned)',
    target: 1.0,
    weight: 0.35,
    measure_fn_name: 'surveys_completed_pct',
    direction: 'higher_is_better',
  },
  {
    id: 'geologist.assay_accuracy_drift_pct',
    label: 'Assay accuracy vs. external lab',
    target: 0.02,
    weight: 0.35,
    measure_fn_name: 'assay_drift_pct',
    direction: 'lower_is_better',
  },
  {
    id: 'geologist.sample_chain_of_custody_pct',
    label: 'Sample chain-of-custody integrity',
    target: 1.0,
    weight: 0.2,
    measure_fn_name: 'sample_chain_pct',
    direction: 'higher_is_better',
  },
  {
    id: 'geologist.note_quality_nlp_score',
    label: 'Geological note quality (NLP score)',
    target: 0.7,
    weight: 0.1,
    measure_fn_name: 'note_quality_score',
    direction: 'higher_is_better',
  },
];

// -----------------------------------------------------------------------------
// Driver — haulage / fleet
// -----------------------------------------------------------------------------

const DRIVER_KPIS: ReadonlyArray<Kpi> = [
  {
    id: 'driver.trips_on_time_pct',
    label: 'Trips completed on time',
    target: 0.95,
    weight: 0.4,
    measure_fn_name: 'trips_on_time_pct',
    direction: 'higher_is_better',
  },
  {
    id: 'driver.fuel_efficiency_ratio',
    label: 'Fuel efficiency (km/L vs. baseline)',
    target: 1.0,
    weight: 0.25,
    measure_fn_name: 'fuel_efficiency_ratio',
    direction: 'higher_is_better',
  },
  {
    id: 'driver.safety_incidents',
    label: 'Safety incidents',
    target: 0,
    weight: 0.25,
    measure_fn_name: 'safety_incidents_count',
    direction: 'lower_is_better',
  },
  {
    id: 'driver.pre_trip_inspection_pct',
    label: 'Pre-trip inspection completed',
    target: 1.0,
    weight: 0.1,
    measure_fn_name: 'pre_trip_inspection_pct',
    direction: 'higher_is_better',
  },
];

// -----------------------------------------------------------------------------
// Accountant — filing & finance
// -----------------------------------------------------------------------------

const ACCOUNTANT_KPIS: ReadonlyArray<Kpi> = [
  {
    id: 'accountant.filings_on_time_pct',
    label: 'Regulator filings submitted on time',
    target: 1.0,
    weight: 0.4,
    measure_fn_name: 'filings_on_time_pct',
    direction: 'binary_target',
  },
  {
    id: 'accountant.reconciliation_completion_pct',
    label: 'Reconciliation completion rate',
    target: 0.98,
    weight: 0.3,
    measure_fn_name: 'reconciliation_pct',
    direction: 'higher_is_better',
  },
  {
    id: 'accountant.documentation_completeness',
    label: 'Documentation completeness',
    target: 0.9,
    weight: 0.2,
    measure_fn_name: 'documentation_completeness_score',
    direction: 'higher_is_better',
  },
  {
    id: 'accountant.variance_flag_turnaround_hours',
    label: 'Variance-flag turnaround (hours)',
    target: 4,
    weight: 0.1,
    measure_fn_name: 'variance_turnaround_hours',
    direction: 'lower_is_better',
  },
];

// -----------------------------------------------------------------------------
// Owner — portfolio-level
// -----------------------------------------------------------------------------

const OWNER_KPIS: ReadonlyArray<Kpi> = [
  {
    id: 'owner.tier2_approval_turnaround_hours',
    label: 'Tier-2-Critical owner approvals turnaround',
    target: 24,
    weight: 0.3,
    measure_fn_name: 'tier2_turnaround_hours',
    direction: 'lower_is_better',
  },
  {
    id: 'owner.portfolio_production_pct_of_plan',
    label: 'Portfolio-level production vs. plan',
    target: 0.95,
    weight: 0.3,
    measure_fn_name: 'portfolio_production_pct',
    direction: 'higher_is_better',
  },
  {
    id: 'owner.cash_runway_ratio',
    label: 'Cash runway vs. plan',
    target: 1.0,
    weight: 0.25,
    measure_fn_name: 'cash_runway_ratio',
    direction: 'higher_is_better',
  },
  {
    id: 'owner.regulator_portfolio_compliance_pct',
    label: 'Regulator portfolio compliance',
    target: 1.0,
    weight: 0.15,
    measure_fn_name: 'portfolio_compliance_pct',
    direction: 'higher_is_better',
  },
];

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

const KPI_BY_ROLE: Readonly<Record<RoleKey, ReadonlyArray<Kpi>>> = {
  foreman: FOREMAN_KPIS,
  geologist: GEOLOGIST_KPIS,
  driver: DRIVER_KPIS,
  accountant: ACCOUNTANT_KPIS,
  owner: OWNER_KPIS,
};

/** Tolerance for weight-sum drift due to floating-point arithmetic. */
const WEIGHT_SUM_EPSILON = 1e-6;

/**
 * Validate that a template's weights sum to 1.0 (within epsilon).
 * Throws an `EmployeePerfFollowupError` with code `weight_sum_invalid`
 * if not.
 */
export function validateRoleTemplate(template: RoleKpiTemplate): void {
  const sum = template.kpi_definitions.reduce(
    (acc, k) => acc + k.weight,
    0,
  );
  if (Math.abs(sum - 1.0) > WEIGHT_SUM_EPSILON) {
    throw new EmployeePerfFollowupError(
      `KPI weights for role '${template.role}' must sum to 1.0; got ${sum}.`,
      'weight_sum_invalid',
    );
  }
}

/**
 * Build a platform-seed `RoleKpiTemplate` for the given role key.
 * Seeds use the `__seed__` sentinel tenant id and are read-visible to
 * every tenant per migration 0058's RLS policy.
 */
export function buildSeedTemplate(
  role: RoleKey,
  nowIso: string,
): RoleKpiTemplate {
  const kpis = KPI_BY_ROLE[role];
  const template: RoleKpiTemplate = {
    id: `seed-${role}`,
    tenant_id: SEED_TENANT_ID,
    role,
    kpi_definitions: kpis,
    audit_hash: '',
    created_at: nowIso,
    updated_at: nowIso,
  };
  validateRoleTemplate(template);
  return template;
}

/**
 * Return all five platform-seed templates. Used by the registry
 * bootstrap at host startup.
 */
export function buildAllSeedTemplates(
  nowIso: string,
): ReadonlyArray<RoleKpiTemplate> {
  return (['foreman', 'geologist', 'driver', 'accountant', 'owner'] as const).map(
    (role) => buildSeedTemplate(role, nowIso),
  );
}

/**
 * Re-export the role-specific seed array for callers that want to
 * splice in additional KPIs without rebuilding the whole template.
 */
export const SEED_KPIS_BY_ROLE = KPI_BY_ROLE;
