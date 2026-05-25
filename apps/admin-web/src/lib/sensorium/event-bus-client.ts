/**
 * Sensorium event-bus client — Central Command Phase A (C4 Brain Skin).
 *
 * Buffers `SensoryEvent`s from the 14 handlers and POSTs them in
 * batches to `/api/v1/sensorium/events`. Each batch carries the
 * stable `sessionId` so the server-side aggregator can roll up per
 * (tenant, user, session).
 *
 * Design constraints:
 *   - Never block render — emit() is synchronous, push-only.
 *   - Never lose events on tab close — `beforeunload` does a final
 *     `navigator.sendBeacon` flush.
 *   - Never block on the server — POST failure logs to console and
 *     moves on (the sensorium is a side channel, not the chat).
 */

import type {
  SensoriumBusOptions,
  SensoryEvent,
  SensoryEventType,
} from './types.js';
import { SENSORIUM_EVENT_TYPES } from './types.js';

const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_BATCH_SIZE = 80; // server cap is 100; leave headroom
const DEFAULT_ENDPOINT = '/api/v1/sensorium/events';

const VALID_TYPES: ReadonlySet<string> = new Set(SENSORIUM_EVENT_TYPES);

export class SensoriumBus {
  private readonly queue: SensoryEvent[] = [];
  private readonly options: Required<
    Omit<SensoriumBusOptions, 'fetchImpl'>
  > & {
    fetchImpl: typeof fetch;
  };
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(options: SensoriumBusOptions) {
    this.options = {
      sessionId: options.sessionId,
      surface: options.surface,
      endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      maxBatchSize: options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
      fetchImpl:
        options.fetchImpl ??
        (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : noopFetch),
    };
  }

  /** Push a single sensory event into the buffer. */
  emit(event: SensoryEvent): void {
    if (this.stopped) return;
    if (!event || !event.eventType) return;
    if (!VALID_TYPES.has(event.eventType)) return;
    // Cap queue depth — if events arrive faster than the bus can
    // flush, drop the oldest. Better to lose tail rows than OOM.
    if (this.queue.length >= this.options.maxBatchSize * 4) {
      this.queue.shift();
    }
    this.queue.push(event);
    if (this.queue.length >= this.options.maxBatchSize) {
      void this.flush();
    }
  }

  /** Start the periodic flush + `beforeunload` flush. Idempotent. */
  start(): void {
    if (this.flushTimer || this.stopped) return;
    this.flushTimer = setInterval(
      () => void this.flush(),
      this.options.flushIntervalMs,
    );
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
      window.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  /** Stop emitting and drop the timer. Final flush is best-effort. */
  stop(): void {
    this.stopped = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      window.removeEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      );
    }
    void this.flush();
  }

  /** Flush whatever is in the buffer. Errors are swallowed. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.options.maxBatchSize);
    const body = {
      sessionId: this.options.sessionId,
      surface: this.options.surface,
      batch,
    };
    try {
      await this.options.fetchImpl(this.options.endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Side-channel: never break rendering. Console-only.
      console.warn('[sensorium] flush failed:', err);
    }
  }

  /** Snapshot the queue for tests. Returns a defensive copy. */
  __peek(): ReadonlyArray<SensoryEvent> {
    return [...this.queue];
  }

  /** Inspect current options for tests. */
  __options(): Readonly<SensoriumBusOptions> {
    return { ...this.options };
  }

  /** Test-only — manually clear the buffer. */
  __clear(): void {
    this.queue.length = 0;
  }

  private handleBeforeUnload = (): void => {
    if (this.queue.length === 0) return;
    const body = JSON.stringify({
      sessionId: this.options.sessionId,
      surface: this.options.surface,
      batch: this.queue.splice(0, this.options.maxBatchSize),
    });
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      try {
        navigator.sendBeacon(
          this.options.endpoint,
          new Blob([body], { type: 'application/json' }),
        );
      } catch {
        // sendBeacon failure is silent by design.
      }
    }
  };

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      void this.flush();
    }
  };
}

export type { SensoryEvent, SensoryEventType } from './types.js';

function noopFetch(): Promise<Response> {
  return Promise.resolve(
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}
