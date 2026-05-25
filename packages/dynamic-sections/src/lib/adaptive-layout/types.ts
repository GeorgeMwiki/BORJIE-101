/**
 * Adaptive layout engine — type contracts.
 *
 * Vision: the dashboard a frustrated tenant sees should NOT be the
 * same as the dashboard a happy tenant sees. The same goes for
 * novice vs. master, casual vs. payment-bent, mobile vs. desktop.
 *
 * The engine is a deterministic, side-effect-free pure function that
 * folds N independent policies (frustration, role-mastery, recency,
 * intent, …) into a single {@link LayoutDecision}. Each policy is
 * narrow, individually testable, and reorders/hides sections by
 * emitting a weighted partial-ordering preference.
 *
 * Determinism is load-bearing: the same `(context, baseSections,
 * policies)` triple must yield the same {@link LayoutDecision}
 * across runs — server-side renders, client hydration, and the
 * persistence-layer mirror (see migration 0182 `section_layouts`)
 * MUST agree. Policies therefore avoid `Math.random`, `Date.now`,
 * `Map` iteration order assumptions, and any other implicit clocks.
 */

/**
 * A SectionId is the stable key of a registered Section (see
 * `contracts/section.ts`'s {@link Section.key}). Kept as a TS branded
 * `string` so we don't pull a runtime dependency on the Section
 * interface — adaptive-layout is intentionally orthogonal to the
 * registry shape so it can be unit-tested standalone.
 */
export type SectionId = string;

/**
 * Mastery tier of the current viewer for the current route's domain.
 * `novice` collapses advanced sections; `intermediate` exposes them;
 * `expert` lets pro-mode panels float to the top.
 *
 * The tier is computed UPSTREAM by P-6 / P-8 (classroom BKT) and
 * passed in via {@link LayoutContext}. The layout engine does not
 * infer mastery itself.
 */
export type MasteryLevel = 'novice' | 'intermediate' | 'expert';

/**
 * Viewport bucket the layout is being decided for. Mirrors the
 * three-tier breakpoint table used in `hooks/use-viewport-breakpoint`.
 */
export type ViewportBreakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * Affective state slice used by the frustration-policy. Mirrors a
 * read-only projection of the kernel's
 * `packages/central-intelligence/src/kernel/theory-of-mind.ts`
 * `AffectiveState` so this package does not depend on
 * central-intelligence at the type level.
 *
 * All values are clamped to `[0, 1]` upstream; the policy treats
 * out-of-range numbers as undefined (no behavioural effect).
 */
export interface AffectiveProfile {
  readonly frustration: number;
  readonly comprehension: number;
  readonly anxiety: number;
  readonly trust: number;
  readonly urgency: number;
}

/**
 * A snapshot of the viewer's behaviour relevant to layout. Recency
 * lives here so the recency-policy is a pure function over
 * {@link LayoutContext.recentActions}. Lower index = more recent.
 */
export interface UserBehaviorPattern {
  /**
   * Section keys the user has interacted with recently, ordered
   * most-recent-first. The recency-policy pins the head of this
   * array to the top of the layout. May be empty.
   */
  readonly recentActions: readonly SectionId[];
  /**
   * Total interaction count per section across the rolling window.
   * Currently unused by the shipped policies but reserved for the
   * follow-up "popularity within tenant" policy.
   */
  readonly interactionCounts?: Readonly<Record<SectionId, number>>;
}

/**
 * Detected intent for the current view. The intent-policy interprets
 * this as a strong signal — when present and known, the matching
 * section is pinned to the top regardless of recency.
 *
 * `null` means "no intent detected"; the policy is then a no-op.
 *
 * Intent values are deliberately string-typed (not enum) so new
 * intents can be added by P-10 / P-6 without a coordinated migration.
 * Canonical values used by the shipped policies:
 *   - 'payment'   → pin payment section
 *   - 'support'   → pin support section
 *   - 'maintenance' → pin maintenance section
 *   - 'reports'  → pin reports section
 *   - null
 */
export type DetectedIntent = string | null;

/**
 * The context against which the engine + every policy is evaluated.
 * Constructed once per render of the adaptive-layout hook (a follow-up).
 */
export interface LayoutContext {
  readonly tenantId: string;
  readonly userId: string;
  /**
   * App-route key (e.g. 'owner.dashboard', 'tenant.payments'). Used
   * as the persistence key for the section_layouts table — two
   * routes have independent layouts.
   */
  readonly route: string;
  readonly role: string;
  readonly masteryLevel: MasteryLevel;
  readonly behavior: UserBehaviorPattern;
  /**
   * Affective profile. May be undefined when the kernel has not
   * yet observed the user (cold-start). Policies that read affective
   * state MUST tolerate undefined.
   */
  readonly affectiveProfile?: AffectiveProfile;
  readonly intent: DetectedIntent;
  readonly viewport: ViewportBreakpoint;
}

/**
 * The output contract of the engine. Designed so the consumer (the
 * tab-bar, the page, the persistence layer) can read all three
 * arrays and the rationale without re-running policies.
 *
 * Invariants:
 *   - `sections` contains every input id exactly once unless that id
 *     also appears in `hidden`.
 *   - `pinned ⊆ sections` (pinned ids are also present in `sections`
 *     in their pinned position — `sections` is the source of truth
 *     for the rendered order).
 *   - `hidden ∩ sections = ∅` (hidden ids are removed from the
 *     rendered order).
 *   - `rationale` is a stable, human-readable string suitable for
 *     debug overlay + telemetry; never contains PII.
 */
export interface LayoutDecision {
  readonly sections: readonly SectionId[];
  readonly pinned: readonly SectionId[];
  readonly hidden: readonly SectionId[];
  readonly rationale: string;
}

/**
 * The output of a single policy. A policy NEVER commits the final
 * ordering — it emits weighted preferences that the engine merges.
 *
 * Policies declare:
 *   - `pin`    : ids the policy wants pulled to the top, in order
 *   - `hide`   : ids the policy wants removed from the layout entirely
 *   - `boost`  : per-id weight nudge for stable merge (higher = nearer top)
 *   - `weight` : policy-level weight; higher = wins on conflict
 *   - `reason` : human-readable explanation for {@link LayoutDecision.rationale}
 *
 * Returning an empty preference (no pin, no hide, no boost) means
 * the policy abstains — the engine treats abstention as a non-event.
 */
export interface LayoutPreference {
  readonly pin: readonly SectionId[];
  readonly hide: readonly SectionId[];
  readonly boost: Readonly<Record<SectionId, number>>;
  readonly weight: number;
  readonly reason: string;
}

/**
 * The shape of a policy. A policy is a pure function from
 * {@link LayoutContext} + the base ordering to a {@link LayoutPreference}.
 *
 * Policies MUST be deterministic — see {@link LayoutContext}.
 *
 * Policies MAY inspect `baseSections` to scope their preferences to
 * sections that actually exist (e.g. the intent-policy doesn't pin
 * a `payment` section if it isn't registered in this scope).
 */
export interface LayoutPolicy {
  /** Stable identifier; surfaced in rationale + telemetry. */
  readonly id: string;
  /** Pure evaluator. */
  decide(
    context: LayoutContext,
    baseSections: readonly SectionId[],
  ): LayoutPreference;
}

/**
 * Empty preference helper — convenience for policy abstention.
 */
export const ABSTAIN: LayoutPreference = Object.freeze({
  pin: Object.freeze([]) as readonly SectionId[],
  hide: Object.freeze([]) as readonly SectionId[],
  boost: Object.freeze({}) as Readonly<Record<SectionId, number>>,
  weight: 0,
  reason: '',
});
