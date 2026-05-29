/**
 * useAdaptiveTabOrder tests — DU-5 audit fix.
 *
 * Covers:
 *   - pinned tabs always come first, in original order
 *   - non-pinned tabs are re-ranked by recency
 *   - intent overrides recency (intent weight=25 > recency=5)
 *   - empty recent + null intent yields unchanged free order
 *   - rationale string surfaces engine decision
 *   - hook is memoised on stable inputs
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAdaptiveTabOrder } from '../useAdaptiveTabOrder';
import type { OwnerTab } from '@/lib/owner-tabs-store';

function makeTab(id: string, opts: Partial<OwnerTab> = {}): OwnerTab {
  return {
    id,
    kind: 'finance',
    title: id,
    ...opts,
  };
}

describe('useAdaptiveTabOrder', () => {
  it('keeps pinned tabs first in original order even when recency would re-rank', () => {
    const tabs: OwnerTab[] = [
      makeTab('chat', { pinned: true, kind: 'chat' }),
      makeTab('docs', { pinned: true, kind: 'docs' }),
      makeTab('finance', { kind: 'finance' }),
      makeTab('hr', { kind: 'hr' }),
    ];
    const { result } = renderHook(() =>
      useAdaptiveTabOrder({
        tabs,
        tenantId: 't1',
        userId: 'u1',
        role: 'owner',
        recentActions: ['hr', 'finance'],
      }),
    );
    expect(result.current.tabs[0]?.id).toBe('chat');
    expect(result.current.tabs[1]?.id).toBe('docs');
    // After pinned, 'hr' came before 'finance' in recentActions, so it wins.
    expect(result.current.tabs[2]?.id).toBe('hr');
    expect(result.current.tabs[3]?.id).toBe('finance');
  });

  it('intent overrides recency (intent weight beats recency weight)', () => {
    const tabs: OwnerTab[] = [
      makeTab('payments', { kind: 'finance' }),
      makeTab('maintenance', { kind: 'ops' }),
      makeTab('reports', { kind: 'reports' }),
    ];
    const { result } = renderHook(() =>
      useAdaptiveTabOrder({
        tabs,
        tenantId: 't1',
        userId: 'u1',
        role: 'owner',
        recentActions: ['reports'],
        intent: 'payment',
      }),
    );
    // intent='payment' pins tabs whose id contains 'payment'.
    expect(result.current.tabs[0]?.id).toBe('payments');
  });

  it('leaves free order untouched when nothing fires', () => {
    const tabs: OwnerTab[] = [
      makeTab('finance', { kind: 'finance' }),
      makeTab('hr', { kind: 'hr' }),
      makeTab('ops', { kind: 'ops' }),
    ];
    const { result } = renderHook(() =>
      useAdaptiveTabOrder({
        tabs,
        tenantId: 't1',
        userId: 'u1',
        role: 'owner',
        recentActions: [],
        intent: null,
      }),
    );
    expect(result.current.tabs.map((t) => t.id)).toEqual([
      'finance',
      'hr',
      'ops',
    ]);
  });

  it('surfaces a non-empty rationale string', () => {
    const { result } = renderHook(() =>
      useAdaptiveTabOrder({
        tabs: [makeTab('a'), makeTab('b')],
        tenantId: 't1',
        userId: 'u1',
        role: 'owner',
        recentActions: ['b'],
      }),
    );
    expect(typeof result.current.rationale).toBe('string');
    expect(result.current.rationale.length).toBeGreaterThan(0);
  });

  it('returns the same reference when inputs are stable', () => {
    const tabs: ReadonlyArray<OwnerTab> = Object.freeze([
      makeTab('a'),
      makeTab('b'),
    ]) as ReadonlyArray<OwnerTab>;
    const recent = Object.freeze(['b']) as ReadonlyArray<string>;
    const { result, rerender } = renderHook(
      ({ tabs, recent }) =>
        useAdaptiveTabOrder({
          tabs,
          tenantId: 't1',
          userId: 'u1',
          role: 'owner',
          recentActions: recent,
        }),
      { initialProps: { tabs, recent } },
    );
    const first = result.current;
    rerender({ tabs, recent });
    expect(result.current).toBe(first);
  });
});
