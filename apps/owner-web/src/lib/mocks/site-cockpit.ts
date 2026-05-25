/**
 * Site cockpit mocks (O-W-06).
 *
 * Per-site operating slice — shift reports, blockers, photos and
 * unit-economics line items in TZS/g.
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

export const SITE_COCKPIT_MOCK: SiteCockpitData = {
  siteId: 'site_nyakabale',
  siteName: 'Nyakabale Reef Block',
  latestShift: {
    date: '2026-05-25',
    shift: 'night',
    tonnesMined: 268,
    headGradeGpt: 4.8,
    grammesRecovered: 1284,
    varianceVsPlanPct: 12,
    supervisor: 'Hawa Shabani',
    notes:
      'Reef intersected at 045°; vein width 1.7 m. Mill feed steady. No incidents.',
  },
  blockers: [
    {
      id: 'blk_1',
      title: 'Wash-plant feed pump failure logged at 04:12',
      raisedAt: '2026-05-25T04:12:00Z',
      severity: 'high',
      owner: 'Maintenance crew',
    },
    {
      id: 'blk_2',
      title: 'Diesel stock at 9 days (policy 14)',
      raisedAt: '2026-05-24T09:30:00Z',
      severity: 'medium',
      owner: 'Procurement agent',
    },
    {
      id: 'blk_3',
      title: 'PML 25434 renewal pack 60% complete (window in 47d)',
      raisedAt: '2026-05-23T16:00:00Z',
      severity: 'medium',
      owner: 'Document agent',
    },
  ],
  photos: [
    { id: 'p1', caption: 'Stope face 045° — vein in hangingwall' },
    { id: 'p2', caption: 'Mill feed conveyor' },
    { id: 'p3', caption: 'Crew safety brief, 06:00' },
  ],
  geologyScore: 78,
  geologyTrend: [
    { day: 1, score: 71 },
    { day: 5, score: 73 },
    { day: 10, score: 72 },
    { day: 15, score: 75 },
    { day: 20, score: 76 },
    { day: 25, score: 78 },
    { day: 30, score: 78 },
  ],
  costs: [
    { category: 'extraction', tzsPerGramme: 38_000, trend: 'flat' },
    { category: 'processing', tzsPerGramme: 22_500, trend: 'down' },
    { category: 'royalty', tzsPerGramme: 18_400, trend: 'flat' },
    { category: 'treasury', tzsPerGramme: 11_200, trend: 'up' },
    { category: 'csr', tzsPerGramme: 4_800, trend: 'flat' },
    { category: 'overhead', tzsPerGramme: 9_100, trend: 'down' },
  ],
};
