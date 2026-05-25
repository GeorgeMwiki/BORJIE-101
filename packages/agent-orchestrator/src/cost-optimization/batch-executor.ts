/**
 * Batch executor — collects brain calls within a configurable
 * windowMs and dispatches them as a single batch when (a) the window
 * elapses or (b) the batch reaches a max size.
 *
 * Backed by an injected `batchBrain` port that the caller wires to
 * Anthropic's Batch API (50% discount). When `batchBrain` is not
 * supplied, the executor falls back to serial calls on the regular
 * brain — still correct, just no discount.
 */

import type {
  BrainCallRequest,
  BrainCallResponse,
  BrainPort,
} from '../types.js';

export interface BatchBrainPort {
  callBatch(reqs: ReadonlyArray<BrainCallRequest>): Promise<ReadonlyArray<BrainCallResponse>>;
}

export interface CreateBatchExecutorInput {
  readonly brain: BrainPort;
  readonly batchBrain?: BatchBrainPort;
  /** Time-based flush threshold in ms. Set 0 for size-only flush. */
  readonly windowMs: number;
  /** Size-based flush threshold (default 16). */
  readonly maxBatchSize?: number;
  /** Setter for the timer mechanism; default `setTimeout`. */
  readonly schedule?: (cb: () => void, ms: number) => unknown;
}

export interface BatchExecutor {
  readonly brain: BrainPort;
  /** Force-flush pending requests immediately. */
  flush(): Promise<void>;
  stats(): { readonly batches: number; readonly serial: number };
}

export const DEFAULT_BATCH_SIZE = 16;

interface Pending {
  readonly req: BrainCallRequest;
  readonly resolve: (resp: BrainCallResponse) => void;
  readonly reject: (err: unknown) => void;
}

export function createBatchExecutor(input: CreateBatchExecutorInput): BatchExecutor {
  const maxSize = input.maxBatchSize ?? DEFAULT_BATCH_SIZE;
  const scheduler = input.schedule ?? ((cb, ms) => setTimeout(cb, ms));
  let pending: Pending[] = [];
  let timer: unknown = null;
  let batches = 0;
  let serial = 0;

  async function flushNow(): Promise<void> {
    if (pending.length === 0) return;
    const drained = pending;
    pending = [];
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      // best effort to clear; not strictly needed because we just reset pending
    }
    timer = null;

    if (input.batchBrain) {
      batches += 1;
      try {
        const results = await input.batchBrain.callBatch(drained.map((p) => p.req));
        drained.forEach((p, i) => {
          const r = results[i];
          if (!r) {
            p.reject(new Error(`batch missing response at index ${i}`));
          } else {
            p.resolve(r);
          }
        });
      } catch (err) {
        for (const p of drained) p.reject(err);
      }
    } else {
      serial += drained.length;
      for (const p of drained) {
        try {
          const r = await input.brain.call(p.req);
          p.resolve(r);
        } catch (err) {
          p.reject(err);
        }
      }
    }
  }

  function scheduleFlush() {
    if (timer || input.windowMs <= 0) return;
    timer = scheduler(() => {
      timer = null;
      void flushNow();
    }, input.windowMs);
  }

  return {
    brain: {
      call(req: BrainCallRequest): Promise<BrainCallResponse> {
        return new Promise<BrainCallResponse>((resolve, reject) => {
          pending.push({ req, resolve, reject });
          if (pending.length >= maxSize) {
            void flushNow();
            return;
          }
          scheduleFlush();
        });
      },
    },
    flush: flushNow,
    stats: () => Object.freeze({ batches, serial }),
  };
}
