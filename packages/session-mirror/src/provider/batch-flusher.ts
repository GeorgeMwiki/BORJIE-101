/**
 * Batch flusher — accumulates `CaptureEvent`s and flushes either when
 * the buffer reaches `maxBatchSize` events OR when `flushIntervalMs`
 * elapses since the first event in the current batch (whichever comes
 * first). Pure logic — no fetch / no React. The provider wires
 * `onFlush` to the capture-client.
 */

import type { CaptureEvent } from '../types.js';

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH_SIZE = 50;

export interface BatchFlusherOptions {
  readonly maxBatchSize?: number;
  readonly flushIntervalMs?: number;
  readonly onFlush: (events: ReadonlyArray<CaptureEvent>) => void | Promise<void>;
}

export class BatchFlusher {
  private readonly queue: CaptureEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly onFlush: (
    events: ReadonlyArray<CaptureEvent>,
  ) => void | Promise<void>;
  private stopped = false;

  constructor(options: BatchFlusherOptions) {
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.onFlush = options.onFlush;
  }

  enqueue(event: CaptureEvent): void {
    if (this.stopped) return;
    this.queue.push(event);
    if (this.queue.length >= this.maxBatchSize) {
      void this.flushNow();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        void this.flushNow();
      }, this.flushIntervalMs);
    }
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await this.onFlush(batch);
    } catch (err) {
      // Swallow — capture is a side channel. Log and continue.
      console.warn('[session-mirror] flush failed:', err);
    }
  }

  /** Returns a defensive copy of the queue for tests. */
  __peek(): ReadonlyArray<CaptureEvent> {
    return [...this.queue];
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
