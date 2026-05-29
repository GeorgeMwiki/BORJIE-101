/**
 * useAdaptiveLayout hook tests — DU-1 audit fix.
 *
 * The hook is a thin wrapper around the pure `decideLayout` engine so
 * the tests focus on:
 *   - returns a LayoutDecision shape
 *   - memoises stable args (same input → same reference)
 *   - re-runs when args change
 *   - default policies are wired
 *   - custom policy bundle wins over defaults
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAdaptiveLayout } from '../hooks/use-adaptive-layout.js';
import { ABSTAIN } from '../lib/adaptive-layout/types.js';
import type {
  LayoutContext,
  LayoutPolicy,
} from '../lib/adaptive-layout/types.js';

function makeContext(overrides: Partial<LayoutContext> = {}): LayoutContext {
  return {
    tenantId: 't1',
    userId: 'u1',
    route: 'owner.dashboard',
    role: 'owner',
    masteryLevel: 'intermediate',
    behavior: { recentActions: [] },
    intent: null,
    viewport: 'desktop',
    ...overrides,
  };
}

describe('useAdaptiveLayout', () => {
  it('returns a LayoutDecision with the base sections when no policies fire', () => {
    const { result } = renderHook(() =>
      useAdaptiveLayout({
        baseSections: ['a', 'b', 'c'],
        context: makeContext(),
        policies: [],
      }),
    );
    expect(result.current.sections).toEqual(['a', 'b', 'c']);
    expect(result.current.pinned).toEqual([]);
    expect(result.current.hidden).toEqual([]);
    expect(typeof result.current.rationale).toBe('string');
  });

  it('honours the default policies (recency pins recent actions)', () => {
    const { result } = renderHook(() =>
      useAdaptiveLayout({
        baseSections: ['payments', 'maintenance', 'reports'],
        context: makeContext({
          behavior: { recentActions: ['reports', 'maintenance'] },
        }),
      }),
    );
    // recency-policy should pin 'reports' first, then 'maintenance'.
    expect(result.current.sections[0]).toBe('reports');
    expect(result.current.sections[1]).toBe('maintenance');
  });

  it('intent policy beats recency (intent weight=25 > recency=5)', () => {
    const { result } = renderHook(() =>
      useAdaptiveLayout({
        baseSections: ['payments', 'maintenance', 'reports'],
        context: makeContext({
          behavior: { recentActions: ['reports'] },
          intent: 'payment',
        }),
      }),
    );
    expect(result.current.sections[0]).toBe('payments');
  });

  it('memoises stable args — same input returns identical reference', () => {
    const base = Object.freeze(['a', 'b', 'c']);
    const ctx = makeContext();
    const policies = Object.freeze([]) as ReadonlyArray<LayoutPolicy>;
    const { result, rerender } = renderHook(
      ({ ctx, base, policies }) =>
        useAdaptiveLayout({ baseSections: base, context: ctx, policies }),
      { initialProps: { ctx, base, policies } },
    );
    const first = result.current;
    rerender({ ctx, base, policies });
    expect(result.current).toBe(first);
  });

  it('re-runs when context changes', () => {
    const base = Object.freeze(['a', 'b', 'c']);
    const { result, rerender } = renderHook(
      ({ ctx }) =>
        useAdaptiveLayout({ baseSections: base, context: ctx, policies: [] }),
      { initialProps: { ctx: makeContext({ route: 'r1' }) } },
    );
    const first = result.current;
    rerender({ ctx: makeContext({ route: 'r2' }) });
    expect(result.current).not.toBe(first);
  });

  it('honours a custom policy bundle over defaults', () => {
    const alwaysHideB: LayoutPolicy = {
      id: 'hide-b',
      decide: () => ({ ...ABSTAIN, hide: ['b'], weight: 50, reason: 'test' }),
    };
    const { result } = renderHook(() =>
      useAdaptiveLayout({
        baseSections: ['a', 'b', 'c'],
        context: makeContext(),
        policies: [alwaysHideB],
      }),
    );
    expect(result.current.sections).toEqual(['a', 'c']);
    expect(result.current.hidden).toContain('b');
  });
});
