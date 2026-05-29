/**
 * SSE client-ack helper — Roadmap R10.
 *
 * Tracks the last successfully rendered chunkNo and periodically
 * POSTs it back to the server so the adaptive stream controller
 * (services/api-gateway/src/services/brain/sse-adaptive.ts) can
 * widen / narrow the chunk granularity.
 *
 * Pure logic — no React, no DOM. The caller wires it into an
 * EventSource or fetch-based reader.
 */

export interface SseAckOptions {
  /** Endpoint to POST ACKs to. Required. */
  readonly ackUrl: string;
  /** Test seam — override the fetch implementation. */
  readonly fetcher?: typeof fetch;
  /** Minimum ms between ACK POSTs. Default 500. */
  readonly minIntervalMs?: number;
}

export interface SseAckHandle {
  /** Mark a chunk as displayed. The ACK is debounced. */
  ack(chunkNo: number): void;
  /** Flush a pending ACK immediately (e.g. on tab hide). */
  flush(): Promise<void>;
}

/**
 * Build an ACK handle. The caller must `ack()` each chunk as it
 * lands on screen; the helper batches and POSTs no more often than
 * `minIntervalMs` to avoid network thrash.
 */
export function createSseAck(options: SseAckOptions): SseAckHandle {
  const fetcher = options.fetcher ?? fetch;
  const minInterval = options.minIntervalMs ?? 500;
  let lastAckedChunkNo = 0;
  let pendingChunkNo = 0;
  let scheduled = false;
  let lastPostAt = 0;

  async function post(chunkNo: number): Promise<void> {
    if (chunkNo <= lastAckedChunkNo) return;
    try {
      await fetcher(options.ackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ lastChunk: chunkNo }),
      });
      lastAckedChunkNo = chunkNo;
      lastPostAt = Date.now();
    } catch {
      // Swallow ACK errors — the controller will resync on next
      // chunkNo arriving.
    }
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    const now = Date.now();
    const wait = Math.max(0, minInterval - (now - lastPostAt));
    setTimeout(() => {
      scheduled = false;
      const target = pendingChunkNo;
      void post(target);
    }, wait);
  }

  return {
    ack(chunkNo: number): void {
      if (chunkNo > pendingChunkNo) {
        pendingChunkNo = chunkNo;
      }
      schedule();
    },
    async flush(): Promise<void> {
      await post(pendingChunkNo);
    },
  };
}
