/**
 * Intersection-observer-driven lazy loader — the framework-agnostic
 * primitive that `useIntersectionLazy` (React hook) is built on top
 * of in app code.
 *
 * Pattern: register a callback that triggers the loader the first
 * time the observed element enters the viewport (with `rootMargin`
 * lead-in so we have time to fetch). Below-the-fold charts, comments,
 * heavy ads — anything that does not affect LCP and the user may
 * never scroll to.
 *
 *   const observer = createIntersectionLazy({
 *     loader: () => import('./HeavyChart'),
 *     rootMargin: '200px',
 *   });
 *   observer.observe(chartContainerRef.current);
 */

import type { IntersectionLazyState } from '../types.js';

export interface IntersectionLazyOptions<T> {
  readonly loader: () => Promise<T>;
  /**
   * `rootMargin` for the underlying IntersectionObserver. Default
   * `'200px'` — start the import 200px before the element scrolls
   * into view so the user sees content immediately on scroll.
   */
  readonly rootMargin?: string;
  /**
   * Threshold — `0` (default) fires as soon as 1px is visible. `0.5`
   * waits until half the element is on screen.
   */
  readonly threshold?: number;
  /** Notified each time state changes. */
  readonly onStateChange?: (state: IntersectionLazyState<T>) => void;
}

export interface IntersectionLazyController<T> {
  observe(element: Element): void;
  unobserve(element: Element): void;
  disconnect(): void;
  getState(): IntersectionLazyState<T>;
}

/**
 * Build a controller that wraps an IntersectionObserver. Safe on the
 * server — when `IntersectionObserver` is not available we mark the
 * element as loaded immediately (SSR / Node fallback).
 */
export function createIntersectionLazy<T>(
  opts: IntersectionLazyOptions<T>,
): IntersectionLazyController<T> {
  const rootMargin = opts.rootMargin ?? '200px';
  const threshold = opts.threshold ?? 0;

  let state: IntersectionLazyState<T> = {
    loaded: false,
    data: null,
    error: null,
  };
  const emit = (): void => {
    opts.onStateChange?.(state);
  };

  const load = async (): Promise<void> => {
    if (state.loaded || state.error !== null) return;
    try {
      const data = await opts.loader();
      state = { loaded: true, data, error: null };
    } catch (err) {
      state = {
        loaded: false,
        data: null,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
    emit();
  };

  // SSR / non-DOM environment: degrade to immediate load. The caller's
  // ErrorBoundary catches failures.
  if (typeof IntersectionObserver === 'undefined') {
    void load();
    return {
      observe: () => {},
      unobserve: () => {},
      disconnect: () => {},
      getState: () => state,
    };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible) {
        void load();
        observer.disconnect();
      }
    },
    { rootMargin, threshold },
  );

  return {
    observe: (el) => observer.observe(el),
    unobserve: (el) => observer.unobserve(el),
    disconnect: () => observer.disconnect(),
    getState: () => state,
  };
}
