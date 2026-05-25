/**
 * Executive briefing generator.
 *
 * Composes the weekly/monthly briefing the head of estates finds waiting
 * every Monday 08:00 + first-of-month 08:00. Uses the consultant
 * sub-persona's structure (Recommendation / Rationale / Trade-offs /
 * Next Steps / Risks) for every recommendation.
 *
 * The generator is transport-free: it takes portfolio metrics + an open
 * exception list + last-period wins, assembles the briefing payload, and
 * hands it back to the scheduler to persist via the repository.
 */

import type { Exception } from './exception-inbox.js';

export type BriefingCadence = 'weekly' | 'monthly' | 'adhoc';

export interface PortfolioHealth {
  readonly occupancyPct: number;
  readonly collectionsPct: number;
  readonly arrearsRatioPct: number;
  readonly maintenanceSpendMinorUnits: number;
  readonly satisfactionScore: number;
}

export interface BriefingWin {
  readonly title: string;
  readonly evidence: string;
}

export interface StrategicRecommendation {
  readonly headline: string;
  readonly rationale: string;
  readonly tradeOffs: string;
  readonly risks: string;
}

export interface GeneratedBriefing {
  readonly id: string;
  readonly tenantId: string;
  readonly cadence: BriefingCadence;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly headline: string;
  readonly portfolioHealth: PortfolioHealth;
  readonly wins: readonly BriefingWin[];
  readonly exceptions: readonly Exception[];
  readonly recommendations: readonly StrategicRecommendation[];
  readonly focusNextPeriod: readonly string[];
  readonly bodyMarkdown: string;
  readonly generatedBy: string;
  readonly createdAt: string;
}

export interface BriefingInputs {
  readonly tenantId: string;
  readonly cadence: BriefingCadence;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly portfolioHealth: PortfolioHealth;
  readonly wins: readonly BriefingWin[];
  readonly openExceptions: readonly Exception[];
  readonly trendNotes?: readonly string[];
}

export interface BriefingRepository {
  insert(briefing: GeneratedBriefing): Promise<GeneratedBriefing>;
  latestFor(tenantId: string, cadence: BriefingCadence): Promise<GeneratedBriefing | null>;
}

export interface BriefingGeneratorDeps {
  readonly repository: BriefingRepository;
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly generatedBy?: string;
}

export class ExecutiveBriefingGenerator {
  private readonly deps: BriefingGeneratorDeps;

  constructor(deps: BriefingGeneratorDeps) {
    this.deps = deps;
  }

  async generate(inputs: BriefingInputs): Promise<GeneratedBriefing> {
    const now = this.deps.clock?.() ?? new Date();
    const topWins = [...inputs.wins].slice(0, 5);
    const topExceptions = [...inputs.openExceptions]
      .sort((a, b) => rankPriority(a.priority) - rankPriority(b.priority))
      .slice(0, 5);
    const recommendations = buildRecommendations(
      inputs.portfolioHealth,
      topExceptions,
      inputs.trendNotes ?? [],
    );
    const focus = buildFocusNextPeriod(inputs.portfolioHealth, topExceptions);
    const headline = buildHeadline(inputs.cadence, inputs.portfolioHealth, topExceptions);
    const bodyMarkdown = composeBody(
      headline,
      inputs.portfolioHealth,
      topWins,
      topExceptions,
      recommendations,
      focus,
    );
    const briefing: GeneratedBriefing = {
      id: this.deps.idFactory?.() ?? `brief_${now.getTime()}`,
      tenantId: inputs.tenantId,
      cadence: inputs.cadence,
      periodStart: inputs.periodStart.toISOString(),
      periodEnd: inputs.periodEnd.toISOString(),
      headline,
      portfolioHealth: inputs.portfolioHealth,
      wins: topWins,
      exceptions: topExceptions,
      recommendations,
      focusNextPeriod: focus,
      bodyMarkdown,
      generatedBy: this.deps.generatedBy ?? 'mr_mwikila_consultant',
      createdAt: now.toISOString(),
    };
    return this.deps.repository.insert(briefing);
  }
}

/** Cron schedule for registering with the background scheduler. */
export const EXECUTIVE_BRIEFING_SCHEDULE = {
  weeklyCron: '0 8 * * 1',
  monthlyCron: '0 8 1 * *',
  taskName: 'generate_executive_briefing',
  featureFlagKey: 'autonomy.weekly_briefing',
} as const;

function rankPriority(p: Exception['priority']): number {
  return p === 'P1' ? 0 : p === 'P2' ? 1 : 2;
}

function buildHeadline(
  cadence: BriefingCadence,
  health: PortfolioHealth,
  exceptions: readonly Exception[],
): string {
  const p1 = exceptions.filter((e) => e.priority === 'P1').length;
  const occupancy = Math.round(health.occupancyPct);
  if (cadence === 'monthly') {
    return `Monthly review: occupancy ${occupancy}%, collections ${Math.round(health.collectionsPct)}%, ${p1} P1 exceptions awaiting decision.`;
  }
  return `This week: occupancy ${occupancy}%, ${p1} P1 exceptions, collections ${Math.round(health.collectionsPct)}%.`;
}

function buildRecommendations(
  health: PortfolioHealth,
  exceptions: readonly Exception[],
  trendNotes: readonly string[],
): readonly StrategicRecommendation[] {
  const recs: StrategicRecommendation[] = [];
  if (health.arrearsRatioPct > 15) {
    recs.push({
      headline: 'Accelerate arrears ladder on top quartile offenders.',
      rationale: `Arrears ratio sits at ${health.arrearsRatioPct.toFixed(1)}% — past the comfort band of 10-12%. The ladder is working on routine cases; the tail needs head-level attention.`,
      tradeOffs: 'Alternative: deeper payment plans. Slower cash but preserves occupancy.',
      risks: 'Aggressive action on a chronic-payer cohort risks a churn spike if market is soft.',
    });
  }
  if (health.occupancyPct < 88) {
    recs.push({
      headline: 'Trigger occupancy campaign before next rent cycle.',
      rationale: `Occupancy at ${health.occupancyPct.toFixed(1)}% — each vacant unit costs weekly. A 2-week push (price tune, referral incentive, portal relaunch) typically recovers 3-4 points.`,
      tradeOffs: 'Alternative: hold rents and wait for season. Cheaper now, costly across the quarter.',
      risks: 'Price tuning must be monitored — a blanket cut signals weakness to the market.',
    });
  }
  for (const note of trendNotes.slice(0, 2)) {
    recs.push({
      headline: note,
      rationale: 'Trend surfaced by the ambient brain — worth a decision.',
      tradeOffs: 'Weighed by options-with-trade-offs if you ask the strategic advisor.',
      risks: 'Signal may be noise until corroborated by next period.',
    });
  }
  if (exceptions.some((e) => e.priority === 'P1')) {
    recs.push({
      headline: 'Clear P1 exception inbox before Wednesday.',
      rationale: 'P1 items accumulate interest — delay erodes the autonomy dividend.',
      tradeOffs: 'Alternative: delegate triage to a second. Only if trust is already high.',
      risks: 'Unresolved P1s propagate into P0 escalations within a fortnight.',
    });
  }
  return recs.slice(0, 5);
}

function buildFocusNextPeriod(
  health: PortfolioHealth,
  exceptions: readonly Exception[],
): readonly string[] {
  const focus: string[] = [];
  if (health.arrearsRatioPct > 10) focus.push('Arrears — hold the line');
  if (health.occupancyPct < 92) focus.push('Occupancy — fill the gaps');
  if (exceptions.some((e) => e.domain === 'compliance')) focus.push('Compliance — close open notices');
  if (exceptions.some((e) => e.domain === 'maintenance' && e.priority !== 'P3'))
    focus.push('Maintenance — clear the backlog');
  focus.push('Autonomy posture — review delegation matrix');
  return focus.slice(0, 5);
}

function composeBody(
  headline: string,
  health: PortfolioHealth,
  wins: readonly BriefingWin[],
  exceptions: readonly Exception[],
  recs: readonly StrategicRecommendation[],
  focus: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(`# Executive briefing`, '', headline, '');
  lines.push('## Portfolio health', '');
  lines.push(`- Occupancy: ${health.occupancyPct.toFixed(1)}%`);
  lines.push(`- Collections: ${health.collectionsPct.toFixed(1)}%`);
  lines.push(`- Arrears ratio: ${health.arrearsRatioPct.toFixed(1)}%`);
  lines.push(`- Maintenance spend: ${health.maintenanceSpendMinorUnits.toLocaleString()}`);
  lines.push(`- Satisfaction proxy: ${health.satisfactionScore.toFixed(2)}`);
  lines.push('');
  if (wins.length) {
    lines.push('## Top wins', '');
    for (const w of wins) lines.push(`- **${w.title}** — ${w.evidence}`);
    lines.push('');
  }
  if (exceptions.length) {
    lines.push('## Exceptions needing a decision', '');
    for (const e of exceptions) {
      const rec = e.recommendedAction ?? 'Review and decide.';
      lines.push(`- [${e.priority}] **${e.title}** — ${rec}`);
    }
    lines.push('');
  }
  if (recs.length) {
    lines.push('## Strategic recommendations', '');
    for (const r of recs) {
      lines.push(`### ${r.headline}`);
      lines.push('');
      lines.push(`**Rationale** — ${r.rationale}`);
      lines.push(`**Trade-offs** — ${r.tradeOffs}`);
      lines.push(`**Risks** — ${r.risks}`);
      lines.push('');
    }
  }
  if (focus.length) {
    lines.push('## Focus next period', '');
    for (const f of focus) lines.push(`- ${f}`);
  }
  return lines.join('\n');
}

/** In-memory repo for tests. */
export class InMemoryBriefingRepository implements BriefingRepository {
  private readonly store = new Map<string, GeneratedBriefing>();

  async insert(briefing: GeneratedBriefing): Promise<GeneratedBriefing> {
    this.store.set(briefing.id, briefing);
    return briefing;
  }

  async latestFor(
    tenantId: string,
    cadence: BriefingCadence,
  ): Promise<GeneratedBriefing | null> {
    const all = Array.from(this.store.values())
      .filter((b) => b.tenantId === tenantId && b.cadence === cadence)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all[0] ?? null;
  }
}
