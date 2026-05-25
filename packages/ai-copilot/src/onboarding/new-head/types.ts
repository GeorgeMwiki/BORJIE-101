/**
 * New-head onboarding tour — Wave 28.
 *
 * The existing 7-step autonomy wizard configures the delegation policy.
 * This is a separate, complementary experience: when a NEW head logs in
 * for the first time (either because they're fresh-to-the-platform, or
 * because they've just inherited a portfolio from a predecessor), the
 * tour walks them through the five things they actually need to see
 * before they can make their first decision:
 *
 *   1. portfolio_summary       — "Here's your last 30 days at a glance."
 *   2. pending_inbox           — "These decisions are waiting on you."
 *   3. delegation_walkthrough  — "Here is what Mr. Mwikila is doing on
 *                                 your authority right now."
 *   4. first_week_tasks        — "Here's what typically wants your eyes
 *                                 in week 1."
 *   5. autonomy_policy_link    — "When ready, tune the rails here."
 *
 * The tour is stateful (so a head can step away and resume), skippable
 * per-step (optional steps can be dismissed), and persistable via a
 * pluggable repository. Composition happens in `tour-composer.ts`; the
 * `tour-service.ts` lifecycle is pure.
 */

import type { Exception } from '../../autonomy/exception-inbox.js';
import type { PortfolioHealth } from '../../autonomy/briefing-generator.js';

export type TourStepId =
  | 'portfolio_summary'
  | 'pending_inbox'
  | 'delegation_walkthrough'
  | 'first_week_tasks'
  | 'autonomy_policy_link';

export const TOUR_STEP_ORDER: readonly TourStepId[] = [
  'portfolio_summary',
  'pending_inbox',
  'delegation_walkthrough',
  'first_week_tasks',
  'autonomy_policy_link',
] as const;

export const TOUR_STEPS_TOTAL = TOUR_STEP_ORDER.length;

export type TourStepStatus = 'pending' | 'viewed' | 'skipped' | 'completed';

export interface TourStep {
  readonly id: TourStepId;
  readonly title: string;
  readonly blurb: string;
  readonly optional: boolean;
  readonly status: TourStepStatus;
}

/** First-week focus suggestion — read by the UI's checklist strip. */
export interface FirstWeekTask {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
}

/** Composer output — everything the UI needs to render the first two steps. */
export interface TourPayload {
  readonly portfolioHealth: PortfolioHealth | null;
  readonly portfolioSummary: string;
  readonly pendingInboxCount: number;
  readonly pendingInboxTop: readonly Exception[];
  readonly delegationMatrix: {
    readonly domains: number;
    readonly actionTypes: number;
    readonly totalCells: number;
  };
  readonly firstWeekTasks: readonly FirstWeekTask[];
  readonly autonomyPolicyHref: string;
}

export interface TourState {
  readonly id: string;
  readonly tenantId: string;
  readonly newHeadUserId: string;
  readonly steps: readonly TourStep[];
  readonly currentStepId: TourStepId | null;
  readonly payload: TourPayload | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export type TourResultOutcome = 'completed' | 'in_progress' | 'not_started';

export interface TourResult {
  readonly state: TourState;
  readonly outcome: TourResultOutcome;
  readonly nextStepId: TourStepId | null;
}

export interface TourRepository {
  insert(state: TourState): Promise<TourState>;
  findByHead(tenantId: string, userId: string): Promise<TourState | null>;
  update(tenantId: string, id: string, patch: Partial<TourState>): Promise<TourState>;
}
