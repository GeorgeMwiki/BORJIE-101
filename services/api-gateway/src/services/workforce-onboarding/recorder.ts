/**
 * Workforce onboarding recorder — pure functions exercised by the
 * `routes/workforce/openings.hono.ts` router.
 *
 * Chain L-A (issue #193):
 *   owner posts opening -> invitation drafted -> candidate activates ->
 *   manager reviews -> approve|reject -> worker.workforce_status flips ->
 *   opening.count_needed decrements -> opening auto-fills when 0.
 *
 * Why extracted from the route handler?
 *   - The state-machine + decrement logic is the load-bearing piece
 *     that downstream brain tools and cron auto-expire share.
 *   - Pure deciders make unit-testing cheap (no Hono mounting needed).
 *
 * No DB I/O here — the route file holds the Drizzle calls. This module
 * owns the *decisions*: what status a given action should produce, what
 * the new count is, when an opening auto-fills.
 */

export type OpeningStatus = 'open' | 'filled' | 'closed' | 'expired';

export type CandidateDecision = 'approve' | 'reject';

export interface ReviewCandidateInput {
  readonly currentOpeningStatus: OpeningStatus;
  readonly currentCountNeeded: number;
  readonly decision: CandidateDecision;
}

export interface ReviewCandidateResult {
  /** workforce_status flip on the user row. */
  readonly newUserWorkforceStatus: 'active' | 'rejected';
  /** New count on the source opening (unchanged on reject). */
  readonly newCountNeeded: number;
  /** New status on the source opening (auto-fills when count hits 0). */
  readonly newOpeningStatus: OpeningStatus;
  /**
   * True when the manager decision drove the opening to fully filled.
   * Used by the route handler to publish the cockpit pulse.
   */
  readonly openingFilled: boolean;
}

/**
 * Decide the (user, opening) state transitions for a manager
 * approve / reject decision on a candidate.
 *
 * Invariants enforced:
 *   - The source opening MUST still be 'open' for the decision to
 *     produce any opening-side mutation. A closed / filled / expired
 *     opening still produces a valid user-side flip but leaves the
 *     opening untouched (no count rewind).
 *   - Approve decrements count by exactly 1; reject leaves count
 *     unchanged.
 *   - When count reaches 0, the opening auto-flips to 'filled'.
 *   - count never goes negative — guarded by `Math.max(0, ...)`.
 */
export function reviewCandidate(
  input: ReviewCandidateInput,
): ReviewCandidateResult {
  const { currentOpeningStatus, currentCountNeeded, decision } = input;

  if (decision === 'reject') {
    return {
      newUserWorkforceStatus: 'rejected',
      newCountNeeded: currentCountNeeded,
      newOpeningStatus: currentOpeningStatus,
      openingFilled: false,
    };
  }

  // Approve path.
  if (currentOpeningStatus !== 'open') {
    // Opening is no longer open — flip the user but do not touch the
    // opening (count stays put).
    return {
      newUserWorkforceStatus: 'active',
      newCountNeeded: currentCountNeeded,
      newOpeningStatus: currentOpeningStatus,
      openingFilled: false,
    };
  }

  const newCount = Math.max(0, currentCountNeeded - 1);
  const filled = newCount === 0;
  return {
    newUserWorkforceStatus: 'active',
    newCountNeeded: newCount,
    newOpeningStatus: filled ? 'filled' : 'open',
    openingFilled: filled,
  };
}

/**
 * Decide whether a manager / owner / admin role is allowed to approve
 * candidates for the given opening. Mirrors the inviter-roles set in
 * `workforce/invites.hono.ts` for symmetry. Workers cannot approve.
 */
export function canReviewCandidates(role: string | undefined): boolean {
  if (!role) return false;
  return (
    role === 'OWNER' ||
    role === 'TENANT_ADMIN' ||
    role === 'PROPERTY_MANAGER' ||
    role === 'SUPER_ADMIN'
  );
}

/**
 * Resolve the human-readable bilingual review-decision summary used
 * in audit-chain `details` + the manager-side push notification.
 */
export function describeReviewDecision(
  decision: CandidateDecision,
): { readonly sw: string; readonly en: string } {
  if (decision === 'approve') {
    return {
      sw: 'Mfanyakazi amekubaliwa na meneja',
      en: 'Worker approved by manager',
    };
  }
  return {
    sw: 'Mfanyakazi amekataliwa na meneja',
    en: 'Worker rejected by manager',
  };
}
