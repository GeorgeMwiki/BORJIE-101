/**
 * Real-estate forecast targets (BossNyumba — shares the spine).
 *
 * Maps the targets dossier PART B set to method + horizon.
 */

import type { ForecastTargetDef } from './types.js';

export const REAL_ESTATE_TARGETS: ReadonlyArray<ForecastTargetDef> = [
  {
    id: 're.B1.avm_valuation',
    domain: 'real-estate',
    label: 'Property valuation (AVM)',
    method: 'classical-floor',
    defaultHorizon: 12,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: true,
  },
  {
    id: 're.B2.rent_occupancy_vacancy',
    domain: 'real-estate',
    label: 'Rent / occupancy / vacancy',
    method: 'classical-floor',
    defaultHorizon: 12,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: true,
  },
  {
    id: 're.B3.absorption',
    domain: 'real-estate',
    label: 'Demand & absorption (lease-up)',
    method: 'classical-floor',
    defaultHorizon: 6,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: false,
  },
  {
    id: 're.B4.maintenance_capex',
    domain: 'real-estate',
    label: 'Maintenance / capex',
    method: 'intermittent',
    defaultHorizon: 12,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: true,
  },
  {
    id: 're.B5.construction_cost_schedule',
    domain: 'real-estate',
    label: 'Construction cost & schedule risk',
    method: 'tsfm',
    defaultHorizon: 12,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: true,
  },
  {
    id: 're.B6.market_cycle',
    domain: 'real-estate',
    label: 'Market-cycle turning points',
    method: 'tsfm',
    defaultHorizon: 12,
    targetCoverage: 0.9,
    highRisk: false,
    monetary: false,
  },
];
