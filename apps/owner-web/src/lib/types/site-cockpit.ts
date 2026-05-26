/**
 * Per-site cockpit type shapes (O-W-06).
 */

export interface ShiftReport {
  readonly date: string;
  readonly shift: 'day' | 'night';
  readonly tonnesMined: number;
  readonly headGradeGpt: number;
  readonly grammesRecovered: number;
  readonly varianceVsPlanPct: number;
  readonly supervisor: string;
  readonly notes: string;
}

export interface Blocker {
  readonly id: string;
  readonly title: string;
  readonly raisedAt: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly owner: string;
}

export interface CostLine {
  readonly category: 'extraction' | 'processing' | 'royalty' | 'treasury' | 'csr' | 'overhead';
  readonly tzsPerGramme: number;
  readonly trend: 'up' | 'down' | 'flat';
}

export interface SiteCockpitData {
  readonly siteId: string;
  readonly siteName: string;
  readonly latestShift: ShiftReport;
  readonly blockers: ReadonlyArray<Blocker>;
  readonly photos: ReadonlyArray<{ readonly id: string; readonly caption: string }>;
  readonly geologyScore: number;
  readonly geologyTrend: ReadonlyArray<{ readonly day: number; readonly score: number }>;
  readonly costs: ReadonlyArray<CostLine>;
}
