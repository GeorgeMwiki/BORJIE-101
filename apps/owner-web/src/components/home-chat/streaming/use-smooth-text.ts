'use client';

/**
 * use-smooth-text — an adaptive typewriter that decouples *render cadence*
 * from *network cadence*.
 *
 * The rAF buffer (use-raf-flush) already smooths bursty socket writes into
 * steady commits, but the underlying token arrival is still uneven — a long
 * provider stall followed by a 400-char flood reads as a freeze-then-dump.
 * This hook holds the full accumulated `text` and reveals it through a
 * `visibleText` cursor that advances at an adaptive baseline of ~60 chars/sec,
 * auto-tuning UP when the source is racing ahead so the visible cursor never
 * falls hopelessly behind (and the answer still finishes promptly), and
 * settling to the baseline on a calm stream.
 *
 * Lifecycle:
 *   - status='streaming' → animate the cursor toward `text`.
 *   - status='complete' / 'stopped' / 'idle' → snap `visibleText` to the full
 *     `text` instantly. History / scrollback NEVER animates (a re-mounted past
 *     turn renders whole on first paint).
 *   - reduced-motion → snap instantly, always (honoured here AND in the CSS).
 *
 * Pure timing: this hook owns no DOM and mutates no caller state; it returns
 * a derived `visibleText` slice of the immutable `text` input.
 */

import { useEffect, useRef, useState } from 'react';

export type SmoothStatus = 'idle' | 'streaming' | 'complete' | 'stopped';

const BASE_CHARS_PER_SEC = 60;
/** Cap the catch-up multiplier so a flood never machine-guns the whole answer. */
const MAX_CATCHUP_MULTIPLIER = 8;
/** When the backlog exceeds this, scale speed toward draining it in ~1s. */
const COMFORTABLE_BACKLOG = 40;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface UseSmoothTextResult {
  /** The portion of `text` revealed so far (grapheme-safe by code unit). */
  readonly visibleText: string;
  /** True while the cursor has not yet caught up to the full `text`. */
  readonly isCatchingUp: boolean;
}

/**
 * @param text    The full accumulated assistant text so far.
 * @param status  Drives whether to animate (`streaming`) or snap (everything
 *                else). Pass the message's live stream state.
 */
export function useSmoothText(
  text: string,
  status: SmoothStatus,
): UseSmoothTextResult {
  const [visibleLength, setVisibleLength] = useState(
    status === 'streaming' ? 0 : text.length,
  );
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  // Track the source growth rate to auto-tune the reveal speed.
  const prevTextLenRef = useRef(text.length);
  const prevSampleAtRef = useRef<number | null>(null);
  const incomingRateRef = useRef(BASE_CHARS_PER_SEC);

  // When NOT streaming (history, complete, stopped, reduced-motion) snap the
  // cursor to the end so past turns and finished answers render whole.
  const reduced = prefersReducedMotion();
  const shouldAnimate = status === 'streaming' && !reduced;

  // Sample the incoming rate whenever `text` grows so the catch-up speed can
  // adapt to a racing provider.
  useEffect(() => {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const grew = text.length - prevTextLenRef.current;
    const dtPrev = prevSampleAtRef.current;
    if (grew > 0 && dtPrev !== null) {
      const seconds = Math.max(0.016, (now - dtPrev) / 1000);
      const instantaneous = grew / seconds;
      // Exponential moving average so a single burst doesn't whipsaw speed.
      incomingRateRef.current =
        incomingRateRef.current * 0.7 + instantaneous * 0.3;
    }
    prevTextLenRef.current = text.length;
    prevSampleAtRef.current = now;
  }, [text]);

  useEffect(() => {
    if (!shouldAnimate) {
      // Snap and stop any running loop.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
      setVisibleLength(text.length);
      return;
    }

    if (typeof requestAnimationFrame !== 'function') {
      setVisibleLength(text.length);
      return;
    }

    const tick = (ts: number): void => {
      const last = lastTickRef.current ?? ts;
      const elapsed = Math.max(0, ts - last);
      lastTickRef.current = ts;

      setVisibleLength((current) => {
        if (current >= text.length) return current;
        const backlog = text.length - current;
        // Adaptive speed: baseline, scaled up by how far behind we are and how
        // fast the source is feeding, clamped so it never reads as a dump.
        const ratePressure = Math.max(
          1,
          incomingRateRef.current / BASE_CHARS_PER_SEC,
        );
        const backlogPressure = Math.max(1, backlog / COMFORTABLE_BACKLOG);
        const multiplier = Math.min(
          MAX_CATCHUP_MULTIPLIER,
          Math.max(ratePressure, backlogPressure),
        );
        const charsPerMs = (BASE_CHARS_PER_SEC * multiplier) / 1000;
        const advance = Math.max(1, Math.round(charsPerMs * elapsed));
        return Math.min(text.length, current + advance);
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
    };
  }, [shouldAnimate, text]);

  const clampedLength = Math.min(visibleLength, text.length);
  const effectiveLength = shouldAnimate ? clampedLength : text.length;

  return {
    visibleText: text.slice(0, effectiveLength),
    isCatchingUp: shouldAnimate && effectiveLength < text.length,
  };
}
