/**
 * Adaptive SSE streamer — Roadmap R10.
 *
 * The fixed 15 wps (words-per-second) rate the brain ships today is
 * the Swahili medium-complexity midpoint from arxiv 2504.17999. Real-
 * world clients vary: a fast desktop pulls chunks as soon as they
 * land, while a slow 3G phone needs the server to batch.
 *
 * This module wraps the brain's chunk producer with an adaptive rate
 * controller:
 *
 *   - Server side: each chunk carries a `chunkNo` integer. The client
 *     ACKs the last chunk number it has displayed via the
 *     `?lastChunk=N` query parameter on the next reconnect (or a
 *     periodic `client_ack` event during a long-lived stream).
 *   - The controller tracks ACK-lag (chunks emitted but not yet
 *     ACKed). When lag > `lagBatchThreshold` the controller batches
 *     subsequent micro-chunks into a single coarse chunk; when lag
 *     drops below `lagMicroThreshold` it micro-streams (one chunk per
 *     word).
 *
 * The implementation is pure / framework-agnostic — the api-gateway
 * SSE handler wires the producer + the controller together; the test
 * suite drives it without any HTTP layer.
 */

export interface AdaptiveStreamOptions {
  readonly lagMicroThreshold?: number;
  readonly lagBatchThreshold?: number;
  /** Minimum delay between emitted chunks (ms). */
  readonly microDelayMs?: number;
  /** Test seam — override the clock. */
  readonly now?: () => number;
}

export interface StreamChunk {
  readonly chunkNo: number;
  readonly text: string;
  readonly batched: boolean;
}

const DEFAULTS = {
  lagMicroThreshold: 4,
  lagBatchThreshold: 16,
  microDelayMs: 67, // ~15 wps
} as const;

/**
 * Pure controller — given the producer's word stream and the latest
 * client ACK chunk-number, returns the next chunk to emit and the
 * controller's new state. Caller owns the actual wall-clock delay.
 */
export class AdaptiveStreamController {
  private nextChunkNo = 1;
  private lastAckedChunkNo = 0;
  private pendingWords: string[] = [];
  private mode: 'micro' | 'batch' = 'micro';
  private readonly opts: Required<AdaptiveStreamOptions>;

  constructor(opts: AdaptiveStreamOptions = {}) {
    this.opts = {
      lagMicroThreshold: opts.lagMicroThreshold ?? DEFAULTS.lagMicroThreshold,
      lagBatchThreshold: opts.lagBatchThreshold ?? DEFAULTS.lagBatchThreshold,
      microDelayMs: opts.microDelayMs ?? DEFAULTS.microDelayMs,
      now: opts.now ?? Date.now,
    };
  }

  /** Acknowledge a chunk the client has displayed. Idempotent. */
  ack(chunkNo: number): void {
    if (chunkNo > this.lastAckedChunkNo) {
      this.lastAckedChunkNo = chunkNo;
    }
    // Update mode based on the new lag.
    if (this.lag() < this.opts.lagMicroThreshold) {
      this.mode = 'micro';
    }
  }

  /** Current emitted-but-not-ACKed chunk count. */
  lag(): number {
    return this.nextChunkNo - 1 - this.lastAckedChunkNo;
  }

  /** Current mode — exposed for tests + telemetry. */
  currentMode(): 'micro' | 'batch' {
    return this.mode;
  }

  /** Enqueue a producer-emitted word. */
  push(word: string): void {
    this.pendingWords.push(word);
  }

  /**
   * Drain pending words and emit one chunk per the current mode.
   * Returns null when there's nothing to emit yet. The caller is
   * responsible for the wall-clock delay before the next pull.
   */
  pull(): StreamChunk | null {
    if (this.pendingWords.length === 0) return null;
    const lag = this.lag();
    if (lag >= this.opts.lagBatchThreshold) {
      this.mode = 'batch';
    }
    if (this.mode === 'batch') {
      const text = this.pendingWords.join(' ');
      this.pendingWords = [];
      const chunk: StreamChunk = {
        chunkNo: this.nextChunkNo,
        text,
        batched: true,
      };
      this.nextChunkNo += 1;
      return chunk;
    }
    // micro mode — one word per chunk.
    const word = this.pendingWords.shift();
    if (word === undefined) return null;
    const chunk: StreamChunk = {
      chunkNo: this.nextChunkNo,
      text: word,
      batched: false,
    };
    this.nextChunkNo += 1;
    return chunk;
  }

  /** Recommended delay before the next pull (ms). */
  recommendedDelayMs(): number {
    return this.mode === 'micro' ? this.opts.microDelayMs : 0;
  }
}

/** Convenience factory. */
export function createAdaptiveStreamController(
  opts?: AdaptiveStreamOptions,
): AdaptiveStreamController {
  return new AdaptiveStreamController(opts);
}
