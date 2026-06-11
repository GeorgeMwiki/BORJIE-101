/**
 * Mining-estate forecast targets (Borjie / Mr. Mwikila).
 *
 * Each maps a target to its recommended method + horizon, drawn from the
 * targets dossier (PART A). Royalty (A6) and licence (A10) are
 * 'rule-based+overlay' — the statutory formula / deadline engine stays
 * authoritative; the forecast only bands the uncertain INPUTS.
 */

import type { ForecastTargetDef } from './types.js';

export const MINING_TARGETS: ReadonlyArray<ForecastTargetDef> = [
  {
    id: 'mining.A1.commodity_price',
    domain: 'mining-estate',
    label: 'Mineral / commodity price',
    method: 'tsfm',
    defaultHorizon: 30,
    targetCoverage: 0.9,
    highRisk: true,
    monetary: true,
  },
  {
    id: 'mining.A2.fx_rate',
    domain: 'mining-estate',
    label: 'FX rate (TZS/KES/UGX/NGN)',
    method: 'tsfm',
    defaultHorizon: 30,
    targetCoverage: 0.9,
    highRisk: true,
    monetary: true,
  },
  {
    id: 'mining.A3.ore_grade_yield',
    domain: 'mining-estate',
    label: 'Production yield / ore grade',
    method: 'classical-floor',
    defaultHorizon: 7,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: false,
  },
  {
    id: 'mining.A4.equipment_rul',
    domain: 'mining-estate',
    label: 'Equipment failure / RUL (predictive maintenance)',
    method: 'classical-floor',
    defaultHorizon: 14,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: false,
  },
  {
    id: 'mining.A5.treasury_cashflow',
    domain: 'mining-estate',
    label: 'Treasury / cash-flow',
    method: 'classical-floor',
    defaultHorizon: 13,
    targetCoverage: 0.9,
    highRisk: true,
    monetary: true,
  },
  {
    id: 'mining.A6.royalty_accrual',
    domain: 'mining-estate',
    label: 'Royalty liability accrual',
    method: 'rule-based+overlay',
    defaultHorizon: 30,
    targetCoverage: 0.9,
    highRisk: true,
    monetary: true,
  },
  {
    id: 'mining.A7.offtake_demand',
    domain: 'mining-estate',
    label: 'Demand / offtake (clearing price + time-to-sell)',
    method: 'classical-floor',
    defaultHorizon: 14,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: true,
  },
  {
    id: 'mining.A8.attrition',
    domain: 'mining-estate',
    label: 'Workforce attrition',
    method: 'classical-floor',
    defaultHorizon: 30,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: false,
  },
  {
    id: 'mining.A9.safety_incident',
    domain: 'mining-estate',
    label: 'Safety-incident risk',
    method: 'intermittent',
    defaultHorizon: 7,
    targetCoverage: 0.9,
    highRisk: true,
    monetary: false,
  },
  {
    id: 'mining.A10.licence_deadline',
    domain: 'mining-estate',
    label: 'Licence / compliance deadline risk',
    method: 'rule-based+overlay',
    defaultHorizon: 30,
    targetCoverage: 0.95,
    highRisk: true,
    monetary: false,
  },
  {
    id: 'mining.A11.prospectivity',
    domain: 'mining-estate',
    label: 'Exploration prospectivity',
    method: 'classical-floor',
    defaultHorizon: 90,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: false,
  },
];
