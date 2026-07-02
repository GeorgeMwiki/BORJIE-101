/**
 * useChoreography — zero-time reveal regression (HIDDEN-FOREVER #1).
 *
 * A single-artifact staggered choreography has `totalChoreographyMs === 0`
 * (its only cue is `atMs: 0`). The hook's non-reduced branch used to bail on
 * `if (total <= 0) return;` before scheduling any rAF frame, leaving
 * `revealed` empty FOREVER — the artifact was invisible to default
 * (non-reduced-motion) users while reduced-motion users (who take the
 * instant path) DID see it. This inverted the a11y contract.
 *
 * These tests pin the fix: a zero-time choreography reveals its atMs<=0
 * cues immediately in BOTH motion modes.
 *
 * @module genui/streaming/__tests__/use-choreography
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChoreography, staggeredReveal } from '../use-choreography';

describe('useChoreography — zero-time single-artifact reveal', () => {
  it('reveals the artifact for DEFAULT (reduced=false) users (was false forever)', () => {
    const targetId = 'artifact-1';
    const choreo = staggeredReveal([targetId]); // single cue at atMs:0 → total 0

    const { result } = renderHook(() =>
      useChoreography(choreo, { reduced: false }),
    );

    // Before the fix the rAF loop never ran → this stayed false forever.
    expect(result.current.isRevealed(targetId)).toBe(true);
    expect(result.current.revealed.has(targetId)).toBe(true);
    expect(result.current.finished).toBe(true);
  });

  it('reveals the artifact for reduced-motion (reduced=true) users too', () => {
    const targetId = 'artifact-1';
    const choreo = staggeredReveal([targetId]);

    const { result } = renderHook(() =>
      useChoreography(choreo, { reduced: true }),
    );

    expect(result.current.isRevealed(targetId)).toBe(true);
    expect(result.current.revealed.has(targetId)).toBe(true);
    expect(result.current.finished).toBe(true);
  });

  it('a null choreography is empty + finished in both modes', () => {
    for (const reduced of [false, true]) {
      const { result } = renderHook(() => useChoreography(null, { reduced }));
      expect(result.current.revealed.size).toBe(0);
      expect(result.current.finished).toBe(true);
      expect(result.current.isRevealed('anything')).toBe(false);
    }
  });
});
