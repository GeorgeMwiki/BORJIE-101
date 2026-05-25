/**
 * Tests for the brain-driven multi-modal layout router.
 *
 * The router maps a {@link ModalContext} (device class, viewport,
 * intent, mastery, affect) onto one of five {@link LayoutComposition}
 * shapes. These tests cover the full rule cascade and the graceful-
 * degradation contract (every field may be null/undefined).
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_LAYOUT_COMPOSITIONS,
  getCompositionTokens,
  routeLayout,
  type AffectiveProfile,
  type LayoutComposition,
  type ModalContext,
  type ModalDeviceClass,
  type RouteLayoutOptions,
  type Viewport,
} from '../modal-router.js';

// ---------------------------------------------------------------------
// Test helpers — immutable builders that return fresh objects so tests
// never accidentally share mutable state.
// ---------------------------------------------------------------------

const PORTRAIT_TABLET: Viewport = { width: 820, height: 1180 };
const LANDSCAPE_TABLET: Viewport = { width: 1180, height: 820 };
const MOBILE_VIEWPORT: Viewport = { width: 390, height: 844 };
const DESKTOP_VIEWPORT: Viewport = { width: 1440, height: 900 };

function makeAffective(anxiety: number): AffectiveProfile {
  return {
    state: { anxiety },
    turns: 1,
    updatedAt: '2026-05-21T00:00:00.000Z',
  };
}

function makeCtx(overrides: Partial<ModalContext> & { device: ModalDeviceClass }): ModalContext {
  return {
    viewport: DESKTOP_VIEWPORT,
    intent: null,
    masteryLevel: null,
    affectiveProfile: undefined,
    ...overrides,
  };
}

function makeOpts(overrides: Partial<RouteLayoutOptions> = {}): RouteLayoutOptions {
  return {
    sectionCount: 1,
    hasComplexInteraction: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1. Mobile + novice + anxious → wizard-step
// ---------------------------------------------------------------------

describe('routeLayout — mobile, novice, anxious', () => {
  it('returns wizard-step when the user is a stressed beginner on mobile', () => {
    const ctx = makeCtx({
      device: 'mobile',
      viewport: MOBILE_VIEWPORT,
      masteryLevel: 'novice',
      affectiveProfile: makeAffective(0.85),
    });
    expect(routeLayout(ctx, makeOpts())).toBe('wizard-step');
  });

  it('does NOT promote to wizard-step when anxiety is below the threshold', () => {
    const ctx = makeCtx({
      device: 'mobile',
      viewport: MOBILE_VIEWPORT,
      masteryLevel: 'novice',
      affectiveProfile: makeAffective(0.2),
    });
    // Falls through to the default for mobile → compact-stack.
    expect(routeLayout(ctx, makeOpts())).toBe('compact-stack');
  });

  it('does NOT promote to wizard-step for an expert under stress', () => {
    const ctx = makeCtx({
      device: 'mobile',
      viewport: MOBILE_VIEWPORT,
      masteryLevel: 'expert',
      affectiveProfile: makeAffective(0.9),
    });
    expect(routeLayout(ctx, makeOpts())).not.toBe('wizard-step');
  });
});

// ---------------------------------------------------------------------
// 2. Mobile + complex interaction → compact-stack (sticky CTA token)
// ---------------------------------------------------------------------

describe('routeLayout — mobile with complex interaction', () => {
  it('returns compact-stack for a complex-interaction mobile screen', () => {
    const ctx = makeCtx({ device: 'mobile', viewport: MOBILE_VIEWPORT });
    expect(routeLayout(ctx, makeOpts({ hasComplexInteraction: true }))).toBe('compact-stack');
  });

  it('compact-stack tokens declare a sticky CTA (so mobile sees an anchored primary action)', () => {
    expect(getCompositionTokens('compact-stack').stickyCta).toBe(true);
  });
});

// ---------------------------------------------------------------------
// 3 + 4. Tablet orientation
// ---------------------------------------------------------------------

describe('routeLayout — tablet orientation', () => {
  it('returns compact-stack for tablet portrait', () => {
    const ctx = makeCtx({ device: 'tablet', viewport: PORTRAIT_TABLET });
    expect(routeLayout(ctx, makeOpts())).toBe('compact-stack');
  });

  it('returns split-pane for tablet landscape', () => {
    const ctx = makeCtx({ device: 'tablet', viewport: LANDSCAPE_TABLET });
    expect(routeLayout(ctx, makeOpts())).toBe('split-pane');
  });
});

// ---------------------------------------------------------------------
// 5 + 6. Desktop + intent
// ---------------------------------------------------------------------

describe('routeLayout — desktop intent routing', () => {
  it('returns three-column-grid when intent is analytics', () => {
    const ctx = makeCtx({
      device: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      intent: 'analytics',
    });
    expect(routeLayout(ctx, makeOpts())).toBe('three-column-grid');
  });

  it('also matches analytics-ish intents (dashboard, kpi, report)', () => {
    for (const intent of ['dashboard', 'view-kpi', 'monthly report']) {
      const ctx = makeCtx({ device: 'desktop', viewport: DESKTOP_VIEWPORT, intent });
      expect(routeLayout(ctx, makeOpts())).toBe('three-column-grid');
    }
  });

  it('returns fullbleed-canvas when intent is document-review', () => {
    const ctx = makeCtx({
      device: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      intent: 'document-review',
    });
    expect(routeLayout(ctx, makeOpts())).toBe('fullbleed-canvas');
  });

  it('also matches document-review variants (pdf-review, contract-review)', () => {
    for (const intent of ['pdf-review', 'contract-review', 'document_review']) {
      const ctx = makeCtx({ device: 'desktop', viewport: DESKTOP_VIEWPORT, intent });
      expect(routeLayout(ctx, makeOpts())).toBe('fullbleed-canvas');
    }
  });
});

// ---------------------------------------------------------------------
// 7. Default fallback
// ---------------------------------------------------------------------

describe('routeLayout — default fallback', () => {
  it('returns split-pane for desktop with no intent', () => {
    const ctx = makeCtx({ device: 'desktop', viewport: DESKTOP_VIEWPORT });
    expect(routeLayout(ctx, makeOpts())).toBe('split-pane');
  });

  it('returns compact-stack for mobile with no other signals', () => {
    const ctx = makeCtx({ device: 'mobile', viewport: MOBILE_VIEWPORT });
    expect(routeLayout(ctx, makeOpts())).toBe('compact-stack');
  });
});

// ---------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------

describe('routeLayout — determinism', () => {
  it('returns the same composition for the same inputs across many runs', () => {
    const ctx = makeCtx({
      device: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      intent: 'analytics',
      masteryLevel: 'expert',
      affectiveProfile: makeAffective(0.3),
    });
    const opts = makeOpts({ sectionCount: 5 });

    const results = Array.from({ length: 50 }, () => routeLayout(ctx, opts));
    const unique = new Set(results);
    expect(unique.size).toBe(1);
    expect(results[0]).toBe('three-column-grid');
  });

  it('does not mutate its inputs', () => {
    const ctx = makeCtx({
      device: 'mobile',
      viewport: MOBILE_VIEWPORT,
      intent: 'analytics',
      masteryLevel: 'novice',
      affectiveProfile: makeAffective(0.7),
    });
    const opts = makeOpts({ hasComplexInteraction: true });
    const snapshot = JSON.stringify({ ctx, opts });
    routeLayout(ctx, opts);
    expect(JSON.stringify({ ctx, opts })).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------
// Graceful degradation with null / undefined fields
// ---------------------------------------------------------------------

describe('routeLayout — graceful degradation', () => {
  it('handles a context with all nullable fields nulled', () => {
    const ctx: ModalContext = {
      device: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      intent: null,
      masteryLevel: null,
      affectiveProfile: undefined,
    };
    expect(routeLayout(ctx, makeOpts())).toBe('split-pane');
  });

  it('handles a missing affectiveProfile on a novice mobile user (no wizard promotion)', () => {
    const ctx: ModalContext = {
      device: 'mobile',
      viewport: MOBILE_VIEWPORT,
      intent: null,
      masteryLevel: 'novice',
      affectiveProfile: undefined,
    };
    // Cannot promote to wizard without an anxiety signal — falls back.
    expect(routeLayout(ctx, makeOpts())).toBe('compact-stack');
  });

  it('does not throw when an unknown intent string is supplied on desktop', () => {
    const ctx = makeCtx({
      device: 'desktop',
      viewport: DESKTOP_VIEWPORT,
      intent: 'compose-novel-untracked-intent',
    });
    expect(() => routeLayout(ctx, makeOpts())).not.toThrow();
    expect(routeLayout(ctx, makeOpts())).toBe('split-pane');
  });

  it('falls back when the affective state has no anxiety field', () => {
    const ctx = makeCtx({
      device: 'mobile',
      viewport: MOBILE_VIEWPORT,
      masteryLevel: 'novice',
      // anxiety missing — treated as no-signal.
      affectiveProfile: { state: { anxiety: Number.NaN } } as unknown as AffectiveProfile,
    });
    // Either way we should not crash and should not promote to wizard.
    const result = routeLayout(ctx, makeOpts());
    expect(result).not.toBe('wizard-step');
  });
});

// ---------------------------------------------------------------------
// getCompositionTokens
// ---------------------------------------------------------------------

describe('getCompositionTokens', () => {
  it('returns a fresh object every call (callers may safely mutate)', () => {
    const a = getCompositionTokens('split-pane');
    const b = getCompositionTokens('split-pane');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('provides distinct tokens per composition', () => {
    const tokens: Record<LayoutComposition, ReturnType<typeof getCompositionTokens>> = {
      'compact-stack': getCompositionTokens('compact-stack'),
      'split-pane': getCompositionTokens('split-pane'),
      'three-column-grid': getCompositionTokens('three-column-grid'),
      'fullbleed-canvas': getCompositionTokens('fullbleed-canvas'),
      'wizard-step': getCompositionTokens('wizard-step'),
    };
    expect(tokens['compact-stack'].columns).toBe(1);
    expect(tokens['split-pane'].columns).toBe(2);
    expect(tokens['three-column-grid'].columns).toBe(3);
    expect(tokens['fullbleed-canvas'].maxWidth).toBe('max-w-none');
    expect(tokens['wizard-step'].stickyCta).toBe(true);
  });

  it('exposes every composition in ALL_LAYOUT_COMPOSITIONS', () => {
    expect(ALL_LAYOUT_COMPOSITIONS).toContain('compact-stack');
    expect(ALL_LAYOUT_COMPOSITIONS).toContain('split-pane');
    expect(ALL_LAYOUT_COMPOSITIONS).toContain('three-column-grid');
    expect(ALL_LAYOUT_COMPOSITIONS).toContain('fullbleed-canvas');
    expect(ALL_LAYOUT_COMPOSITIONS).toContain('wizard-step');
    expect(ALL_LAYOUT_COMPOSITIONS.length).toBe(5);
  });
});
