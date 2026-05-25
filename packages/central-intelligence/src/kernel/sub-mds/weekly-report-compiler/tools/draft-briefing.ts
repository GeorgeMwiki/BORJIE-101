/**
 * `report.draft_briefing` — DRAFT-only.
 *
 * Produces a markdown briefing for the owner. Rendered via the
 * design-system genui `markdown-card` UI kind. Every figure carries
 * an inline citation reference (e.g. [c:cashflow.gross]).
 */

import type { PortfolioKpiSnapshot } from './gather-kpis.js';
import type { Anomaly } from './detect-anomalies.js';
import type { Citation } from './cite-evidence.js';

export interface DraftBriefingArgs {
  readonly snapshot: PortfolioKpiSnapshot;
  readonly anomalies: ReadonlyArray<Anomaly>;
  readonly citations: ReadonlyArray<Citation>;
  readonly portfolioName: string;
  readonly language: 'en' | 'sw' | 'mixed';
}

export interface DraftedBriefing {
  readonly title: string;
  readonly markdown: string;
  readonly uiKind: 'markdown-card';
  readonly citations: ReadonlyArray<Citation>;
  readonly draftStatus: 'queued-for-owner-review';
  readonly headline: string;
}

export function draftBriefing(args: DraftBriefingArgs): DraftedBriefing {
  const sw = args.language === 'sw';
  const { snapshot } = args;
  const headline = renderHeadline(snapshot, args.anomalies, sw);
  const title = sw
    ? `Muhtasari wa wiki: ${args.portfolioName}`
    : `Weekly briefing: ${args.portfolioName}`;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`**${sw ? 'Mada kuu' : 'Headline'}:** ${headline}`);
  lines.push('');
  lines.push(`## ${sw ? 'Mtiririko wa pesa' : 'Cashflow'}`);
  lines.push(`- ${sw ? 'Jumla iliyokusanywa' : 'Gross collected'}: ${money(snapshot.cashflow.grossCollectedMinor, snapshot.cashflow.currency)} [c:cashflow.gross]`);
  lines.push(`- ${sw ? 'Halisi iliyokusanywa' : 'Net collected'}: ${money(snapshot.cashflow.netCollectedMinor, snapshot.cashflow.currency)} [c:cashflow.net]`);
  lines.push(`- ${sw ? 'Deni la sasa' : 'Open arrears balance'}: ${money(snapshot.cashflow.arrearsBalanceMinor, snapshot.cashflow.currency)} [c:cashflow.arrears]`);
  lines.push('');
  lines.push(`## ${sw ? 'Wakaaji' : 'Occupancy'}`);
  lines.push(`- ${sw ? 'Kiwango cha ukaaji' : 'Occupancy rate'}: ${(snapshot.occupancy.occupancyRate * 100).toFixed(1)}% (${snapshot.occupancy.occupiedUnits}/${snapshot.occupancy.totalUnits}) [c:occupancy.rate]`);
  lines.push(`- ${sw ? 'Mikataba mipya' : 'New lease signs'}: ${snapshot.occupancy.newSignsThisWeek} [c:occupancy.signs]`);
  lines.push(`- ${sw ? 'Walioondoka' : 'Moved out'}: ${snapshot.occupancy.movedOutThisWeek}`);
  lines.push('');
  lines.push(`## ${sw ? 'Madeni' : 'Arrears'}`);
  lines.push(`- ${sw ? 'Mikataba yenye deni' : 'Leases in arrears'}: ${snapshot.arrears.leasesInArrears}`);
  lines.push(`- ${sw ? 'Deni mpya wiki hii' : 'New this week'}: ${snapshot.arrears.newArrearsThisWeek} [c:arrears.newThisWeek]`);
  lines.push(`- ${sw ? 'Yaliyotatuliwa' : 'Cured'}: ${snapshot.arrears.curedThisWeek}`);
  lines.push('');
  lines.push(`## ${sw ? 'Matengenezo' : 'Maintenance'}`);
  lines.push(`- ${sw ? 'Tiketi zinazoendelea' : 'Open tickets'}: ${snapshot.maintenance.openTickets} [c:maintenance.openTickets]`);
  lines.push(`- ${sw ? 'Tiketi za dharura' : 'Emergency tickets'}: ${snapshot.maintenance.emergencyTicketsThisWeek} [c:maintenance.emergency]`);
  lines.push(`- ${sw ? 'Muda wa kujibu' : 'Avg response'}: ${(snapshot.maintenance.avgResponseSeconds).toFixed(0)}s`);
  lines.push('');
  lines.push(`## ${sw ? 'Malalamiko' : 'Complaints'}`);
  lines.push(`- ${sw ? 'Mpya wiki hii' : 'New this week'}: ${snapshot.complaints.newComplaintsThisWeek} [c:complaints.new]`);
  lines.push(`- ${sw ? 'Muhimu (critical)' : 'Critical'}: ${snapshot.complaints.criticalComplaintsThisWeek} [c:complaints.critical]`);
  lines.push('');
  if (args.anomalies.length > 0) {
    lines.push(`## ${sw ? 'Hali zisizo za kawaida' : 'Anomalies vs forecast'}`);
    args.anomalies.forEach((a, i) => {
      const sign = a.direction === 'over-performed' ? '↑' : '↓';
      const sevTag = a.severity.toUpperCase();
      lines.push(`- [${sevTag}] ${a.metric}: actual ${a.actual.toLocaleString()} vs predicted ${a.predicted.toLocaleString()} (${sign}${(a.relativeError * 100).toFixed(1)}%) [c:anomaly.${i + 1}]`);
    });
    lines.push('');
  }
  lines.push(`---`);
  lines.push(sw
    ? `*Hii ni rasimu. Mmiliki anapitia kabla ya kusambazwa.*`
    : `*This is a draft. Owner reviews before distribution.*`,
  );
  return Object.freeze({
    title,
    markdown: lines.join('\n'),
    uiKind: 'markdown-card',
    citations: Object.freeze(args.citations.slice()),
    draftStatus: 'queued-for-owner-review',
    headline,
  });
}

function money(minor: number, ccy: string): string {
  const major = (minor / 100).toFixed(0);
  return `${ccy} ${Number(major).toLocaleString()}`;
}

function renderHeadline(s: PortfolioKpiSnapshot, anomalies: ReadonlyArray<Anomaly>, sw: boolean): string {
  if (anomalies.some(a => a.severity === 'major')) {
    return sw ? 'Kuna mabadiliko makubwa yanayohitaji uangalifu.' : 'Major variances vs forecast require attention.';
  }
  if (anomalies.length === 0) {
    return sw
      ? `Wiki tulivu: kiwango cha ukaaji ${(s.occupancy.occupancyRate * 100).toFixed(1)}%, hakuna mabadiliko makubwa.`
      : `Quiet week: occupancy at ${(s.occupancy.occupancyRate * 100).toFixed(1)}%, no major variances.`;
  }
  return sw ? 'Mabadiliko madogo dhidi ya utabiri.' : 'Minor / moderate variances vs forecast.';
}
