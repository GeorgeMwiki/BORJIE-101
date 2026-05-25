/**
 * Sample tenant identities + leases + ledger entries + maintenance cases
 * used by demo-org-seed.ts.
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

export interface SampleTenantIdentity {
  readonly externalRef: string; // stable natural key used for idempotence
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string; // normalized E.164 without '+'
  readonly email: string;
  readonly occupation: string;
  readonly monthlyIncomeTzsMinor: number;
}

export interface SampleLease {
  readonly externalRef: string;
  readonly tenantRef: string;
  readonly propertyRef: string;
  readonly unitRef: string;
  readonly monthlyRentTzsMinor: number;
  readonly startOffsetMonths: number; // negative = in the past
  readonly termMonths: number;
  readonly depositMultiplier: number;
}

export interface SamplePayment {
  readonly externalRef: string;
  readonly leaseRef: string;
  readonly tenantRef: string;
  readonly amountTzsMinor: number;
  readonly periodOffsetMonths: number; // relative to lease start
  readonly daysLate: number; // 0 = on-time, > 0 = late
}

export interface SampleMaintenanceCase {
  readonly externalRef: string;
  readonly propertyRef: string;
  readonly tenantRef: string | null;
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
// 20 sample tenant identities
// ---------------------------------------------------------------------------
export const SAMPLE_TENANTS: readonly SampleTenantIdentity[] = [
  { externalRef: 'demo-t-001', firstName: 'Amani',  lastName: 'Mwakalinga', phone: '255712000001', email: 'amani.mwakalinga@example.com',  occupation: 'Warehouse manager',   monthlyIncomeTzsMinor: 180_000_00 },
  { externalRef: 'demo-t-002', firstName: 'Baraka', lastName: 'Kileo',      phone: '255712000002', email: 'baraka.kileo@example.com',       occupation: 'Logistics agent',      monthlyIncomeTzsMinor: 140_000_00 },
  { externalRef: 'demo-t-003', firstName: 'Chausiku', lastName: 'Mrema',    phone: '255712000003', email: 'chausiku.mrema@example.com',     occupation: 'Freight broker',       monthlyIncomeTzsMinor: 220_000_00 },
  { externalRef: 'demo-t-004', firstName: 'Daudi',  lastName: 'Shayo',      phone: '255712000004', email: 'daudi.shayo@example.com',        occupation: 'Small trader',         monthlyIncomeTzsMinor:  95_000_00 },
  { externalRef: 'demo-t-005', firstName: 'Esther', lastName: 'Mushi',      phone: '255712000005', email: 'esther.mushi@example.com',       occupation: 'Grain wholesaler',     monthlyIncomeTzsMinor: 310_000_00 },
  { externalRef: 'demo-t-006', firstName: 'Faraja', lastName: 'Kimaro',     phone: '255712000006', email: 'faraja.kimaro@example.com',      occupation: 'Hardware retailer',    monthlyIncomeTzsMinor: 175_000_00 },
  { externalRef: 'demo-t-007', firstName: 'Goodluck', lastName: 'Mwanga',   phone: '255712000007', email: 'goodluck.mwanga@example.com',    occupation: 'Cement distributor',   monthlyIncomeTzsMinor: 420_000_00 },
  { externalRef: 'demo-t-008', firstName: 'Halima', lastName: 'Juma',       phone: '255712000008', email: 'halima.juma@example.com',        occupation: 'Spice exporter',       monthlyIncomeTzsMinor: 260_000_00 },
  { externalRef: 'demo-t-009', firstName: 'Ibrahim', lastName: 'Ndege',     phone: '255712000009', email: 'ibrahim.ndege@example.com',      occupation: 'Fuel reseller',        monthlyIncomeTzsMinor: 500_000_00 },
  { externalRef: 'demo-t-010', firstName: 'Jamila', lastName: 'Kisanji',    phone: '255712000010', email: 'jamila.kisanji@example.com',     occupation: 'Cooperative agent',    monthlyIncomeTzsMinor: 130_000_00 },
  { externalRef: 'demo-t-011', firstName: 'Kassim', lastName: 'Magige',     phone: '255712000011', email: 'kassim.magige@example.com',      occupation: 'Vegetable trader',     monthlyIncomeTzsMinor: 110_000_00 },
  { externalRef: 'demo-t-012', firstName: 'Lilian', lastName: 'Mlowezi',    phone: '255712000012', email: 'lilian.mlowezi@example.com',     occupation: 'Textile importer',     monthlyIncomeTzsMinor: 285_000_00 },
  { externalRef: 'demo-t-013', firstName: 'Musa',   lastName: 'Kitunda',    phone: '255712000013', email: 'musa.kitunda@example.com',       occupation: 'Construction foreman', monthlyIncomeTzsMinor: 165_000_00 },
  { externalRef: 'demo-t-014', firstName: 'Neema',  lastName: 'Masawe',     phone: '255712000014', email: 'neema.masawe@example.com',       occupation: 'Event organizer',      monthlyIncomeTzsMinor: 200_000_00 },
  { externalRef: 'demo-t-015', firstName: 'Omari',  lastName: 'Suleiman',   phone: '255712000015', email: 'omari.suleiman@example.com',     occupation: 'Fish processor',       monthlyIncomeTzsMinor: 240_000_00 },
  { externalRef: 'demo-t-016', firstName: 'Pendo',  lastName: 'Nyerere',    phone: '255712000016', email: 'pendo.nyerere@example.com',      occupation: 'Cooperative clerk',    monthlyIncomeTzsMinor: 120_000_00 },
  { externalRef: 'demo-t-017', firstName: 'Rajabu', lastName: 'Chuma',      phone: '255712000017', email: 'rajabu.chuma@example.com',       occupation: 'Metal fabricator',     monthlyIncomeTzsMinor: 190_000_00 },
  { externalRef: 'demo-t-018', firstName: 'Saida',  lastName: 'Mtui',       phone: '255712000018', email: 'saida.mtui@example.com',         occupation: 'Farmer cooperative',   monthlyIncomeTzsMinor: 100_000_00 },
  { externalRef: 'demo-t-019', firstName: 'Tumaini', lastName: 'Kalinga',   phone: '255712000019', email: 'tumaini.kalinga@example.com',    occupation: 'Trucking operator',    monthlyIncomeTzsMinor: 370_000_00 },
  { externalRef: 'demo-t-020', firstName: 'Upendo', lastName: 'Sawe',       phone: '255712000020', email: 'upendo.sawe@example.com',        occupation: 'Pharmacy owner',       monthlyIncomeTzsMinor: 330_000_00 },
];

// ---------------------------------------------------------------------------
// 15 sample leases referencing the sample properties in demo-org-seed.ts
// propertyRef / unitRef stable IDs are materialized by the seed runner.
// ---------------------------------------------------------------------------
export const SAMPLE_LEASES: readonly SampleLease[] = [
  { externalRef: 'demo-l-001', tenantRef: 'demo-t-001', propertyRef: 'demo-prop-wh-01', unitRef: 'demo-unit-wh-01-a', monthlyRentTzsMinor: 250_000_00, startOffsetMonths: -8,  termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-002', tenantRef: 'demo-t-002', propertyRef: 'demo-prop-wh-02', unitRef: 'demo-unit-wh-02-a', monthlyRentTzsMinor: 180_000_00, startOffsetMonths: -5,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-003', tenantRef: 'demo-t-003', propertyRef: 'demo-prop-wh-03', unitRef: 'demo-unit-wh-03-a', monthlyRentTzsMinor: 320_000_00, startOffsetMonths: -11, termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-004', tenantRef: 'demo-t-004', propertyRef: 'demo-prop-gd-01', unitRef: 'demo-unit-gd-01-a', monthlyRentTzsMinor:  95_000_00, startOffsetMonths: -3,  termMonths: 12, depositMultiplier: 1 },
  { externalRef: 'demo-l-005', tenantRef: 'demo-t-005', propertyRef: 'demo-prop-gd-02', unitRef: 'demo-unit-gd-02-a', monthlyRentTzsMinor: 410_000_00, startOffsetMonths: -6,  termMonths: 36, depositMultiplier: 3 },
  { externalRef: 'demo-l-006', tenantRef: 'demo-t-006', propertyRef: 'demo-prop-wh-04', unitRef: 'demo-unit-wh-04-a', monthlyRentTzsMinor: 220_000_00, startOffsetMonths: -10, termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-007', tenantRef: 'demo-t-007', propertyRef: 'demo-prop-wh-05', unitRef: 'demo-unit-wh-05-a', monthlyRentTzsMinor: 560_000_00, startOffsetMonths: -2,  termMonths: 24, depositMultiplier: 3 },
  { externalRef: 'demo-l-008', tenantRef: 'demo-t-008', propertyRef: 'demo-prop-gd-03', unitRef: 'demo-unit-gd-03-a', monthlyRentTzsMinor: 180_000_00, startOffsetMonths: -4,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-009', tenantRef: 'demo-t-009', propertyRef: 'demo-prop-bl-01', unitRef: 'demo-unit-bl-01-a', monthlyRentTzsMinor: 650_000_00, startOffsetMonths: -7,  termMonths: 36, depositMultiplier: 3 },
  { externalRef: 'demo-l-010', tenantRef: 'demo-t-010', propertyRef: 'demo-prop-wh-06', unitRef: 'demo-unit-wh-06-a', monthlyRentTzsMinor: 165_000_00, startOffsetMonths: -9,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-011', tenantRef: 'demo-t-011', propertyRef: 'demo-prop-gd-04', unitRef: 'demo-unit-gd-04-a', monthlyRentTzsMinor: 140_000_00, startOffsetMonths: -4,  termMonths: 12, depositMultiplier: 1 },
  { externalRef: 'demo-l-012', tenantRef: 'demo-t-012', propertyRef: 'demo-prop-wh-07', unitRef: 'demo-unit-wh-07-a', monthlyRentTzsMinor: 370_000_00, startOffsetMonths: -6,  termMonths: 24, depositMultiplier: 2 },
  { externalRef: 'demo-l-013', tenantRef: 'demo-t-013', propertyRef: 'demo-prop-wh-08', unitRef: 'demo-unit-wh-08-a', monthlyRentTzsMinor: 210_000_00, startOffsetMonths: -3,  termMonths: 12, depositMultiplier: 2 },
  { externalRef: 'demo-l-014', tenantRef: 'demo-t-014', propertyRef: 'demo-prop-bl-02', unitRef: 'demo-unit-bl-02-a', monthlyRentTzsMinor: 480_000_00, startOffsetMonths: -5,  termMonths: 24, depositMultiplier: 3 },
  { externalRef: 'demo-l-015', tenantRef: 'demo-t-015', propertyRef: 'demo-prop-gd-05', unitRef: 'demo-unit-gd-05-a', monthlyRentTzsMinor: 260_000_00, startOffsetMonths: -8,  termMonths: 24, depositMultiplier: 2 },
];

// ---------------------------------------------------------------------------
// 50 payment ledger entries — mix of on-time and late
// periodOffsetMonths is from the lease's startOffsetMonths (so 0 is first
// rent period, 1 is second month, etc.). daysLate of 0 means on time.
// ---------------------------------------------------------------------------
export const SAMPLE_PAYMENTS: readonly SamplePayment[] = [
  { externalRef: 'demo-p-001', leaseRef: 'demo-l-001', tenantRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-002', leaseRef: 'demo-l-001', tenantRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 1,  daysLate: 2   },
  { externalRef: 'demo-p-003', leaseRef: 'demo-l-001', tenantRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-004', leaseRef: 'demo-l-001', tenantRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 3,  daysLate: 0   },
  { externalRef: 'demo-p-005', leaseRef: 'demo-l-001', tenantRef: 'demo-t-001', amountTzsMinor: 250_000_00, periodOffsetMonths: 4,  daysLate: 15  },
  { externalRef: 'demo-p-006', leaseRef: 'demo-l-002', tenantRef: 'demo-t-002', amountTzsMinor: 180_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-007', leaseRef: 'demo-l-002', tenantRef: 'demo-t-002', amountTzsMinor: 180_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-008', leaseRef: 'demo-l-002', tenantRef: 'demo-t-002', amountTzsMinor: 180_000_00, periodOffsetMonths: 2,  daysLate: 5   },
  { externalRef: 'demo-p-009', leaseRef: 'demo-l-003', tenantRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-010', leaseRef: 'demo-l-003', tenantRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-011', leaseRef: 'demo-l-003', tenantRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-012', leaseRef: 'demo-l-003', tenantRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 3,  daysLate: 0   },
  { externalRef: 'demo-p-013', leaseRef: 'demo-l-003', tenantRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 4,  daysLate: 0   },
  { externalRef: 'demo-p-014', leaseRef: 'demo-l-003', tenantRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 5,  daysLate: 30  },
  { externalRef: 'demo-p-015', leaseRef: 'demo-l-003', tenantRef: 'demo-t-003', amountTzsMinor: 320_000_00, periodOffsetMonths: 6,  daysLate: 45  },
  { externalRef: 'demo-p-016', leaseRef: 'demo-l-004', tenantRef: 'demo-t-004', amountTzsMinor:  95_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-017', leaseRef: 'demo-l-004', tenantRef: 'demo-t-004', amountTzsMinor:  95_000_00, periodOffsetMonths: 1,  daysLate: 10  },
  { externalRef: 'demo-p-018', leaseRef: 'demo-l-004', tenantRef: 'demo-t-004', amountTzsMinor:  95_000_00, periodOffsetMonths: 2,  daysLate: 20  },
  { externalRef: 'demo-p-019', leaseRef: 'demo-l-005', tenantRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-020', leaseRef: 'demo-l-005', tenantRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-021', leaseRef: 'demo-l-005', tenantRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-022', leaseRef: 'demo-l-005', tenantRef: 'demo-t-005', amountTzsMinor: 410_000_00, periodOffsetMonths: 3,  daysLate: 7   },
  { externalRef: 'demo-p-023', leaseRef: 'demo-l-006', tenantRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-024', leaseRef: 'demo-l-006', tenantRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-025', leaseRef: 'demo-l-006', tenantRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-026', leaseRef: 'demo-l-006', tenantRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 3,  daysLate: 12  },
  { externalRef: 'demo-p-027', leaseRef: 'demo-l-006', tenantRef: 'demo-t-006', amountTzsMinor: 220_000_00, periodOffsetMonths: 4,  daysLate: 95  },
  { externalRef: 'demo-p-028', leaseRef: 'demo-l-007', tenantRef: 'demo-t-007', amountTzsMinor: 560_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-029', leaseRef: 'demo-l-007', tenantRef: 'demo-t-007', amountTzsMinor: 560_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-030', leaseRef: 'demo-l-008', tenantRef: 'demo-t-008', amountTzsMinor: 180_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-031', leaseRef: 'demo-l-008', tenantRef: 'demo-t-008', amountTzsMinor: 180_000_00, periodOffsetMonths: 1,  daysLate: 3   },
  { externalRef: 'demo-p-032', leaseRef: 'demo-l-008', tenantRef: 'demo-t-008', amountTzsMinor: 180_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-033', leaseRef: 'demo-l-009', tenantRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-034', leaseRef: 'demo-l-009', tenantRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-035', leaseRef: 'demo-l-009', tenantRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-036', leaseRef: 'demo-l-009', tenantRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 3,  daysLate: 0   },
  { externalRef: 'demo-p-037', leaseRef: 'demo-l-009', tenantRef: 'demo-t-009', amountTzsMinor: 650_000_00, periodOffsetMonths: 4,  daysLate: 0   },
  { externalRef: 'demo-p-038', leaseRef: 'demo-l-010', tenantRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-039', leaseRef: 'demo-l-010', tenantRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-040', leaseRef: 'demo-l-010', tenantRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 2,  daysLate: 0   },
  { externalRef: 'demo-p-041', leaseRef: 'demo-l-010', tenantRef: 'demo-t-010', amountTzsMinor: 165_000_00, periodOffsetMonths: 3,  daysLate: 120 },
  { externalRef: 'demo-p-042', leaseRef: 'demo-l-011', tenantRef: 'demo-t-011', amountTzsMinor: 140_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-043', leaseRef: 'demo-l-011', tenantRef: 'demo-t-011', amountTzsMinor: 140_000_00, periodOffsetMonths: 1,  daysLate: 4   },
  { externalRef: 'demo-p-044', leaseRef: 'demo-l-012', tenantRef: 'demo-t-012', amountTzsMinor: 370_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-045', leaseRef: 'demo-l-012', tenantRef: 'demo-t-012', amountTzsMinor: 370_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-046', leaseRef: 'demo-l-013', tenantRef: 'demo-t-013', amountTzsMinor: 210_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-047', leaseRef: 'demo-l-014', tenantRef: 'demo-t-014', amountTzsMinor: 480_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-048', leaseRef: 'demo-l-014', tenantRef: 'demo-t-014', amountTzsMinor: 480_000_00, periodOffsetMonths: 1,  daysLate: 0   },
  { externalRef: 'demo-p-049', leaseRef: 'demo-l-015', tenantRef: 'demo-t-015', amountTzsMinor: 260_000_00, periodOffsetMonths: 0,  daysLate: 0   },
  { externalRef: 'demo-p-050', leaseRef: 'demo-l-015', tenantRef: 'demo-t-015', amountTzsMinor: 260_000_00, periodOffsetMonths: 1,  daysLate: 8   },
];

// ---------------------------------------------------------------------------
// 5 open maintenance cases
// ---------------------------------------------------------------------------
export const SAMPLE_MAINTENANCE: readonly SampleMaintenanceCase[] = [
  {
    externalRef: 'demo-m-001',
    propertyRef: 'demo-prop-wh-01',
    tenantRef: 'demo-t-001',
    title: 'Roof leak above bay 3',
    description: 'Significant water ingress during last storm; ceiling insulation sagging.',
    category: 'structural',
    priority: 'high',
    estimatedCostTzsMinor: 420_000_00,
    submittedDaysAgo: 4,
  },
  {
    externalRef: 'demo-m-002',
    propertyRef: 'demo-prop-wh-03',
    tenantRef: 'demo-t-003',
    title: 'Loading dock hydraulic failure',
    description: 'West dock leveler stuck in raised position; blocking freight movement.',
    category: 'structural',
    priority: 'urgent',
    estimatedCostTzsMinor: 680_000_00,
    submittedDaysAgo: 1,
  },
  {
    externalRef: 'demo-m-003',
    propertyRef: 'demo-prop-gd-02',
    tenantRef: 'demo-t-005',
    title: 'Electrical panel tripping',
    description: 'Main panel breaker trips intermittently; possible overload on cold-storage compressor circuit.',
    category: 'electrical',
    priority: 'high',
    estimatedCostTzsMinor: 180_000_00,
    submittedDaysAgo: 7,
  },
  {
    externalRef: 'demo-m-004',
    propertyRef: 'demo-prop-wh-05',
    tenantRef: 'demo-t-007',
    title: 'Plumbing leak in utility room',
    description: 'Leak at main water valve; water loss approximately 50L/hour.',
    category: 'plumbing',
    priority: 'medium',
    estimatedCostTzsMinor:  85_000_00,
    submittedDaysAgo: 10,
  },
  {
    externalRef: 'demo-m-005',
    propertyRef: 'demo-prop-bl-01',
    tenantRef: null,
    title: 'Perimeter fence damage',
    description: 'Eastern fence line 30m section collapsed; security risk to stored equipment.',
    category: 'general',
    priority: 'medium',
    estimatedCostTzsMinor: 240_000_00,
    submittedDaysAgo: 14,
  },
];
