/**
 * Sample mineral-buyer identities + offtake agreements + ledger entries +
 * site-maintenance cases used by demo-org-seed.ts.
 *
 * All data is FAKE. Names are plausible Swahili/Tanzanian placeholders,
 * phone numbers use TZ dialing code 255 with fictitious subscriber numbers,
 * and emails use the reserved @example.com domain (RFC 2606).
 *
 * Amounts are denominated in minor units (2 dp) of the seed's target
 * currency — which defaults to TZS but is reinterpreted as the demo
 * country's currency (KES, UGX, ...) when demo-org-seed.ts runs with
 * `--country=KE|UG|...`. The numeric magnitudes stay the same; consumers
 * read `DEMO_CURRENCY` from the seed runner. See
 * packages/database/src/seeds/demo-org-seed.ts for the country resolver
 * and packages/domain-models/src/common/region-config.ts for the
 * authoritative per-country minor-unit table.
 */

export interface SampleBuyerIdentity {
  readonly externalRef: string; // stable natural key used for idempotence
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string; // normalized E.164 without '+'
  readonly email: string;
  readonly occupation: string;
  readonly monthlyTurnoverTzsMinor: number;
}

export interface SampleOfftake {
  readonly externalRef: string;
  readonly buyerRef: string;
  readonly siteRef: string;
  readonly blockRef: string;
  readonly monthlyRoyaltyTzsMinor: number;
  readonly startOffsetMonths: number; // negative = in the past
  readonly termMonths: number;
  readonly depositMultiplier: number;
}

export interface SamplePayment {
  readonly externalRef: string;
  readonly offtakeRef: string;
  readonly buyerRef: string;
  readonly amountTzsMinor: number;
  readonly periodOffsetMonths: number; // relative to offtake start
  readonly daysLate: number; // 0 = on-time, > 0 = late
}

export interface SampleSiteMaintenanceCase {
  readonly externalRef: string;
  readonly siteRef: string;
  readonly buyerRef: string | null;
  readonly title: string;
  readonly description: string;
  readonly category:
    | 'plumbing'
    | 'electrical'
    | 'structural'
    | 'hvac'
    | 'general';
  readonly priority: 'low' | 'medium' | 'high' | 'urgent';
  readonly estimatedCostTzsMinor: number;
  readonly submittedDaysAgo: number;
}

// ---------------------------------------------------------------------------
// 20 sample mineral-buyer identities
// ---------------------------------------------------------------------------
export const SAMPLE_BUYERS: readonly SampleBuyerIdentity[] = [
  { externalRef: 'demo-t-001', firstName: 'Amani',  lastName: 'Mwakalinga', phone: '255712000001', email: 'amani.mwakalinga@example.com',  occupation: 'Gold room manager',    monthlyTurnoverTzsMinor: 180_000_00 },
  { externalRef: 'demo-t-002', firstName: 'Baraka', lastName: 'Kileo',      phone: '255712000002', email: 'baraka.kileo@example.com',       occupation: 'Logistics agent',      monthlyTurnoverTzsMinor: 140_000_00 },
  { externalRef: 'demo-t-003', firstName: 'Chausiku', lastName: 'Mrema',    phone: '255712000003', email: 'chausiku.mrema@example.com',     occupation: 'Mineral broker',       monthlyTurnoverTzsMinor: 220_000_00 },
  { externalRef: 'demo-t-004', firstName: 'Daudi',  lastName: 'Shayo',      phone: '255712000004', email: 'daudi.shayo@example.com',        occupation: 'Small-scale miner',    monthlyTurnoverTzsMinor:  95_000_00 },
  { externalRef: 'demo-t-005', firstName: 'Esther', lastName: 'Mushi',      phone: '255712000005', email: 'esther.mushi@example.com',       occupation: 'Gold wholesaler',      monthlyTurnoverTzsMinor: 310_000_00 },
  { externalRef: 'demo-t-006', firstName: 'Faraja', lastName: 'Kimaro',     phone: '255712000006', email: 'faraja.kimaro@example.com',      occupation: 'Mining-hardware retailer', monthlyTurnoverTzsMinor: 175_000_00 },
  { externalRef: 'demo-t-007', firstName: 'Goodluck', lastName: 'Mwanga',   phone: '255712000007', email: 'goodluck.mwanga@example.com',    occupation: 'Cement distributor',   monthlyTurnoverTzsMinor: 420_000_00 },
  { externalRef: 'demo-t-008', firstName: 'Halima', lastName: 'Juma',       phone: '255712000008', email: 'halima.juma@example.com',        occupation: 'Gemstone exporter',    monthlyTurnoverTzsMinor: 260_000_00 },
  { externalRef: 'demo-t-009', firstName: 'Ibrahim', lastName: 'Ndege',     phone: '255712000009', email: 'ibrahim.ndege@example.com',      occupation: 'Fuel reseller',        monthlyTurnoverTzsMinor: 500_000_00 },
  { externalRef: 'demo-t-010', firstName: 'Jamila', lastName: 'Kisanji',    phone: '255712000010', email: 'jamila.kisanji@example.com',     occupation: 'Cooperative agent',    monthlyTurnoverTzsMinor: 130_000_00 },
  { externalRef: 'demo-t-011', firstName: 'Kassim', lastName: 'Magige',     phone: '255712000011', email: 'kassim.magige@example.com',      occupation: 'Coltan trader',        monthlyTurnoverTzsMinor: 110_000_00 },
  { externalRef: 'demo-t-012', firstName: 'Lilian', lastName: 'Mlowezi',    phone: '255712000012', email: 'lilian.mlowezi@example.com',     occupation: 'Reagent importer',     monthlyTurnoverTzsMinor: 285_000_00 },
  { externalRef: 'demo-t-013', firstName: 'Musa',   lastName: 'Kitunda',    phone: '255712000013', email: 'musa.kitunda@example.com',       occupation: 'Pit foreman',          monthlyTurnoverTzsMinor: 165_000_00 },
  { externalRef: 'demo-t-014', firstName: 'Neema',  lastName: 'Masawe',     phone: '255712000014', email: 'neema.masawe@example.com',       occupation: 'Logistics organizer',  monthlyTurnoverTzsMinor: 200_000_00 },
  { externalRef: 'demo-t-015', firstName: 'Omari',  lastName: 'Suleiman',   phone: '255712000015', email: 'omari.suleiman@example.com',     occupation: 'Tin-ore processor',    monthlyTurnoverTzsMinor: 240_000_00 },
  { externalRef: 'demo-t-016', firstName: 'Pendo',  lastName: 'Nyerere',    phone: '255712000016', email: 'pendo.nyerere@example.com',      occupation: 'Cooperative clerk',    monthlyTurnoverTzsMinor: 120_000_00 },
  { externalRef: 'demo-t-017', firstName: 'Rajabu', lastName: 'Chuma',      phone: '255712000017', email: 'rajabu.chuma@example.com',       occupation: 'Metal fabricator',     monthlyTurnoverTzsMinor: 190_000_00 },
  { externalRef: 'demo-t-018', firstName: 'Saida',  lastName: 'Mtui',       phone: '255712000018', email: 'saida.mtui@example.com',         occupation: 'Mining cooperative',   monthlyTurnoverTzsMinor: 100_000_00 },
  { externalRef: 'demo-t-019', firstName: 'Tumaini', lastName: 'Kalinga',   phone: '255712000019', email: 'tumaini.kalinga@example.com',    occupation: 'Haulage operator',     monthlyTurnoverTzsMinor: 370_000_00 },
  { externalRef: 'demo-t-020', firstName: 'Upendo', lastName: 'Sawe',       phone: '255712000020', email: 'upendo.sawe@example.com',        occupation: 'Assay-lab owner',      monthlyTurnoverTzsMinor: 330_000_00 },
];

// ---------------------------------------------------------------------------
// 15 sample offtake agreements referencing the sample mining sites in
// demo-org-seed.ts. siteRef / blockRef stable IDs are materialized by the
// seed runner.
// ---------------------------------------------------------------------------
export const SAMPLE_OFFTAKES: readonly SampleOfftake[] = [
  { externalRef: 'demo-l-001', buyerRef: 'demo-t-001', siteRef: 'demo-prop-wh-01', blockRef: 'demo-unit-wh-01-a', monthlyRoyaltyTzsMinor: 250_000_00, startOffsetMonths: -8,  termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-002', buyerRef: 'demo-t-002', siteRef: 'demo-prop-wh-02', blockRef: 'demo-unit-wh-02-a', monthlyRoyaltyTzsMinor: 180_000_00, startOffsetMonths: -5,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-003', buyerRef: 'demo-t-003', siteRef: 'demo-prop-wh-03', blockRef: 'demo-unit-wh-03-a', monthlyRoyaltyTzsMinor: 320_000_00, startOffsetMonths: -11, termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-004', buyerRef: 'demo-t-004', siteRef: 'demo-prop-gd-01', blockRef: 'demo-unit-gd-01-a', monthlyRoyaltyTzsMinor:  95_000_00, startOffsetMonths: -3,  termMonths: 12, depositMultiplier: 1 },
  { externalRef: 'demo-l-005', buyerRef: 'demo-t-005', siteRef: 'demo-prop-gd-02', blockRef: 'demo-unit-gd-02-a', monthlyRoyaltyTzsMinor: 410_000_00, startOffsetMonths: -6,  termMonths: 36, depositMultiplier: 3 },
  { externalRef: 'demo-l-006', buyerRef: 'demo-t-006', siteRef: 'demo-prop-wh-04', blockRef: 'demo-unit-wh-04-a', monthlyRoyaltyTzsMinor: 220_000_00, startOffsetMonths: -10, termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-007', buyerRef: 'demo-t-007', siteRef: 'demo-prop-wh-05', blockRef: 'demo-unit-wh-05-a', monthlyRoyaltyTzsMinor: 560_000_00, startOffsetMonths: -2,  termMonths: 24, depositMultiplier: 3 },
  { externalRef: 'demo-l-008', buyerRef: 'demo-t-008', siteRef: 'demo-prop-gd-03', blockRef: 'demo-unit-gd-03-a', monthlyRoyaltyTzsMinor: 180_000_00, startOffsetMonths: -4,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-009', buyerRef: 'demo-t-009', siteRef: 'demo-prop-bl-01', blockRef: 'demo-unit-bl-01-a', monthlyRoyaltyTzsMinor: 650_000_00, startOffsetMonths: -7,  termMonths: 36, depositMultiplier: 3 },
  { externalRef: 'demo-l-010', buyerRef: 'demo-t-010', siteRef: 'demo-prop-wh-06', blockRef: 'demo-unit-wh-06-a', monthlyRoyaltyTzsMinor: 165_000_00, startOffsetMonths: -9,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-011', buyerRef: 'demo-t-011', siteRef: 'demo-prop-gd-04', blockRef: 'demo-unit-gd-04-a', monthlyRoyaltyTzsMinor: 140_000_00, startOffsetMonths: -4,  termMonths: 12, depositMultiplier: 1 },
  { externalRef: 'demo-l-012', buyerRef: 'demo-t-012', siteRef: 'demo-prop-wh-07', blockRef: 'demo-unit-wh-07-a', monthlyRoyaltyTzsMinor: 370_000_00, startOffsetMonths: -6,  termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-013', buyerRef: 'demo-t-013', siteRef: 'demo-prop-wh-08', blockRef: 'demo-unit-wh-08-a', monthlyRoyaltyTzsMinor: 210_000_00, startOffsetMonths: -3,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-014', buyerRef: 'demo-t-014', siteRef: 'demo-prop-bl-02', blockRef: 'demo-unit-bl-02-a', monthlyRoyaltyTzsMinor: 480_000_00, startOffsetMonths: -5,  termMonths: 24, depositMultiplier: 3 },
  { externalRef: 'demo-l-015', buyerRef: 'demo-t-015', siteRef: 'demo-prop-gd-05', blockRef: 'demo-unit-gd-05-a', monthlyRoyaltyTzsMinor: 260_000_00, startOffsetMonths: -8,  termMonths: 24, depositMultiplier: 2 },
];

// ---------------------------------------------------------------------------
// 50 payment ledger entries — mix of on-time and late
// periodOffsetMonths is from the offtake's startOffsetMonths (so 0 is first
// royalty period, 1 is second month, etc.). daysLate of 0 means on time.
// ---------------------------------------------------------------------------
export const SAMPLE_PAYMENTS: readonly SamplePayment[] = [
  { externalRef: 'demo-p-001', offtakeRef: 'demo-l-001', buyerRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-002', offtakeRef: 'demo-l-001', buyerRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 1,  daysLate: 2   },
  { externalRef: 'demo-p-003', offtakeRef: 'demo-l-001', buyerRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-004', offtakeRef: 'demo-l-001', buyerRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 3,  daysLate: 0   },
  { externalRef: 'demo-p-005', offtakeRef: 'demo-l-001', buyerRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 4,  daysLate: 15  },
  { externalRef: 'demo-p-006', offtakeRef: 'demo-l-002', buyerRef: 'demo-t-002', amountTzsMinor: 180_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-007', offtakeRef: 'demo-l-002', buyerRef: 'demo-t-002', amountTzsMinor: 180_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-008', offtakeRef: 'demo-l-002', buyerRef: 'demo-t-002', amountTzsMinor: 180_000_00, periodOffsetMonths: 2,  daysLate: 5   },
  { externalRef: 'demo-p-009', offtakeRef: 'demo-l-003', buyerRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-010', offtakeRef: 'demo-l-003', buyerRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-011', offtakeRef: 'demo-l-003', buyerRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-012', offtakeRef: 'demo-l-003', buyerRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 3,  daysLate: 0   },
  { externalRef: 'demo-p-013', offtakeRef: 'demo-l-003', buyerRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 4,  daysLate: 0   },
  { externalRef: 'demo-p-014', offtakeRef: 'demo-l-003', buyerRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 5,  daysLate: 30  },
  { externalRef: 'demo-p-015', offtakeRef: 'demo-l-003', buyerRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 6,  daysLate: 45  },
  { externalRef: 'demo-p-016', offtakeRef: 'demo-l-004', buyerRef: 'demo-t-004', amountTzsMinor:  95_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-017', offtakeRef: 'demo-l-004', buyerRef: 'demo-t-004', amountTzsMinor:  95_000_00, periodOffsetMonths: 1,  daysLate: 10  },
  { externalRef: 'demo-p-018', offtakeRef: 'demo-l-004', buyerRef: 'demo-t-004', amountTzsMinor:  95_000_00, periodOffsetMonths: 2,  daysLate: 20  },
  { externalRef: 'demo-p-019', offtakeRef: 'demo-l-005', buyerRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-020', offtakeRef: 'demo-l-005', buyerRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-021', offtakeRef: 'demo-l-005', buyerRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-022', offtakeRef: 'demo-l-005', buyerRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 3,  daysLate: 7   },
  { externalRef: 'demo-p-023', offtakeRef: 'demo-l-006', buyerRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-024', offtakeRef: 'demo-l-006', buyerRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-025', offtakeRef: 'demo-l-006', buyerRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-026', offtakeRef: 'demo-l-006', buyerRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 3,  daysLate: 12  },
  { externalRef: 'demo-p-027', offtakeRef: 'demo-l-006', buyerRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 4,  daysLate: 95  },
  { externalRef: 'demo-p-028', offtakeRef: 'demo-l-007', buyerRef: 'demo-t-007', amountTzsMinor: 560_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-029', offtakeRef: 'demo-l-007', buyerRef: 'demo-t-007', amountTzsMinor: 560_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-030', offtakeRef: 'demo-l-008', buyerRef: 'demo-t-008', amountTzsMinor: 180_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-031', offtakeRef: 'demo-l-008', buyerRef: 'demo-t-008', amountTzsMinor: 180_000_00, periodOffsetMonths: 1,  daysLate: 3   },
  { externalRef: 'demo-p-032', offtakeRef: 'demo-l-008', buyerRef: 'demo-t-008', amountTzsMinor: 180_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-033', offtakeRef: 'demo-l-009', buyerRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-034', offtakeRef: 'demo-l-009', buyerRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-035', offtakeRef: 'demo-l-009', buyerRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-036', offtakeRef: 'demo-l-009', buyerRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 3,  daysLate: 0   },
  { externalRef: 'demo-p-037', offtakeRef: 'demo-l-009', buyerRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 4,  daysLate: 0   },
  { externalRef: 'demo-p-038', offtakeRef: 'demo-l-010', buyerRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-039', offtakeRef: 'demo-l-010', buyerRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-040', offtakeRef: 'demo-l-010', buyerRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-041', offtakeRef: 'demo-l-010', buyerRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 3,  daysLate: 120 },
  { externalRef: 'demo-p-042', offtakeRef: 'demo-l-011', buyerRef: 'demo-t-011', amountTzsMinor: 140_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-043', offtakeRef: 'demo-l-011', buyerRef: 'demo-t-011', amountTzsMinor: 140_000_00, periodOffsetMonths: 1,  daysLate: 4   },
  { externalRef: 'demo-p-044', offtakeRef: 'demo-l-012', buyerRef: 'demo-t-012', amountTzsMinor: 370_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-045', offtakeRef: 'demo-l-012', buyerRef: 'demo-t-012', amountTzsMinor: 370_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-046', offtakeRef: 'demo-l-013', buyerRef: 'demo-t-013', amountTzsMinor: 210_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-047', offtakeRef: 'demo-l-014', buyerRef: 'demo-t-014', amountTzsMinor: 480_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-048', offtakeRef: 'demo-l-014', buyerRef: 'demo-t-014', amountTzsMinor: 480_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-049', offtakeRef: 'demo-l-015', buyerRef: 'demo-t-015', amountTzsMinor: 260_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-050', offtakeRef: 'demo-l-015', buyerRef: 'demo-t-015', amountTzsMinor: 260_000_00, periodOffsetMonths: 1,  daysLate: 8   },
];

// ---------------------------------------------------------------------------
// 5 open site-maintenance cases
// ---------------------------------------------------------------------------
export const SAMPLE_MAINTENANCE: readonly SampleSiteMaintenanceCase[] = [
  {
    externalRef: 'demo-m-001',
    siteRef: 'demo-prop-wh-01',
    buyerRef: 'demo-t-001',
    title: 'Roof leak above gold room bay 3',
    description: 'Significant water ingress during last storm; ceiling insulation sagging.',
    category: 'structural',
    priority: 'high',
    estimatedCostTzsMinor: 420_000_00,
    submittedDaysAgo: 4,
  },
  {
    externalRef: 'demo-m-002',
    siteRef: 'demo-prop-wh-03',
    buyerRef: 'demo-t-003',
    title: 'Weighbridge ramp hydraulic failure',
    description: 'West ramp leveler stuck in raised position; blocking ore-haulage movement.',
    category: 'structural',
    priority: 'urgent',
    estimatedCostTzsMinor: 680_000_00,
    submittedDaysAgo: 1,
  },
  {
    externalRef: 'demo-m-003',
    siteRef: 'demo-prop-gd-02',
    buyerRef: 'demo-t-005',
    title: 'Electrical panel tripping',
    description: 'Main panel breaker trips intermittently; possible overload on CIL-circuit compressor.',
    category: 'electrical',
    priority: 'high',
    estimatedCostTzsMinor: 180_000_00,
    submittedDaysAgo: 7,
  },
  {
    externalRef: 'demo-m-004',
    siteRef: 'demo-prop-wh-05',
    buyerRef: 'demo-t-007',
    title: 'Plumbing leak in reagent store',
    description: 'Leak at main water valve; water loss approximately 50L/hour.',
    category: 'plumbing',
    priority: 'medium',
    estimatedCostTzsMinor:  85_000_00,
    submittedDaysAgo: 10,
  },
  {
    externalRef: 'demo-m-005',
    siteRef: 'demo-prop-bl-01',
    buyerRef: null,
    title: 'Perimeter fence damage',
    description: 'Eastern fence line 30m section collapsed; security risk to stored equipment.',
    category: 'general',
    priority: 'medium',
    estimatedCostTzsMinor: 240_000_00,
    submittedDaysAgo: 14,
  },
];
