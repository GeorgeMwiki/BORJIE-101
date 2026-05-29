/**
 * T4 Industrial scale fixture — multi-region mining operation.
 *
 * ~1,200 workers across 8 sites in 3 regions, full finance + compliance
 * teams. Cockpit shows 16 default tabs; brain speaks executive register.
 *
 * To keep the fixture small we model 1,200 workers as a representative
 * 60-entry sample (the actual count lives in `scaleSignals.workerCount`
 * and is what auto-detect reads). UI density tests can synthesise the
 * remainder.
 */

import type { ScaleFixture } from './types.js';

const SITES = [
  { id: 'fx-t4-site-001', name: 'Bulyanhulu ML 02', mineral: 'gold' },
  { id: 'fx-t4-site-002', name: 'Bulyanhulu ML 03', mineral: 'gold' },
  { id: 'fx-t4-site-003', name: 'North Mara ML 01', mineral: 'gold' },
  { id: 'fx-t4-site-004', name: 'Buzwagi ML 02', mineral: 'gold' },
  { id: 'fx-t4-site-005', name: 'Williamson Diamond ML', mineral: 'diamond' },
  { id: 'fx-t4-site-006', name: 'Kabanga Nickel PL 01', mineral: 'nickel' },
  { id: 'fx-t4-site-007', name: 'Kabanga Nickel PL 02', mineral: 'nickel' },
  { id: 'fx-t4-site-008', name: 'Mtwara Graphite PL 01', mineral: 'graphite' },
];

export const T4_INDUSTRIAL_FIXTURE: ScaleFixture = Object.freeze({
  tier: 't4_industrial',
  tenantId: 'fx-t4-001',
  tenantName: 'Tanzania Mining Industries plc',
  country: 'TZ',
  defaultLanguage: 'en',
  primaryCurrency: 'TZS',
  scaleSignals: {
    workerCount: 1_200,
    siteCount: 8,
    mineralCount: 4,
    crossBorder: false,
  },
  sites: SITES.map((s) => ({ ...s, phase: 'extraction' as const })),
  employees: Object.freeze(
    Array.from({ length: 60 }, (_, i) => ({
      id: `fx-t4-emp-${String(i + 1).padStart(4, '0')}`,
      siteId: SITES[i % SITES.length]?.id ?? SITES[0]!.id,
      fullName: `Industrial Worker ${i + 1}`,
      role:
        i === 0
          ? 'ceo'
          : i === 1
            ? 'cfo'
            : i === 2
              ? 'coo'
              : i < 10
                ? 'general_manager'
                : i < 18
                  ? 'site_manager'
                  : i < 28
                    ? 'finance_analyst'
                    : i < 38
                      ? 'safety_officer'
                      : 'supervisor',
    })),
  ),
  sales: [
    {
      id: 'fx-t4-sale-001',
      buyerName: 'PrimeRefiners International',
      mineral: 'gold',
      grams: 240_000,
      priceTzs: 43_200_000_000,
    },
    {
      id: 'fx-t4-sale-002',
      buyerName: 'KGK Diamonds',
      mineral: 'diamond',
      grams: 1_800,
      priceTzs: 28_800_000_000,
    },
    {
      id: 'fx-t4-sale-003',
      buyerName: 'Sumitomo Metal Mining',
      mineral: 'nickel',
      grams: 18_000_000,
      priceTzs: 14_400_000_000,
    },
  ],
  blurbEn:
    'Industrial-scale Tanzania mining major. Multi-mineral, multi-site, full compliance + finance teams.',
  blurbSw:
    'Kampuni kubwa ya viwanda Tanzania. Madini mengi, vituo vingi, timu kamili za uzingativu + fedha.',
});
