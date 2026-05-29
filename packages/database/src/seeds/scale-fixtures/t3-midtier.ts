/**
 * T3 Mid-tier scale fixture — multi-site mining company.
 *
 * ~180 workers across 5 sites, manager + admin layer, monthly payroll.
 * The cockpit shows 11 default tabs; the brain register is managerial.
 */

import type { ScaleFixture } from './types.js';

const SITES = [
  { id: 'fx-t3-site-001', name: 'Geita PML 12', mineral: 'gold' as const },
  { id: 'fx-t3-site-002', name: 'Geita PML 18', mineral: 'gold' as const },
  { id: 'fx-t3-site-003', name: 'Lupa ML 03', mineral: 'gold' as const },
  { id: 'fx-t3-site-004', name: 'Buhemba PL 09', mineral: 'copper' as const },
  { id: 'fx-t3-site-005', name: 'Mpanda PML 07', mineral: 'gold' as const },
];

export const T3_MIDTIER_FIXTURE: ScaleFixture = Object.freeze({
  tier: 't3_midtier',
  tenantId: 'fx-t3-001',
  tenantName: 'Geita Lakeside Mining Ltd',
  country: 'TZ',
  defaultLanguage: 'sw',
  primaryCurrency: 'TZS',
  scaleSignals: {
    workerCount: 180,
    siteCount: 5,
    mineralCount: 2,
    crossBorder: false,
  },
  sites: SITES.map((s) => ({ ...s, phase: 'extraction' as const })),
  employees: Object.freeze(
    Array.from({ length: 180 }, (_, i) => ({
      id: `fx-t3-emp-${String(i + 1).padStart(4, '0')}`,
      siteId: SITES[i % SITES.length]?.id ?? SITES[0]!.id,
      fullName: `Worker ${i + 1}`,
      role:
        i === 0
          ? 'general_manager'
          : i < 6
            ? 'site_manager'
            : i < 16
              ? 'supervisor'
              : i % 5 === 0
                ? 'geologist'
                : 'driller',
    })),
  ),
  sales: [
    {
      id: 'fx-t3-sale-001',
      buyerName: 'Geita Smelter Ltd',
      mineral: 'gold',
      grams: 12_400,
      priceTzs: 2_232_000_000,
    },
    {
      id: 'fx-t3-sale-002',
      buyerName: 'Lake Victoria Refiners',
      mineral: 'copper',
      grams: 4_800_000,
      priceTzs: 384_000_000,
    },
  ],
  blurbEn:
    'Mid-tier Tanzanian gold + copper miner running five licensed sites.',
  blurbSw:
    'Mgodi wa kati wa Tanzania, dhahabu + shaba, vituo vitano vya leseni.',
});
