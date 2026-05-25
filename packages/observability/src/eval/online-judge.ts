/**
 * Online LLM-judge for sampling production traces.
 *
 * Existing offline eval is regression-focused — fixed test set, run on
 * CI. The online judge complements it by sampling a small fraction of
 * REAL production traces and scoring them across the 10 R-MOAT-6
 * dimensions (see `./dimensions.ts`).
 *
 * Design contracts:
 *
 *   1. **Sampling is deterministic per trace.** Whether a given trace
 *      is sampled is a hash of its `traceId`, not a random roll. The
 *      same trace is therefore ALWAYS sampled or NEVER sampled — no
 *      flapping across retries, no "did we keep this one?" ambiguity
 *      when comparing dashboards.
 *
 *   2. **Non-blocking.** `score()` returns immediately. The judge work
 *      happens on a fire-and-forget queue so the main turn never pays
 *      eval latency.
 *
 *   3. **Backpressure-aware.** If the queue exceeds `maxQueueDepth`
 *      (default 1000) the judge silently DROPS new samples — better to
 *      lose a few eval data points than starve the request hot path.
 *      The `getStats()` helper exposes the drop counter for alerting.
 *
 *   4. **Bridges to Langfuse via OTel attributes.** The scores are
 *      surfaced under the `langfuse.observation.score.*` attribute
 *      namespace through the `ScoreSink` interface — no direct
 *      coupling to the Langfuse SDK from this module.
 */

import { createHash } from 'node:crypto';
import type { EvalDimensionId } from './dimensions.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single dimension score, with provenance for downstream attribution. */
export interface DimensionScore {
  readonly dimensionId: EvalDimensionId;
  /** Continuous 0-1 score from the judge. */
  readonly score: number;
  /** Optional free-text reasoning the judge produced. */
  readonly reasoning?: string;
}

/** The full LLM-judge output for one trace — 10 dimension scores. */
export interface JudgeScore {
  readonly traceId: string;
  readonly dimensions: ReadonlyArray<DimensionScore>;
  /** Wall-clock ms the judge spent producing this score. */
  readonly judgeLatencyMs: number;
}

/** The trace payload passed to the judge function. */
export interface TraceForJudging {
  readonly traceId: string;
  readonly request: string;
  readonly response: string;
}

/** User-supplied judge function — typically wraps an LLM call. */
export type JudgeFn = (trace: TraceForJudging) => Promise<JudgeScore>;

/**
 * Sink the judge calls with each completed score. Implementations
 * typically push the score to Langfuse (via the OTel adapter) or
 * to an internal scores table.
 */
export interface ScoreSink {
  write(score: JudgeScore): Promise<void> | void;
}

export interface OnlineJudgeOptions {
  /** Fraction of traces to sample. Default 0.03 (3%). Clamped to [0,1]. */
  readonly sampleRate?: number;
  /** Hard cap on the in-memory queue. Defaults to 1000. */
  readonly maxQueueDepth?: number;
  /** The user-provided judge function. */
  readonly judgeFn: JudgeFn;
  /** Where to send completed scores. */
  readonly sink: ScoreSink;
  /**
   * Optional clock for tests so latency is deterministic. Defaults to
   * `() => Date.now()`.
   */
  readonly clock?: () => number;
  /**
   * Optional error reporter. Called when the judge or sink throws. The
   * online judge NEVER throws into caller code — failures here are
   * logged and counted.
   */
  readonly onError?: (err: unknown, traceId: string) => void;
}

/** Diagnostic counters surfaced for dashboards / smoke tests. */
export interface OnlineJudgeStats {
  readonly sampled: number;
  readonly skipped: number;
  readonly dropped: number;
  readonly completed: number;
  readonly failed: number;
  readonly queueDepth: number;
}

/** Public surface returned by `createOnlineJudge`. */
export interface OnlineJudge {
  /** Submit a trace for possible scoring. Returns immediately. */
  score(
    traceId: string,
    request: string,
    response: string,
  ): Promise<void>;
  /** Snapshot of internal counters — useful for smoke tests + alerts. */
  getStats(): OnlineJudgeStats;
  /**
   * Wait for the in-flight queue to drain. Test helper only — production
   * code should never need this because the judge is fire-and-forget.
   */
  drain(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_SAMPLE_RATE = 0.03;
const DEFAULT_MAX_QUEUE_DEPTH = 1000;
// Number of hex chars consumed from the SHA-256 digest. 8 hex chars =
// 32 bits = max value 0xffffffff. Keep HEX_CHARS and MAX_HASH_VALUE in
// lockstep — if either is changed the other MUST be updated or the
// sample-rate normaliser silently desyncs and fairness skews.
const HEX_CHARS = 8;
const MAX_HASH_VALUE = 16 ** HEX_CHARS - 1;

/**
 * Deterministic [0, 1) value derived from a trace id. We take the
 * first `HEX_CHARS` hex chars of a SHA-256 — sufficient for sampling
 * fairness across realistic traceId distributions and trivially testable.
 */
export function traceIdToSampleValue(traceId: string): number {
  if (!traceId) return 0;
  const hex = createHash('sha256')
    .update(traceId)
    .digest('hex')
    .slice(0, HEX_CHARS);
  const n = parseInt(hex, 16);
  return n / (MAX_HASH_VALUE + 1);
}

/**
 * Deterministic sampling decision. `traceId` + `sampleRate` are the
 * only inputs — the same pair always yields the same answer.
 *
 * Exported for tests so the contract is locked in independently of
 * the wider `createOnlineJudge` factory.
 */
export function isTraceSampled(traceId: string, sampleRate: number): boolean {
  const clamped = Math.max(0, Math.min(1, sampleRate));
  if (clamped === 0) return false;
  if (clamped >= 1) return true;
  return traceIdToSampleValue(traceId) < clamped;
}

/** Clamp the user-supplied rate to a sane [0, 1] window. */
function clampRate(rate: number | undefined): number {
  if (rate === undefined || Number.isNaN(rate)) return DEFAULT_SAMPLE_RATE;
  return Math.max(0, Math.min(1, rate));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an online judge. Returns a `score()` function that
 * fire-and-forget submits traces for LLM-judge scoring.
 *
 * MULTI-TENANT NOTE: each `OnlineJudge` instance owns its own `inflight`
 * queue and counters. To preserve fair backpressure across tenants in
 * a multi-tenant process, callers SHOULD construct one judge per tenant
 * (or per tenant-bucket) — e.g. a `Map<tenantId, OnlineJudge>` cached
 * at the kernel composition root. Sharing a single instance across
 * tenants is legal but means a noisy tenant can exhaust the (default
 * 1000-slot) queue and silently drop another tenant's eval samples.
 */
export function createOnlineJudge(options: OnlineJudgeOptions): OnlineJudge {
  const sampleRate = clampRate(options.sampleRate);
  const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
  const clock = options.clock ?? (() => Date.now());

  // Mutable counters — module-private. We return immutable snapshots.
  const counters = {
    sampled: 0,
    skipped: 0,
    dropped: 0,
    completed: 0,
    failed: 0,
  };

  // Track outstanding promises so `drain()` can wait for them. We use a
  // Set + delete-on-settle so completed promises don't pin memory.
  const inflight = new Set<Promise<void>>();

  function makeStats(): OnlineJudgeStats {
    return {
      sampled: counters.sampled,
      skipped: counters.skipped,
      dropped: counters.dropped,
      completed: counters.completed,
      failed: counters.failed,
      queueDepth: inflight.size,
    };
  }

  async function judgeAndPersist(
    traceId: string,
    request: string,
    response: string,
  ): Promise<void> {
    const started = clock();
    try {
      const result = await options.judgeFn({ traceId, request, response });
      // Stamp judgeLatencyMs if the judge didn't provide one. We
      // preserve the original immutably.
      const score: JudgeScore =
        typeof result.judgeLatencyMs === 'number'
          ? result
          : { ...result, judgeLatencyMs: clock() - started };
      await options.sink.write(score);
      counters.completed += 1;
    } catch (err) {
      counters.failed += 1;
      if (options.onError) {
        try {
          options.onError(err, traceId);
        } catch {
          // Swallow — onError must never break the queue.
        }
      }
    }
  }

  async function score(
    traceId: string,
    request: string,
    response: string,
  ): Promise<void> {
    if (!isTraceSampled(traceId, sampleRate)) {
      counters.skipped += 1;
      return;
    }

    if (inflight.size >= maxQueueDepth) {
      // Backpressure — drop silently. We log via onError so operators
      // can alert on the drop counter.
      counters.dropped += 1;
      if (options.onError) {
        try {
          options.onError(
            new Error(`online-judge queue depth ${inflight.size} >= ${maxQueueDepth}`),
            traceId,
          );
        } catch {
          // ignore
        }
      }
      return;
    }

    counters.sampled += 1;
    const task = judgeAndPersist(traceId, request, response);
    inflight.add(task);
    // Auto-remove on settle so memory doesn't grow unbounded.
    task.finally(() => {
      inflight.delete(task);
    });
  }

  async function drain(): Promise<void> {
    // Take a snapshot of in-flight tasks — new arrivals after this
    // point are NOT awaited (drain is a one-shot test helper).
    const snapshot = Array.from(inflight);
    await Promise.allSettled(snapshot);
  }

  return Object.freeze({ score, getStats: makeStats, drain });
}
