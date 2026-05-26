/**
 * Capture client — HTTP wrapper over POST /api/v1/session-mirror/capture.
 *
 * Side-channel design: never block the caller, never throw on a 4xx /
 * 5xx, always swallow network errors. The MD's read path is the
 * server-side snapshot reader; if this POST fails the worst case is a
 * single missed batch — the next batch carries the latest state and
 * the gap is recovered.
 *
 * On tab close we attempt `navigator.sendBeacon` so the final pending
 * batch makes it to the server even when the page is unloading.
 */

import type { CaptureBatch, CaptureEvent } from '../types.js';

const DEFAULT_ENDPOINT = '/api/v1/session-mirror/capture';

export interface CaptureClientOptions {
  readonly endpoint?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly sendBeacon?:
    | ((url: string, data: Blob) => boolean)
    | undefined;
}

export interface CaptureClient {
  readonly send: (batch: CaptureBatch) => Promise<void>;
  readonly sendOnUnload: (batch: CaptureBatch) => void;
}

export function createCaptureClient(
  options: CaptureClientOptions = {},
): CaptureClient {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const fetchImpl =
    options.fetchImpl ??
    (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : noopFetch);
  const sendBeacon =
    options.sendBeacon ??
    (typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : null);

  async function send(batch: CaptureBatch): Promise<void> {
    if (batch.events.length === 0) return;
    try {
      await fetchImpl(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch (err) {
      console.warn('[session-mirror] capture POST failed:', err);
    }
  }

  function sendOnUnload(batch: CaptureBatch): void {
    if (batch.events.length === 0) return;
    if (sendBeacon) {
      try {
        const blob = new Blob([JSON.stringify(batch)], {
          type: 'application/json',
        });
        sendBeacon(endpoint, blob);
        return;
      } catch {
        // Fall through to fetch.
      }
    }
    void send(batch);
  }

  return { send, sendOnUnload };
}

/** Build a `CaptureBatch` from a flat event array + session scope. */
export function buildBatch(args: {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly events: ReadonlyArray<CaptureEvent>;
}): CaptureBatch {
  return {
    tenantId: args.tenantId,
    userId: args.userId,
    sessionId: args.sessionId,
    events: args.events,
  };
}

function noopFetch(): Promise<Response> {
  return Promise.resolve(
    new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}
