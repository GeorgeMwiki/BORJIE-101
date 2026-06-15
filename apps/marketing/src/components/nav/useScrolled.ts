'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks whether the window has scrolled past a small threshold so the
 * nav can grow a hairline border + subtle shadow on scroll (the
 * Stripe / Linear pattern) instead of being a static slab.
 *
 * Uses a passive listener and runs once on mount so a deep-linked /
 * refreshed page that loads already-scrolled renders the correct state.
 */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrolled;
}
