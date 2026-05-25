/**
 * `viewport.resize` handler — Central Command Phase A.
 *
 * Debounced 300ms. The brain reads viewport size for layout-aware
 * generative UI decisions ("don't render a 5-column table on a
 * 320px viewport").
 */

import type { HandlerInstall } from './types.js';

const DEBOUNCE_MS = 300;

export const installViewportResizeHandler: HandlerInstall = (emit, ctx) => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function fire(): void {
    if (typeof window === 'undefined') return;
    emit({
      eventType: 'viewport.resize',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: {
        width: window.innerWidth || 0,
        height: window.innerHeight || 0,
      },
    });
  }

  function onResize(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fire();
    }, DEBOUNCE_MS);
  }

  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    if (timer) clearTimeout(timer);
  };
};
