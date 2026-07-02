import * as React from 'react';

/**
 * useReducedMotion
 * ----------------
 * Live subscription to the OS-level `prefers-reduced-motion: reduce` setting.
 *
 * Contract:
 *   - SSR-safe: returns `false` (motion allowed) when `window`/`matchMedia`
 *     is unavailable, so the server render and the first client paint agree
 *     (no hydration flip on the animation state).
 *   - Live: re-renders the consumer when the user changes the preference at
 *     the OS level mid-session, via a `change` listener (with legacy
 *     `addListener` fallback for older Safari).
 *
 * Every motion primitive in the design system MUST consult this hook and
 * collapse to an instant, no-animation path when it returns `true`. The
 * global CSS reduced-motion guard is the backstop; this hook lets JS-driven
 * choreography (IntersectionObserver reveals, staggered groups) opt out
 * *before* it ever schedules a transition.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/** Read the current preference once, guarding SSR / unsupported environments. */
function readPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  // Lazy initialiser keeps SSR at `false` and hydrates the real value on the
  // client's first render synchronously (no post-mount flash).
  const [reduced, setReduced] = React.useState<boolean>(readPreference);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(QUERY);

    // Reconcile in case the preference changed between the initial render and
    // effect commit.
    setReduced(mql.matches);

    const onChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };

    // Modern browsers expose addEventListener; older Safari only addListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    // Legacy fallback.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduced;
}

export default useReducedMotion;
