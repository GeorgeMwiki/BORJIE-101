/**
 * T2 Cooperative scale fixture — multi-pit cooperative, weekly settlement.
 *
 * ~20 workers across 3 pits, 1-2 supervisors. The "Mererani-style"
 * cooperative shape that drives Borjie's settlement-period UI and the
 * weekly-cadence Mr. Mwikila register.
 */

import type { ScaleFixture } from './types.js';

export const T2_COOPERATIVE_FIXTURE: ScaleFixture = Object.freeze({
  tier: 't2_cooperative',
  tenantId: 'fx-t2-001',
  tenantName: 'Mererani Block C Coop',
  country: 'TZ',
  defaultLanguage: 'sw',
  primaryCurrency: 'TZS',
  scaleSignals: {
    workerCount: 22,
    siteCount: 3,
    mineralCount: 1,
    crossBorder: false,
  },
  sites: [
    {
      id: 'fx-t2-site-001',
      name: 'Block C Pit 1',
      mineral: 'tanzanite',
      phase: 'extraction',
    },
    {
      id: 'fx-t2-site-002',
      name: 'Block C Pit 4',
      mineral: 'tanzanite',
      phase: 'extraction',
    },
    {
      id: 'fx-t2-site-003',
      name: 'Block C Pit 7 (new)',
      mineral: 'tanzanite',
      phase: 'exploration',
    },
  ],
  employees: Object.freeze(
    Array.from({ length: 22 }, (_, i) => ({
      id: `fx-t2-emp-${String(i + 1).padStart(3, '0')}`,
      siteId: `fx-t2-site-00${(i % 3) + 1}`,
      fullName: `Coop Member ${i + 1}`,
      role: i === 0 ? 'foreman' : i === 1 ? 'supervisor' : 'driller',
    })),
  ),
  sales: [
    {
      id: 'fx-t2-sale-001',
      buyerName: 'Tanzanite House Ltd',
      mineral: 'tanzanite',
      grams: 320,
      priceTzs: 96_000_000,
    },
    {
      id: 'fx-t2-sale-002',
      buyerName: 'Arusha Dealers Coop',
      mineral: 'tanzanite',
      grams: 180,
      priceTzs: 54_000_000,
    },
  ],
  blurbEn:
    'Mid-size tanzanite cooperative running three pits with weekly settlement.',
  blurbSw:
    'Ushirika wa tanzanite wa kati, mashimo matatu, malipo ya kila wiki.',
});
