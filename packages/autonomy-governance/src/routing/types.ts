/**
 * Confidence-band routing — public types.
 *
 * The Klarna-fingerprint defense (per `.audit/litfin-sota-2026-05-23/
 * 10-outcome-as-a-service.md` §3.1): treat low-confidence decisions as a
 * separate risk class rather than collapsing them into the auto-execute
 * lane. Klarna's reversal was traced to ~5% edge-case hallucinations that
 * the deflection-rate-optimised pipeline shoved through anyway; this
 * primitive forces those into an audit or human-escalation lane.
 *
 * The function is pure and wire-agnostic — persistence + actual
 * audit-queue + escalation handoff are downstream wiring concerns and
 * out of scope for this substrate file.
 */

/**
 * Three routing bands. Strictly ordered from highest autonomy → lowest.
 *   - `auto`     fully autonomous execution; no audit trail required
 *   - `audit`    autonomous execution but every action queued for review
 *   - `escalate` do NOT execute — surface to a named accountable human
 */
export type Band = 'auto' | 'audit' | 'escalate';

/**
 * The pure-function output. Reason is for audit trails — never returned
 * back to the deciding sub-MD itself (it would optimise around it, same
 * rule as `CapVerdict.reason`).
 */
export interface RouteDecision {
  readonly mode: Band;
  readonly reason: string;
}

/**
 * Per-tier threshold pair. `auto` is the confidence at or above which the
 * decision auto-executes; `audit` is the confidence at or above which the
 * decision auto-executes *with* an audit-queue entry. Below `audit` the
 * decision escalates.
 *
 * Invariants (enforced by `route`, not by the type system because numeric
 * literals in `TierThresholds` records would lock us out of test data):
 *   - 0 < audit <= auto <= 1
 *   - Comparisons are inclusive on the lower bound (i.e. `>=`), matching
 *     the spec wording "confidence > 0.95 → auto" interpreted as the
 *     conventional half-open band [0.95, 1.0]. Boundary cases are tested.
 */
export interface TierThresholds {
  readonly auto: number;
  readonly audit: number;
}

/**
 * Pricing/governance tier of the tenant. Mirrors the SKU tiers in
 * `pricing-tiers` (free / growth / enterprise) — repeated as a string
 * union here so this substrate has no upward dependency on the billing
 * package.
 */
export type TenantTier = 'free' | 'growth' | 'enterprise';
