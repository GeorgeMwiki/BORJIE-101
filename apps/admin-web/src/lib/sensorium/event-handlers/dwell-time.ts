/**
 * `dwell.time` handler — Central Command Phase A.
 *
 * Fires on route change / unload when total dwell on a route ≥ 2s.
 * Distinct from `page.leave` because the brain values "how long did
 * they actually focus on it" separately from "they navigated away".
 */

import { lastViewState } from './page-view.js';
import type { HandlerInstall } from './types.js';

const MIN_DWELL_MS = 2000;

export const installDwellTimeHandler: HandlerInstall = (emit, ctx) => {
  let lastRoute = ctx.route();

  function fire(routeBeingLeft: string): void {
    if (!routeBeingLeft) return;
    const now = Date.now();
    const enteredAt = lastViewState.enteredAt || now;
    const dwellMs = now - enteredAt;
    if (dwellMs < MIN_DWELL_MS) return;
    emit({
      eventType: 'dwell.time',
      route: routeBeingLeft,
      emittedAt: new Date(now).toISOString(),
      payload: { route: routeBeingLeft, dwellMs },
    });
  }

  if (typeof window === 'undefined') return () => undefined;
  const poll = setInterval(() => {
    const current = ctx.route();
    if (current !== lastRoute) {
      fire(lastRoute);
      lastRoute = current;
    }
  }, 1000);

  const onBeforeUnload = () => fire(ctx.route());
  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    clearInterval(poll);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
};
