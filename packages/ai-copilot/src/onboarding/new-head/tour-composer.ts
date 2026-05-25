/**
 * Tour composer — pure assembly of the TourPayload.
 *
 * Takes four inputs:
 *   - a 30-day PortfolioHealth snapshot (from briefing-generator callers)
 *   - the pending exception inbox (top + count)
 *   - the delegation matrix dimensions (from AUTONOMY_DOMAINS)
 *   - the autonomy-policy tutorial URL (injected — the tutorial lives
 *     outside this package)
 *
 * No I/O. Repositories fetch inputs; this file just shapes them into the
 * `TourPayload` the UI renders. Keeping composition pure means the tour
 * is fully unit-testable with fixtures.
 */

import type { Exception } from '../../autonomy/exception-inbox.js';
import type { PortfolioHealth } from '../../autonomy/briefing-generator.js';
import { DELEGATION_MATRIX_DIMENSIONS } from '../../autonomy/defaults.js';
import type { FirstWeekTask, TourPayload, TourStep } from './types.js';
import { TOUR_STEP_ORDER } from './types.js';

export interface TourComposerInputs {
  readonly portfolioHealth: PortfolioHealth | null;
  readonly pendingInbox: readonly Exception[];
  readonly pendingInboxTotal: number;
  readonly autonomyPolicyHref?: string;
}

/**
 * Compose the full TourPayload. `portfolioHealth === null` means the
 * tenant has no 30-day window yet — the UI renders a "gathering data"
 * placeholder instead of a summary.
 */
export function composeTour(inputs: TourComposerInputs): TourPayload {
  const topExceptions = [...inputs.pendingInbox]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 5);
  return {
    portfolioHealth: inputs.portfolioHealth,
    portfolioSummary: summarisePortfolio(inputs.portfolioHealth),
    pendingInboxCount: inputs.pendingInboxTotal,
    pendingInboxTop: topExceptions,
    delegationMatrix: {
      domains: DELEGATION_MATRIX_DIMENSIONS.domains,
      actionTypes: DELEGATION_MATRIX_DIMENSIONS.actionTypes,
      totalCells: DELEGATION_MATRIX_DIMENSIONS.totalCells,
    },
    firstWeekTasks: buildFirstWeekTasks(inputs.portfolioHealth, topExceptions),
    autonomyPolicyHref: inputs.autonomyPolicyHref ?? '/docs/autonomy/policy-tutorial',
  };
}

export function buildInitialSteps(): readonly TourStep[] {
  return TOUR_STEP_ORDER.map((id) => ({
    id,
    title: TOUR_STEP_TITLES[id],
    blurb: TOUR_STEP_BLURBS[id],
    optional: TOUR_STEP_OPTIONAL.has(id),
    status: 'pending',
  }));
}

const TOUR_STEP_TITLES: Record<ReturnType<typeof TOUR_STEP_ORDER[number]['valueOf']>, string> = {
  portfolio_summary: 'Your portfolio, last 30 days',
  pending_inbox: 'Decisions waiting on you',
  delegation_walkthrough: 'What Mr. Mwikila is doing on your authority',
  first_week_tasks: 'Your first week',
  autonomy_policy_link: 'Tune the rails when you\'re ready',
};

const TOUR_STEP_BLURBS: Record<ReturnType<typeof TOUR_STEP_ORDER[number]['valueOf']>, string> = {
  portfolio_summary:
    'A snapshot of occupancy, collections, arrears, and maintenance spend across every property you now oversee.',
  pending_inbox:
    'Every exception the autonomous layer refused is here — prioritised P1/P2/P3 so triage takes minutes.',
  delegation_walkthrough:
    'The 11 domains × 6 action types grid shows exactly which cells are delegated. Start by reading, not editing.',
  first_week_tasks:
    'A short checklist of what typically wants a new head\'s eyes in the first seven days.',
  autonomy_policy_link:
    'When you\'re ready to change the rails, the policy wizard walks you through it — nothing here touches that.',
};

const TOUR_STEP_OPTIONAL: ReadonlySet<string> = new Set(['first_week_tasks', 'autonomy_policy_link']);

function priorityRank(p: Exception['priority']): number {
  return p === 'P1' ? 0 : p === 'P2' ? 1 : 2;
}

function summarisePortfolio(health: PortfolioHealth | null): string {
  if (!health) {
    return 'Gathering your first 30 days of data — summary will appear as events land.';
  }
  return [
    `Occupancy ${health.occupancyPct.toFixed(1)}%`,
    `collections ${health.collectionsPct.toFixed(1)}%`,
    `arrears ratio ${health.arrearsRatioPct.toFixed(1)}%`,
    `maintenance spend ${health.maintenanceSpendMinorUnits.toLocaleString()}`,
  ].join(' · ');
}

function buildFirstWeekTasks(
  health: PortfolioHealth | null,
  topExceptions: readonly Exception[],
): readonly FirstWeekTask[] {
  const tasks: FirstWeekTask[] = [];
  tasks.push({
    id: 'review_delegation_matrix',
    title: 'Read the delegation matrix end-to-end',
    rationale: 'You cannot supervise rails you have not seen. Read-only first.',
  });
  if (health && health.arrearsRatioPct > 10) {
    tasks.push({
      id: 'scan_arrears_tail',
      title: 'Scan the top-quartile arrears tail',
      rationale: `Arrears ratio at ${health.arrearsRatioPct.toFixed(1)}% — read the 5 biggest cases before tuning anything.`,
    });
  }
  if (topExceptions.some((e) => e.priority === 'P1')) {
    tasks.push({
      id: 'clear_p1_inbox',
      title: 'Clear the P1 exception inbox',
      rationale: 'P1 items compound quickly — close them before end of week one.',
    });
  }
  tasks.push({
    id: 'meet_mr_mwikila',
    title: 'Do a five-minute "meet Mr. Mwikila" voice session',
    rationale: 'Confirm you can reach the AI and that it has your tenant context.',
  });
  tasks.push({
    id: 'set_escalation',
    title: 'Confirm escalation contacts',
    rationale: 'If the rails close, the AI needs to know exactly whom to ping.',
  });
  return tasks.slice(0, 5);
}
