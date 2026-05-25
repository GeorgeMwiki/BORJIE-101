/**
 * `useSwipeNav()` — horizontal swipe-to-navigate-tab hook.
 *
 * Why no library: react-swipeable etc. would add 5–15kb min+gzip
 * per portal for behaviour we can express in ~30 lines using the
 * native PointerEvent API. Mobile-first + tree-shakeable = win.
 *
 * Behaviour:
 *   - Listens on a target element's pointerdown/up.
 *   - A horizontal travel >= `thresholdPx` (default 48px) AND that
 *     dominates the vertical travel by ≥2× counts as a swipe.
 *   - Vertical scrolls + diagonal drags are explicitly ignored.
 *   - Right-swipe → previous tab. Left-swipe → next tab.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSwipeNavArgs {
  readonly enabled: boolean;
  readonly onSwipeLeft: () => void;
  readonly onSwipeRight: () => void;
  readonly thresholdPx?: number;
}

export interface UseSwipeNavResult {
  /** Ref-callback to attach to the swipeable element. */
  readonly attach: (el: HTMLElement | null) => void;
}

const DEFAULT_THRESHOLD_PX = 48;
const HORIZONTAL_DOMINANCE_RATIO = 2;

export function useSwipeNav(args: UseSwipeNavArgs): UseSwipeNavResult {
  const { enabled, onSwipeLeft, onSwipeRight } = args;
  const threshold = args.thresholdPx ?? DEFAULT_THRESHOLD_PX;
  // Use STATE for the target — a callback-ref that sets state ensures
  // the effect re-runs when `attach(el)` is called. A plain ref would
  // never trigger React to re-render, so the effect would see null
  // on first mount and never bind.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const handlers = useRef({ onSwipeLeft, onSwipeRight });

  useEffect(() => {
    handlers.current = { onSwipeLeft, onSwipeRight };
  }, [onSwipeLeft, onSwipeRight]);

  useEffect(() => {
    if (!enabled || !target) return;

    // Capture the pointerId so we can release exactly the pointer we
    // captured on pointerdown — necessary because the up/cancel events
    // can arrive with a different id under multitouch.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startRef.current = { x: e.clientX, y: e.clientY };
      // setPointerCapture is best-effort. Some browsers throw
      // InvalidStateError if a capture is already active — we
      // silence it because the gesture still resolves without it.
      if (typeof target.setPointerCapture === 'function') {
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          // capture is a nice-to-have; the gesture still resolves
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      const start = startRef.current;
      startRef.current = null;
      // Release capture ONLY when the target is still attached to the
      // document — calling releasePointerCapture on a detached node
      // throws InvalidStateError in some browsers. Mirrors the 2026-
      // 05-21 audit fix.
      if (
        target.isConnected &&
        typeof target.releasePointerCapture === 'function'
      ) {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          // best-effort
        }
      }
      if (!start) return;
      // Short-circuit when the target detached mid-gesture — there is
      // no panel left to navigate.
      if (!target.isConnected) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO) return;
      if (dx < 0) handlers.current.onSwipeLeft();
      else handlers.current.onSwipeRight();
    };
    const onCancel = (e: PointerEvent) => {
      startRef.current = null;
      if (
        target.isConnected &&
        typeof target.releasePointerCapture === 'function'
      ) {
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          // best-effort
        }
      }
    };

    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    return () => {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
  }, [enabled, threshold, target]);

  const attach = useCallback((el: HTMLElement | null) => {
    setTarget(el);
  }, []);

  return { attach };
}
