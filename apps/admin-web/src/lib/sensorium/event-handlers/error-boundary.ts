/**
 * `error.boundary` handler — Central Command Phase A.
 *
 * Listens for window-level `error` and `unhandledrejection`. Component-
 * stack truncated to 500 chars. The brain reads these to surface "the
 * UI broke — let me re-explain the page" interventions.
 */

import { truncate } from '../pii-redactor.js';
import type { HandlerInstall } from './types.js';

export const installErrorBoundaryHandler: HandlerInstall = (emit, ctx) => {
  function emitError(name: string, message: string, stack?: string): void {
    emit({
      eventType: 'error.boundary',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: {
        errorName: truncate(name, 120),
        componentStack: truncate(stack ?? message, 500),
      },
    });
  }

  function onError(ev: ErrorEvent): void {
    const name = ev.error?.name ?? 'Error';
    const message = ev.message ?? String(ev.error ?? '');
    emitError(name, message, ev.error?.stack);
  }

  function onRejection(ev: PromiseRejectionEvent): void {
    const reason = ev.reason as { name?: string; message?: string; stack?: string } | undefined;
    emitError(
      reason?.name ?? 'UnhandledRejection',
      reason?.message ?? String(ev.reason ?? ''),
      reason?.stack,
    );
  }

  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
};
