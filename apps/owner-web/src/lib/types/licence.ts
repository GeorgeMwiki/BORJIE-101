/**
 * Per-licence cockpit type shapes (O-W-07).
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
