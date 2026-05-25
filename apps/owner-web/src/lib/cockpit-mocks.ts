/**
 * Cockpit mock data — Tanzanian gold + coltan mining numbers.
 *
 * Realistic placeholder values for the 10 cockpit cards on the
 * owner home page (O-W-01). Numbers are chosen to be plausible for
 * a small-to-mid Tanzanian operator in Geita and Mbeya — ASM /
 * artisanal-to-medium scale rather than a major. Replace with live
 * api-sdk calls during the gateway-wire phase.
 *
 * Currency convention:
 *   - Cash & runway shown in TZS (matches the TZS-only rule).
 *   - Gold spot in USD (international quote).
 *   - Unit economics in TZS/g (matches buyer-broker quotes).
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

export const COCKPIT_MOCK: CockpitData = {
  dailyBrief: [
    {
      text: 'Nyakabale night shift hit 112% of target; head grade up to 4.8 g/t.',
      textSw: 'Zamu ya usiku Nyakabale ilifikia 112% ya lengo; kiwango 4.8 g/t.',
      severity: 'info',
    },
    {
      text: 'PML 25434 renewal window opens in 47 days — pack 60% ready.',
      textSw: 'Dirisha la kurudisha PML 25434 lafunguliwa baada ya siku 47.',
      severity: 'warn',
    },
    {
      text: 'Kakola wash-plant feed pump failure logged at 04:12 — fix ETA 14:00.',
      textSw: 'Hitilafu ya pampu Kakola saa 04:12 — itarekebishwa saa 14:00.',
      severity: 'critical',
    },
  ],
  cashTzsMillions: 412.6,
  runwayDays: 71,
  burnPerDayTzsMillions: 5.8,
  licences: {
    active: 4,
    renewalsDue60d: 2,
    dormancyFlags: 1,
  },
  production: {
    grammesToday: 1284,
    grammesTargetToday: 1200,
    grammesMtd: 28640,
    grammesTargetMtd: 30000,
  },
  openRisks: [
    {
      title: 'Mbeya road-use MoU expired 11 days ago',
      site: 'Mbeya Ridge Pit 2',
      severity: 'high',
    },
    {
      title: 'Kakola tailings dam freeboard at 1.2 m (limit 1.0 m)',
      site: 'Kakola Alluvial',
      severity: 'medium',
    },
    {
      title: 'Diesel stock 9 days vs 14 day policy',
      site: 'All sites',
      severity: 'medium',
    },
  ],
  pendingDecisions: [
    {
      title: 'Approve Excavator-2 24-month finance lease vs cash',
      waitingDays: 4,
      recommender: 'Strategy mode',
    },
    {
      title: 'Sign Kakola buyer split (Geita Refinery 60 / Dar broker 40)',
      waitingDays: 2,
      recommender: 'Sales agent',
    },
    {
      title: 'Approve community CSR allocation Q2 (TZS 38m)',
      waitingDays: 6,
      recommender: 'Community agent',
    },
  ],
  activeSites: [
    {
      name: 'Nyakabale Reef Block',
      status: 'on-track',
      headline: '1,284 g today · grade 4.8 g/t · 32 crew',
    },
    {
      name: 'Kakola Alluvial Terraces',
      status: 'watch',
      headline: 'Wash plant down 6h · catch-up planned 2nd shift',
    },
    {
      name: 'Mbeya Ridge Pit 2',
      status: 'behind',
      headline: 'Coltan stockpile 11 t — buyer dispute on Ta2O5 % unresolved',
    },
  ],
  compliance: {
    green: 14,
    amber: 5,
    red: 2,
  },
  marketplace: {
    openOffers: 6,
    newInquiries7d: 11,
    topBuyer: 'Geita Gold Refinery',
  },
  fxAndGold: {
    goldSpotUsdOz: 2384,
    tzsUsd: 2585,
    sellWindowOpen: true,
    daysToCliff27Mar: 18,
  },
};
