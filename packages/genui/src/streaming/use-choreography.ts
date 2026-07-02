'use client';

/**
 * useChoreography (LP-24b consumer).
 *
 * React adapter that drives the PURE `choreography-engine` state machine
 * over `requestAnimationFrame`, turning a `BlackboardChoreography` into a
 * live `revealed` set a renderer can gate staged entrance on.
 *
 * This is the FIRST real caller of `initChoreographyState` /
 * `tickChoreography` — the engine shipped in LP-24b but had no consumer
 * outside its own test, so the timed-reveal capability was dark. This
 * hook mounts it in the owner cockpit chat (staged artifact reveal).
 *
 * A11y is FIRST-CLASS, not an afterthought: the caller passes `reduced`
 * (resolved from the design-system `useReducedMotion` hook). Under
 * reduced motion the hook returns ALL target ids as revealed on the very
 * first render and NEVER schedules a frame — the reveal is instant, no
 * animation, exactly as the reduced-motion contract requires. The genui
 * package stays framework-light: it depends on React only, never on the
 * design system, so `reduced` is injected rather than imported.
 *
 * Framework boundary: the engine stays pure (no timers, no DOM); this
 * hook owns the clock and React state. Server render is safe — with no
 * `window`/`requestAnimationFrame` it degrades to the reduced path.
 *
 * @module genui/streaming/use-choreography
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  initChoreographyState,
  tickChoreography,
  type ChoreographyState,
} from './choreography-engine';
import {
  totalChoreographyMs,
  type BlackboardChoreography,
  type RevealCue,
} from './choreography';

export interface UseChoreographyResult {
  /** Ids revealed so far. Under reduced motion this is the full set on frame 0. */
  readonly revealed: ReadonlySet<string>;
  /** Whether the choreography has played to completion. */
  readonly finished: boolean;
  /** Convenience: has this target id been revealed yet? */
  readonly isRevealed: (targetId: string) => boolean;
}

export interface UseChoreographyOptions {
  /**
   * When true (user prefers reduced motion, or no rAF/window), reveal
   * everything immediately and schedule no frames.
   */
  readonly reduced: boolean;
}

/** Collect every distinct target id a choreography will ever reveal. */
function allTargetIds(choreo: BlackboardChoreography): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const r of choreo.reveals ?? []) ids.add(r.targetId);
  for (const resp of choreo.responses ?? []) {
    for (const r of resp.reveal ?? []) ids.add(r.targetId);
  }
  return ids;
}

function hasRaf(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  );
}

/**
 * Drive a choreography to produce a live `revealed` set.
 *
 * Passing `null` (no choreography yet) yields an empty, finished result.
 */
export function useChoreography(
  choreo: BlackboardChoreography | null,
  options: UseChoreographyOptions,
): UseChoreographyResult {
  const reduced = options.reduced;

  // Freeze the full id set + total once per choreography identity so the
  // reduced path is a stable, allocation-free snapshot.
  const targetIds = useMemo(
    () => (choreo ? allTargetIds(choreo) : new Set<string>()),
    [choreo],
  );

  const [state, setState] = useState<ChoreographyState>(() =>
    choreo ? initChoreographyState(choreo) : EMPTY_STATE,
  );

  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset when the choreography identity changes.
    setState(choreo ? initChoreographyState(choreo) : EMPTY_STATE);
    startRef.current = null;

    if (!choreo) return;

    // Reduced motion / no rAF → the render path below reveals everything
    // instantly; schedule nothing.
    if (reduced || !hasRaf()) return;

    const total = totalChoreographyMs(choreo);
    if (total <= 0) {
      // Nothing is timed to animate (e.g. a single-artifact staggered
      // reveal where every cue is atMs<=0). The rAF loop below would never
      // run, leaving `revealed` empty FOREVER — the artifact would be
      // invisible to default (non-reduced-motion) users while reduced-motion
      // users saw it. Reveal every atMs<=0 cue synchronously so a zero-time
      // choreography shows immediately, matching the instant reduced path.
      setState((prev) => tickChoreography(prev, choreo, 0).state);
      return;
    }

    let cancelled = false;

    const frame = (now: number) => {
      if (cancelled) return;
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      setState((prev) => tickChoreography(prev, choreo, elapsed).state);
      if (elapsed < total) {
        rafRef.current = window.requestAnimationFrame(frame);
      }
    };

    rafRef.current = window.requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [choreo, reduced]);

  // Under reduced motion the revealed set IS the full target set (instant).
  const revealed = reduced ? targetIds : state.revealed;
  const finished = reduced ? true : state.finished;

  return {
    revealed,
    finished,
    isRevealed: (targetId: string) => revealed.has(targetId),
  };
}

const EMPTY_STATE: ChoreographyState = {
  elapsedMs: 0,
  revealed: new Set<string>(),
  spokenIndexes: new Set<number>(),
  shapes: [],
  finished: true,
};

/**
 * Build a simple staggered choreography that reveals `ids` in order, one
 * every `stepMs` milliseconds. Pure helper so a chat surface can turn a
 * list of artifact ids into a timed reveal without hand-writing cues.
 */
export function staggeredReveal(
  ids: ReadonlyArray<string>,
  stepMs = 90,
): BlackboardChoreography {
  const reveals: RevealCue[] = ids.map((targetId, i) => ({
    targetId,
    atMs: i * stepMs,
  }));
  return { reveals };
}
