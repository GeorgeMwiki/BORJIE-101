/**
 * T1 Artisanal scale fixture — single-pit owner-operator.
 *
 * 1 worker (the owner), 1 pit, 1 mineral, single-currency. The smallest
 * shape Borjie supports. Useful for testing the 4-tab cockpit, the
 * artisanal Mr. Mwikila persona, and the lite orchestration flows.
 *
 * Tenant id is deterministic so seeds + tests can reference it without
 * passing it through env vars.
 */

import type { ScaleFixture } from './types.js';

export const T1_ARTISANAL_FIXTURE: ScaleFixture = Object.freeze({
  tier: 't1_artisanal',
  tenantId: 'fx-t1-001',
  tenantName: 'Mzee Juma Solo Pit',
  country: 'TZ',
  defaultLanguage: 'sw',
  primaryCurrency: 'TZS',
  scaleSignals: {
    workerCount: 1,
    siteCount: 1,
    mineralCount: 1,
    crossBorder: false,
  },
  sites: [
    {
      id: 'fx-t1-site-001',
      name: 'Singida Pit (Juma)',
      mineral: 'gold',
      phase: 'extraction',
    },
  ],
  employees: [
    {
      id: 'fx-t1-emp-001',
      siteId: 'fx-t1-site-001',
      fullName: 'Mzee Juma Said',
      role: 'owner_operator',
    },
  ],
  sales: [
    {
      id: 'fx-t1-sale-001',
      buyerName: 'Singida Buyers Co-op',
      mineral: 'gold',
      grams: 12,
      priceTzs: 2_160_000,
    },
  ],
  blurbEn: 'Solo artisanal gold miner working a single pit in Singida.',
  blurbSw: 'Mchimbaji mdogo wa dhahabu, shimo moja Singida.',
});
