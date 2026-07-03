/**
 * Owner cockpit type shapes (O-W-01).
 *
 * Mirrors the wire shape the gateway returns on
 * `GET /api/v1/mining/cockpit/daily-brief`.
 */

export interface BriefItem {
  readonly text: string;
  readonly textSw: string;
  readonly severity: 'info' | 'warn' | 'critical';
}

export interface CockpitData {
  readonly dailyBrief: ReadonlyArray<BriefItem>;
  readonly cashTzsMillions: number;
  /**
   * REAL runway (cash on hand ÷ net daily burn). `null` when unknown (no
   * treasury/cost feed) or when the estate is net cash-positive (no burn);
   * `runwayBurnStatus` disambiguates. Never the degenerate constant 90.
   */
  readonly runwayDays: number | null;
  readonly runwayBurnStatus: 'burning' | 'no_burn' | 'unknown';
  readonly burnPerDayTzsMillions: number;
  readonly licences: {
    readonly active: number;
    readonly renewalsDue60d: number;
    readonly dormancyFlags: number;
  };
  readonly production: {
    readonly grammesToday: number;
    readonly grammesTargetToday: number;
    readonly grammesMtd: number;
    readonly grammesTargetMtd: number;
  };
  readonly openRisks: ReadonlyArray<{
    readonly title: string;
    readonly site: string;
    readonly severity: 'low' | 'medium' | 'high';
  }>;
  readonly pendingDecisions: ReadonlyArray<{
    readonly title: string;
    readonly waitingDays: number;
    readonly recommender: string;
  }>;
  readonly activeSites: ReadonlyArray<{
    readonly name: string;
    readonly status: 'on-track' | 'watch' | 'behind';
    readonly headline: string;
  }>;
  readonly compliance: {
    readonly green: number;
    readonly amber: number;
    readonly red: number;
  };
  readonly marketplace: {
    // `null` = the marketplace feed is not wired in this deployment (no
    // listings / inquiries source). The card renders an honest em-dash —
    // never a fabricated `0` offers / empty top-buyer rendered as truth.
    readonly openOffers: number | null;
    readonly newInquiries7d: number | null;
    readonly topBuyer: string | null;
  };
  readonly fxAndGold: {
    // `null` = the `fx_rates` benchmark feed has not yet written this pair.
    // The card renders an honest em-dash, not a fabricated $0/oz or TZS/USD 0.
    readonly goldSpotUsdOz: number | null;
    readonly tzsUsd: number | null;
    readonly sellWindowOpen: boolean;
    readonly daysToCliff27Mar: number;
  };
}

export interface DailyBriefResponse extends CockpitData {
  readonly updatedAt: string;
  readonly tenantId: string;
}
