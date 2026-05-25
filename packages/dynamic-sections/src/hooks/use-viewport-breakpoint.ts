/**
 * `useViewportBreakpoint()` — minimal SSR-safe breakpoint detector.
 *
 * Mobile-first decision: we drive the DynamicTabBar's hamburger
 * collapse off Tailwind's `md` breakpoint (768px) — same threshold
 * the rest of BORJIE's design-system already uses.
 *
 * Implementation choices:
 *   - `matchMedia` (not `innerWidth` listeners) — cheaper, native,
 *     and survives orientation-change events.
 *   - Default to `'desktop'` during SSR so first paint matches the
 *     pessimistic-but-most-useful layout for accessibility/SEO.
 *   - Returns a discriminated union, not booleans, so consumers
 *     can switch exhaustively.
 */

import { useEffect, useState } from 'react';

export type ViewportBreakpoint = 'mobile' | 'desktop';

const MOBILE_QUERY = '(max-width: 767px)';

export function useViewportBreakpoint(): ViewportBreakpoint {
  const [bp, setBp] = useState<ViewportBreakpoint>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'desktop';
    }
    return window.matchMedia(MOBILE_QUERY).matches ? 'mobile' : 'desktop';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      setBp(e.matches ? 'mobile' : 'desktop');
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return bp;
}
