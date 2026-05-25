/**
 * Licence cockpit mocks (O-W-07).
 *
 * Per-licence renewal countdown, dormancy score (Mining Act 2010 §44)
 * and a payment-history series so the screen can render the obligations
 * vs payments table.
 */

export interface LicenceCockpitData {
  readonly id: string;
  readonly reference: string;
  readonly mineral: 'gold' | 'coltan' | 'tanzanite';
  readonly siteName: string;
  readonly windowOpensAt: string;
  readonly windowClosesAt: string;
  readonly daysToWindow: number;
  readonly dormancyScore: number;
  readonly dormancyCitation: string;
  readonly payments: ReadonlyArray<{
    readonly date: string;
    readonly description: string;
    readonly amountTzs: number;
    readonly status: 'paid' | 'overdue' | 'due';
  }>;
  readonly renewalPackCompletePct: number;
  readonly renewalPackMissing: ReadonlyArray<string>;
}

export const LICENCE_MOCK: LicenceCockpitData = {
  id: 'lic_25434',
  reference: 'PML 25434',
  mineral: 'gold',
  siteName: 'Nyakabale Reef Block',
  windowOpensAt: '2026-07-11',
  windowClosesAt: '2026-08-25',
  daysToWindow: 47,
  dormancyScore: 22,
  dormancyCitation:
    'Mining Act 2010 §44 — dormancy clock pauses while operations continue at >= 25% of plan.',
  payments: [
    { date: '2023-03-27', description: 'Initial grant fee', amountTzs: 5_500_000, status: 'paid' },
    { date: '2024-03-27', description: 'Annual rent Y1', amountTzs: 1_200_000, status: 'paid' },
    { date: '2025-03-27', description: 'Annual rent Y2', amountTzs: 1_200_000, status: 'paid' },
    { date: '2026-03-27', description: 'Annual rent Y3', amountTzs: 1_200_000, status: 'overdue' },
    { date: '2026-07-11', description: 'Renewal fee Y4', amountTzs: 4_800_000, status: 'due' },
  ],
  renewalPackCompletePct: 60,
  renewalPackMissing: [
    'Latest production return (LSM form)',
    'EPP compliance certificate (NEMC)',
    'Community CSR commitment evidence (village minutes)',
    'Land-use no-objection letter (Geita DLO)',
  ],
};
