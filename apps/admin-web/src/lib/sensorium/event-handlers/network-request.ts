/**
 * `network.request` handler — Central Command Phase A.
 *
 * Patches `window.fetch` to emit ONLY on:
 *   - non-2xx responses
 *   - durations > 1000ms
 *
 * Successful fast requests are not emitted (too noisy). The brain
 * reads failures + slow calls as "the system is degraded" signal —
 * Mr. Mwikila proactively offers help when the network is misbehaving.
 *
 * We never emit `/api/v1/sensorium/events` itself — that would loop.
 */

import { truncate } from '../pii-redactor.js';
import type { HandlerInstall } from './types.js';

const SLOW_REQUEST_MS = 1000;
const SENSORIUM_PATH = '/api/v1/sensorium/events';

export const installNetworkRequestHandler: HandlerInstall = (emit, ctx) => {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => undefined;
  }
  const originalFetch = window.fetch;

  const wrapped: typeof window.fetch = async (
    input,
    init,
  ) => {
    const startedAt = Date.now();
    let url = '';
    try {
      url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url ?? '';
    } catch {
      url = '';
    }

    try {
      const response = await originalFetch(input, init);
      const durationMs = Date.now() - startedAt;
      const isSensorium = url.includes(SENSORIUM_PATH);
      const shouldEmit =
        !isSensorium && (response.status >= 400 || durationMs > SLOW_REQUEST_MS);
      if (shouldEmit) {
        emit({
          eventType: 'network.request',
          route: ctx.route(),
          emittedAt: new Date().toISOString(),
          payload: {
            url: truncate(url, 200),
            status: response.status,
            durationMs,
          },
        });
      }
      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (!url.includes(SENSORIUM_PATH)) {
        emit({
          eventType: 'network.request',
          route: ctx.route(),
          emittedAt: new Date().toISOString(),
          payload: {
            url: truncate(url, 200),
            status: 0,
            durationMs,
            error: truncate(
              error instanceof Error ? error.message : String(error),
              120,
            ),
          },
        });
      }
      throw error;
    }
  };
  window.fetch = wrapped;

  return () => {
    window.fetch = originalFetch;
  };
};
