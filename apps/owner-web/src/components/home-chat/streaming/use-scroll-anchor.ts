'use client';

/**
 * use-scroll-anchor — the "stick to the bottom unless the owner scrolled up"
 * contract for a streaming transcript.
 *
 * The old effect keyed on `[messages.length, isStreaming]` never fired DURING
 * a stream, so a tall answer scrolled its own tail off-screen (the "flow
 * breaks midway" report). This hook instead watches the scroll container's
 * content for growth (ResizeObserver + MutationObserver) and re-anchors to the
 * bottom on every growth tick — but ONLY when the owner is already near the
 * bottom (gap ≤ threshold). The instant the owner scrolls up past the
 * threshold, auto-follow disengages and `showJumpPill` flips true so a
 * floating "Jump to latest" control can appear.
 *
 * `resetAtStreamStart()` re-engages auto-follow at the top of each new turn so
 * a prior scroll-up doesn't strand the owner away from the new answer.
 *
 * scroll-behavior is forced to `auto` (not smooth) during follow so rapid
 * growth ticks don't queue a backlog of smooth animations that lag the tail.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

const NEAR_BOTTOM_PX = 60;

export interface ScrollAnchor {
  /** Attach to the scrollable transcript container. */
  readonly scrollRef: MutableRefObject<HTMLDivElement | null>;
  /** True when the owner scrolled up and the latest content is below the fold. */
  readonly showJumpPill: boolean;
  /** Scroll to the bottom and re-engage auto-follow (the pill's click). */
  readonly jumpToLatest: () => void;
  /** Re-engage auto-follow at the start of a new stream. */
  readonly resetAtStreamStart: () => void;
}

function gapFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function useScrollAnchor(): ScrollAnchor {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const [showJumpPill, setShowJumpPill] = useState(false);

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const jumpToLatest = useCallback((): void => {
    followRef.current = true;
    setShowJumpPill(false);
    scrollToBottom();
  }, [scrollToBottom]);

  const resetAtStreamStart = useCallback((): void => {
    followRef.current = true;
    setShowJumpPill(false);
    // Defer to next frame so newly-appended nodes are measured.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(scrollToBottom);
    } else {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  // Track manual scroll: disengage follow when the owner scrolls up past the
  // threshold; re-engage (and hide the pill) when they return to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const gap = gapFromBottom(el);
      if (gap > NEAR_BOTTOM_PX) {
        followRef.current = false;
        setShowJumpPill(true);
      } else {
        followRef.current = true;
        setShowJumpPill(false);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Re-anchor on content growth (streaming tokens, new blocks) — but only when
  // the owner is currently following the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const maybeFollow = (): void => {
      if (!followRef.current) return;
      // Re-check the gap so we only auto-follow while the reader is genuinely
      // near the bottom. The `|| followRef.current` that used to be here made
      // this check inert (we already early-returned unless following), so a
      // reader who nudged up past the threshold got yanked back on every
      // streaming growth tick — matches the shared use-chat-scroll hook now.
      if (gapFromBottom(el) <= NEAR_BOTTOM_PX) {
        scrollToBottom();
      }
    };

    const ResizeObs =
      typeof ResizeObserver !== 'undefined' ? ResizeObserver : null;
    const MutationObs =
      typeof MutationObserver !== 'undefined' ? MutationObserver : null;

    const ro = ResizeObs ? new ResizeObs(maybeFollow) : null;
    const mo = MutationObs ? new MutationObs(maybeFollow) : null;
    if (ro) ro.observe(el);
    if (mo) mo.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
    };
  }, [scrollToBottom]);

  return { scrollRef, showJumpPill, jumpToLatest, resetAtStreamStart };
}
