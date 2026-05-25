/**
 * Brain-driven multi-modal layout router.
 *
 * --------------------------------------------------------------------
 * WHAT THIS IS
 * --------------------------------------------------------------------
 * The router maps a brain-shaped {@link ModalContext} (device class,
 * viewport size, declared user intent, mastery level, affective
 * profile) onto a {@link LayoutComposition} — the structural
 * arrangement of a screen (compact stack, split pane, three-column
 * grid, fullbleed canvas, wizard step). The choice is made by the
 * brain, not by Tailwind breakpoints, because the same width can
 * deserve different compositions depending on WHO is using the app
 * and WHAT they are trying to do.
 *
 * --------------------------------------------------------------------
 * WHAT THIS IS NOT
 * --------------------------------------------------------------------
 * This does NOT replace CSS responsive design. CSS still handles
 * fine-grained pixel breakpoints, fluid typography, container queries,
 * and intrinsic layout. The modal-router decides the higher-level
 * COMPOSITION (what arrangement of regions to draw), then CSS handles
 * the pixels inside each region.
 *
 * Think of it as a two-layer model:
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  Layer 1 (this file): brain decides composition (5 shapes)    │
 *   │  Layer 2 (Tailwind):  CSS adapts pixels within the shape      │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * The router output is intentionally a SMALL enum (5 compositions),
 * because the brain should not invent infinite layout primitives —
 * humans recognise these five shapes and designers can tune tokens
 * per app (see {@link getCompositionTokens}).
 *
 * --------------------------------------------------------------------
 * DETERMINISM
 * --------------------------------------------------------------------
 * `routeLayout` is a pure function. Same `(ctx, options)` ALWAYS
 * yields the same `LayoutComposition`. No `Math.random`, no `Date.now`,
 * no implicit globals. This matters because the router is called by
 * components in render and during SSR — non-determinism would cause
 * hydration mismatches.
 *
 * --------------------------------------------------------------------
 * GRACEFUL DEGRADATION
 * --------------------------------------------------------------------
 * Every field of {@link ModalContext} can be missing or null. The
 * router falls back to sensible defaults: `'split-pane'` on desktop
 * and `'compact-stack'` on mobile/tablet. We never throw — UI code
 * relies on the router to always return SOMETHING.
 */

// ---------------------------------------------------------------------
// Brain-shape inputs (local types — kept structurally compatible with
// `@borjie/central-intelligence` AffectiveProfile so consumers can
// pass that value directly without an import. We deliberately AVOID a
// runtime dependency on central-intelligence so this module remains
// self-contained and tree-shakable.)
// ---------------------------------------------------------------------

/**
 * Device class — coarse-grained partition the brain uses to decide
 * the FAMILY of compositions to consider. NOT the same as a pixel
 * breakpoint; e.g. a touch-first 13" tablet is `'tablet'` even though
 * its pixel width matches a small laptop.
 */
export type ModalDeviceClass = 'mobile' | 'tablet' | 'desktop';

/**
 * Mastery level — how comfortable the user is with the app. Novices
 * deserve a wizard-step composition (one focused task at a time);
 * expert users tolerate dense grids.
 */
export type MasteryLevel = 'novice' | 'intermediate' | 'expert';

/**
 * Affective profile — slim, structurally-compatible mirror of the
 * shape exposed by `@borjie/central-intelligence/theory-of-mind`.
 * We only read `state.anxiety`; other fields are accepted but ignored.
 */
export interface AffectiveStateLike {
  readonly anxiety: number; // [0,1]
  readonly frustration?: number;
  readonly comprehension?: number;
  readonly trust?: number;
  readonly urgency?: number;
}

export interface AffectiveProfile {
  readonly state: AffectiveStateLike;
  readonly turns?: number;
  readonly updatedAt?: string;
}

/**
 * Viewport — `width` and `height` in CSS pixels. Used for
 * orientation detection (tablet portrait vs landscape) and as a
 * tiebreaker when other signals are missing.
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * ModalContext — the brain's view of the current screen. All fields
 * except `device` + `viewport` are nullable because they may not be
 * known at first render. The router treats `null` as "no signal" and
 * falls back to defaults.
 */
export interface ModalContext {
  readonly device: ModalDeviceClass;
  readonly viewport: Viewport;
  readonly intent: string | null;
  readonly masteryLevel: MasteryLevel | null;
  readonly affectiveProfile?: AffectiveProfile | undefined;
}

/**
 * Options that describe the screen contents themselves — independent
 * of the user. Routed in alongside the brain-shape context.
 */
export interface RouteLayoutOptions {
  /** How many top-level sections the screen wants to render. */
  readonly sectionCount: number;
  /**
   * `true` when the screen embeds a non-trivial editor / chart /
   * canvas — drives the mobile sticky-CTA decision.
   */
  readonly hasComplexInteraction: boolean;
}

/**
 * LayoutComposition — the FIVE shapes the brain picks between.
 *
 *  - `compact-stack`     vertical stack, sticky CTA on mobile
 *  - `split-pane`        two regions side-by-side (master/detail)
 *  - `three-column-grid` analytics dashboard, lots of widgets
 *  - `fullbleed-canvas`  one big canvas (document review, PDF, map)
 *  - `wizard-step`       single focused task, novice-friendly
 */
export type LayoutComposition =
  | 'compact-stack'
  | 'split-pane'
  | 'three-column-grid'
  | 'fullbleed-canvas'
  | 'wizard-step';

// ---------------------------------------------------------------------
// Heuristics — kept as named constants so the policy is auditable.
// ---------------------------------------------------------------------

const HIGH_ANXIETY_THRESHOLD = 0.6;

/**
 * Intents the router treats as "analytics-shaped". Matching is
 * case-insensitive and substring-friendly so we don't have to keep
 * this in lockstep with every kernel string.
 */
const ANALYTICS_INTENT_TOKENS: ReadonlyArray<string> = [
  'analytics',
  'dashboard',
  'report',
  'metric',
  'kpi',
];

/**
 * Intents that demand a single huge editable surface.
 */
const DOCUMENT_REVIEW_INTENT_TOKENS: ReadonlyArray<string> = [
  'document-review',
  'document_review',
  'document review',
  'pdf-review',
  'contract-review',
  'review-document',
];

function isHighAnxiety(profile: AffectiveProfile | null | undefined): boolean {
  if (!profile || typeof profile.state?.anxiety !== 'number') return false;
  return profile.state.anxiety >= HIGH_ANXIETY_THRESHOLD;
}

function matchesAny(intent: string | null, tokens: ReadonlyArray<string>): boolean {
  if (!intent) return false;
  const normalized = intent.toLowerCase();
  for (const token of tokens) {
    if (normalized.includes(token)) return true;
  }
  return false;
}

function isTabletLandscape(viewport: Viewport | undefined): boolean {
  if (!viewport || typeof viewport.width !== 'number' || typeof viewport.height !== 'number') {
    return false;
  }
  return viewport.width > viewport.height;
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Choose a {@link LayoutComposition} for the current screen.
 *
 * The rule cascade — first matching rule wins:
 *
 *  1. Mobile + novice mastery + high anxiety → `'wizard-step'`
 *     (one focused task: do not overwhelm a stressed beginner)
 *  2. Mobile + complex interaction          → `'compact-stack'`
 *     (vertical flow with a sticky CTA — see token map)
 *  3. Tablet portrait                       → `'compact-stack'`
 *  4. Tablet landscape                      → `'split-pane'`
 *  5. Desktop + analytics intent            → `'three-column-grid'`
 *  6. Desktop + document-review intent      → `'fullbleed-canvas'`
 *  7. Default: `'split-pane'` on desktop, `'compact-stack'` elsewhere.
 *
 * The function is pure and total — it always returns a value, even
 * when every brain-signal is missing.
 */
export function routeLayout(
  ctx: ModalContext,
  options: RouteLayoutOptions,
): LayoutComposition {
  // Defensive defaults for partial / poorly-typed callers (the router
  // is invoked from JSX where `as` casts can hide undefined).
  const device: ModalDeviceClass = ctx?.device ?? 'desktop';
  const intent = ctx?.intent ?? null;
  const mastery = ctx?.masteryLevel ?? null;
  const affective = ctx?.affectiveProfile ?? null;
  const viewport = ctx?.viewport;
  const hasComplexInteraction = Boolean(options?.hasComplexInteraction);

  // Rule 1 — protect the novice-and-anxious user on mobile.
  if (device === 'mobile' && mastery === 'novice' && isHighAnxiety(affective)) {
    return 'wizard-step';
  }

  // Rule 2 — mobile with rich interactivity = vertical-stack + sticky CTA.
  if (device === 'mobile' && hasComplexInteraction) {
    return 'compact-stack';
  }

  // Rules 3 + 4 — tablet orientation drives the choice.
  if (device === 'tablet') {
    return isTabletLandscape(viewport) ? 'split-pane' : 'compact-stack';
  }

  // Rules 5 + 6 — desktop, biased by declared intent.
  if (device === 'desktop') {
    if (matchesAny(intent, DOCUMENT_REVIEW_INTENT_TOKENS)) {
      return 'fullbleed-canvas';
    }
    if (matchesAny(intent, ANALYTICS_INTENT_TOKENS)) {
      return 'three-column-grid';
    }
  }

  // Rule 7 — sensible defaults.
  return device === 'desktop' ? 'split-pane' : 'compact-stack';
}

// ---------------------------------------------------------------------
// CSS-token mapping
// ---------------------------------------------------------------------

/**
 * The token shape designers may consume directly (e.g. as Tailwind
 * arbitrary values or CSS variables). Apps can call
 * {@link getCompositionTokens} then override individual values per
 * theme — this module never assumes a specific design language.
 *
 * Units:
 *   - `gap`, `padding` — Tailwind spacing scale tokens (e.g. `'4'`,
 *     `'6'`) so consumers can plug into `gap-{x}` / `p-{x}`.
 *   - `maxWidth` — Tailwind max-width tokens or arbitrary values.
 *   - `breakpointNudge` — a hint at which Tailwind breakpoint the
 *     CSS layer should switch its inner grid.
 *   - `stickyCta` — whether the composition needs a sticky CTA.
 *   - `columns` — number of primary columns the composition implies.
 */
export interface CompositionTokens {
  readonly gap: string;
  readonly padding: string;
  readonly maxWidth: string;
  readonly breakpointNudge: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  readonly stickyCta: boolean;
  readonly columns: number;
}

const COMPOSITION_TOKENS: Readonly<Record<LayoutComposition, CompositionTokens>> = {
  'compact-stack': {
    gap: '4',
    padding: '4',
    maxWidth: 'max-w-screen-sm',
    breakpointNudge: 'sm',
    stickyCta: true,
    columns: 1,
  },
  'split-pane': {
    gap: '6',
    padding: '6',
    maxWidth: 'max-w-screen-xl',
    breakpointNudge: 'md',
    stickyCta: false,
    columns: 2,
  },
  'three-column-grid': {
    gap: '6',
    padding: '8',
    maxWidth: 'max-w-screen-2xl',
    breakpointNudge: 'lg',
    stickyCta: false,
    columns: 3,
  },
  'fullbleed-canvas': {
    gap: '0',
    padding: '0',
    maxWidth: 'max-w-none',
    breakpointNudge: 'xl',
    stickyCta: false,
    columns: 1,
  },
  'wizard-step': {
    gap: '4',
    padding: '6',
    maxWidth: 'max-w-md',
    breakpointNudge: 'sm',
    stickyCta: true,
    columns: 1,
  },
};

/**
 * Lookup the CSS-token mapping for a composition. The returned object
 * is a fresh shallow copy (immutable convention — callers can spread
 * + override without mutating the module-level table).
 */
export function getCompositionTokens(comp: LayoutComposition): CompositionTokens {
  const base = COMPOSITION_TOKENS[comp];
  return { ...base };
}

/**
 * The full set of compositions, in their canonical order. Useful for
 * storybook indices and exhaustive switch helpers.
 */
export const ALL_LAYOUT_COMPOSITIONS: ReadonlyArray<LayoutComposition> = [
  'compact-stack',
  'split-pane',
  'three-column-grid',
  'fullbleed-canvas',
  'wizard-step',
];
