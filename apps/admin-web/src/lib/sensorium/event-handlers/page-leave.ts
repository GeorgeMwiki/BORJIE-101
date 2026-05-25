/**
 * `page.leave` handler — Central Command Phase A.
 *
 * Fires on `beforeunload` AND on every route change (since SPAs don't
 * unload between routes). DwellMs is computed against
 * `lastViewState.enteredAt` from page-view.ts.
 */

import { lastViewState } from './page-view.js';
import type { HandlerInstall } from './types.js';

export const installPageLeaveHandler: HandlerInstall = (emit, ctx) => {
  let lastRoute = ctx.route();

  function fire(routeBeingLeft: string): void {
    if (!routeBeingLeft) return;
    const now = Date.now();
    const enteredAt = lastViewState.enteredAt || now;
    const dwellMs = Math.max(0, now - enteredAt);
    emit({
      eventType: 'page.leave',
      route: routeBeingLeft,
      emittedAt: new Date(now).toISOString(),
      payload: { route: routeBeingLeft, dwellMs },
    });
  }

  if (typeof window === 'undefined') return () => undefined;

  // Detect SPA route changes by polling — page-view rewires the
  // history methods already, and we don't want to compete. Cheap
  // 1Hz poll is plenty.
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
