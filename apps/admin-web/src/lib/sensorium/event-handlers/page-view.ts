/**
 * `page.view` handler — Central Command Phase A.
 *
 * Emits once on first install + on every route change. The browser
 * doesn't expose a true "route changed" event for SPAs, so we monkey-
 * patch `history.pushState/replaceState` + listen for `popstate`. This
 * is the same trick PostHog / GA4 use.
 *
 * The complementary `page.leave` handler reads the session-start
 * timestamp from a module-local `lastViewAt` ref so it can compute
 * dwellMs on the way out.
 */

import type { HandlerInstall } from './types.js';

/**
 * Module-scoped — the page-leave handler reads this on `beforeunload`
 * and on subsequent `page.view` emissions to compute dwellMs.
 */
export const lastViewState: {
  route: string;
  enteredAt: number;
} = {
  route: '',
  enteredAt: 0,
};

export const installPageViewHandler: HandlerInstall = (emit, ctx) => {
  let lastRoute = '';

  function fire(): void {
    const route = ctx.route();
    if (route === lastRoute) return;
    const now = Date.now();
    const referrer = lastRoute;
    lastRoute = route;
    lastViewState.route = route;
    lastViewState.enteredAt = now;
    emit({
      eventType: 'page.view',
      route,
      emittedAt: new Date(now).toISOString(),
      payload: {
        route,
        referrer,
        sessionMs: 0,
      },
    });
  }

  // Initial fire.
  fire();

  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;

  const wrappedPushState: typeof window.history.pushState = function (
    this: History,
    ...args
  ) {
    const r = originalPushState.apply(this, args);
    queueMicrotask(fire);
    return r;
  };
  const wrappedReplaceState: typeof window.history.replaceState = function (
    this: History,
    ...args
  ) {
    const r = originalReplaceState.apply(this, args);
    queueMicrotask(fire);
    return r;
  };
  window.history.pushState = wrappedPushState;
  window.history.replaceState = wrappedReplaceState;

  const onPop = () => queueMicrotask(fire);
  window.addEventListener('popstate', onPop);

  return () => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', onPop);
  };
};
