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
  readonly runwayDays: number;
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
    readonly openOffers: number;
    readonly newInquiries7d: number;
    readonly topBuyer: string;
  };
  readonly fxAndGold: {
    readonly goldSpotUsdOz: number;
    readonly tzsUsd: number;
    readonly sellWindowOpen: boolean;
    readonly daysToCliff27Mar: number;
  };
}

export interface DailyBriefResponse extends CockpitData {
  readonly updatedAt: string;
  readonly tenantId: string;
}
