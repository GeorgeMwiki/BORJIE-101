'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Traps Tab focus inside `containerRef` while `active`, locks body
 * scroll, moves focus to the first focusable element on open, and
 * restores focus to whatever was focused before the trap engaged on
 * close. This is the accessibility contract a flagship mobile drawer
 * must meet (keyboard + screen-reader users can never escape into the
 * inert page behind the sheet).
 *
 * Escape handling lives with the caller so it can also drive its own
 * close animation; this hook only owns focus + scroll-lock + Tab-wrap.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  containerRef: RefObject<HTMLElement>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );

    // Move focus into the trap on the next frame so the panel has
    // mounted + animated-in before we steal focus.
    const raf = requestAnimationFrame(() => {
      focusables()[0]?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef]);
}
