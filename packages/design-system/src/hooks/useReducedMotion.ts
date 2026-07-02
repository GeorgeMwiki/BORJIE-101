import * as React from 'react';

/**
 * useReducedMotion
 * ----------------
 * Live subscription to the OS-level `prefers-reduced-motion: reduce` setting.
 *
 * Contract:
 *   - SSR-safe: the FIRST client render always returns `false` (motion
 *     allowed) — the same value the server rendered — so hydration matches
 *     byte-for-byte even under `prefers-reduced-motion: reduce`. Reading
 *     `matchMedia` in the initializer would make the first client render
 *     disagree with the server (which has no `matchMedia`), producing a
 *     className hydration mismatch on any motion-gated element. The real
 *     preference is applied in a post-mount effect instead.
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

export function useReducedMotion(): boolean {
  // SSR-safe seed: the first client render MUST match the server, which has no
  // `matchMedia`. Seeding to the real preference here would flip the className
  // on the first client render under `prefers-reduced-motion: reduce` and throw
  // a hydration mismatch. We start at `false` and apply the real preference in
  // the post-mount effect below (one extra commit, zero hydration mismatch).
  const [reduced, setReduced] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(QUERY);

    // Apply the real preference now that we are past hydration (and reconcile
    // in case it changed between the initial render and this effect commit).
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
