/**
 * `scroll.depth` handler — Central Command Phase A.
 *
 * Emits at the 25 / 50 / 75 / 100% milestones ONLY — never continuous.
 * Resets the fired-milestone set when the route changes (otherwise
 * the second page would never fire any milestone).
 */

import type { HandlerInstall } from './types.js';

const MILESTONES = [25, 50, 75, 100] as const;

export const installScrollDepthHandler: HandlerInstall = (emit, ctx) => {
  let firedForRoute = '';
  const fired = new Set<number>();

  function currentDepth(): number {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 0;
    }
    const scrollTop =
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body?.scrollTop ||
      0;
    const docHeight =
      Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      ) - window.innerHeight;
    if (docHeight <= 0) return 0;
    return Math.min(100, Math.max(0, (scrollTop / docHeight) * 100));
  }

  function onScroll(): void {
    const route = ctx.route();
    if (route !== firedForRoute) {
      fired.clear();
      firedForRoute = route;
    }
    const depth = currentDepth();
    for (const milestone of MILESTONES) {
      if (!fired.has(milestone) && depth >= milestone) {
        fired.add(milestone);
        emit({
          eventType: 'scroll.depth',
          route,
          emittedAt: new Date().toISOString(),
          payload: { route, percent: milestone },
        });
      }
    }
  }

  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => window.removeEventListener('scroll', onScroll);
};
