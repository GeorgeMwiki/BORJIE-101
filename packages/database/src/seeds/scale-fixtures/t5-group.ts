/**
 * T5 Multi-country group scale fixture — cross-border mining holdings.
 *
 * 4 subsidiaries spanning Tanzania, Kenya, Uganda, DRC; multi-currency
 * consolidation; cross-border settlement. Cockpit shows 20 default tabs;
 * brain register is strategic / group.
 *
 * As with T4 we keep the employee sample small (the actual count lives
 * in `scaleSignals.workerCount`). The fixture's purpose is to verify
 * multi-currency rendering, regulator-set joins, and group KPI roll-ups.
 */

import type { ScaleFixture } from './types.js';

const SITES = [
  { id: 'fx-t5-site-001', name: 'Geita (TZ) ML 02', mineral: 'gold' },
  { id: 'fx-t5-site-002', name: 'Migori (KE) ML 01', mineral: 'gold' },
  { id: 'fx-t5-site-003', name: 'Mubende (UG) ML 03', mineral: 'gold' },
  { id: 'fx-t5-site-004', name: 'Kolwezi (DRC) ML 05', mineral: 'cobalt' },
  { id: 'fx-t5-site-005', name: 'Kolwezi (DRC) ML 06', mineral: 'copper' },
];

export const T5_GROUP_FIXTURE: ScaleFixture = Object.freeze({
  tier: 't5_multi_country',
  tenantId: 'fx-t5-001',
  tenantName: 'Pan-African Mining Holdings',
  // Group-level country is the holdco jurisdiction.
  country: 'TZ',
  defaultLanguage: 'en',
  primaryCurrency: 'USD',
  scaleSignals: {
    workerCount: 3_400,
    siteCount: 5,
    mineralCount: 3,
    crossBorder: true,
  },
  sites: SITES.map((s) => ({ ...s, phase: 'extraction' as const })),
  employees: Object.freeze(
    Array.from({ length: 80 }, (_, i) => ({
      id: `fx-t5-emp-${String(i + 1).padStart(4, '0')}`,
      siteId: SITES[i % SITES.length]?.id ?? SITES[0]!.id,
      fullName: `Group Personnel ${i + 1}`,
      role:
        i === 0
          ? 'group_ceo'
          : i === 1
            ? 'group_cfo'
            : i === 2
              ? 'group_compliance_head'
              : i < 8
                ? 'subsidiary_md'
                : i < 18
                  ? 'finance_consolidation'
                  : i < 30
                    ? 'cross_border_treasurer'
                    : i < 45
                      ? 'regulator_liaison'
                      : 'supervisor',
    })),
  ),
  sales: [
    {
      id: 'fx-t5-sale-001',
      buyerName: 'LBMA-registered refiner',
      mineral: 'gold',
      grams: 480_000,
      priceTzs: 86_400_000_000,
    },
    {
      id: 'fx-t5-sale-002',
      buyerName: 'CMOC Group',
      mineral: 'cobalt',
      grams: 12_000_000,
      priceTzs: 19_200_000_000,
    },
    {
      id: 'fx-t5-sale-003',
      buyerName: 'Glencore Marketing',
      mineral: 'copper',
      grams: 24_000_000,
      priceTzs: 9_600_000_000,
    },
  ],
  blurbEn:
    'Pan-African mining holding group: gold, cobalt, copper across TZ / KE / UG / DRC.',
  blurbSw:
    'Kundi la mali ya madini la Afrika: dhahabu, cobalt, shaba katika TZ / KE / UG / DRC.',
});
