/**
 * SLO monitor — streams in actual outcomes, updates SLO state, decides
 * whether to fire a breach action.
 *
 * Pure: takes the SLO + recent events, returns a verdict. Persistence
 * (event log row, breach action wiring) is the adapter's job.
 *
 * Breach policy:
 *   - We need a minimum sample size before declaring a breach, otherwise
 *     a single bad run nukes a sub-MD. Default: 10 events in window.
 *   - The breach metric is the *mean* `delta` over the window. `mean < 0`
 *     = sustained breach.
 *   - For `warn` action: any single delta < 0 once min-sample is met.
 *   - For `reduce-traffic` / `handoff` / `kill-and-rollback`: the mean
 *     delta must be < 0 AND the breach magnitude must exceed `target *
 *     toleranceFraction` (default 5%). This is the anti-flap clause.
 */

import { demoteStage } from './canary-controller.js';
import {
  executeAutoRollback,
  type AutoRollbackDeps,
} from './auto-rollback.js';
import type {
  AutoRollbackReceipt,
  SloEvent,
  SloMonitorVerdict,
  SubMdSlo,
} from '../types.js';

export interface SloMonitorOptions {
  /** Minimum events in window before any breach can fire. */
  readonly minSampleSize?: number;
  /**
   * Fractional tolerance — breaches inside this band are warns, not
   * traffic-reductions. Default 5%.
   */
  readonly toleranceFraction?: number;
}

const DEFAULT_OPTS: Required<SloMonitorOptions> = {
  minSampleSize: 10,
  toleranceFraction: 0.05,
};

/**
 * Evaluate whether the recent stream of events breaches the SLO.
 *
 * @param slo            The SLO definition for the (subMd, metric) pair.
 * @param recentEvents   Events for THIS slo (caller filters by subMd +
 *                       metric + window). Order does not matter.
 * @param opts           Monitor knobs.
 */
export function evaluateSlo(
  slo: SubMdSlo,
  recentEvents: ReadonlyArray<SloEvent>,
  opts: SloMonitorOptions = {},
): SloMonitorVerdict {
  const { minSampleSize, toleranceFraction } = { ...DEFAULT_OPTS, ...opts };

  // Filter belt-and-braces: only events matching this SLO.
  const matched = recentEvents.filter(
    (e) => e.subMd === slo.subMd && e.metric === slo.metric,
  );

  if (matched.length < minSampleSize) {
    return Object.freeze({
      subMd: slo.subMd,
      metric: slo.metric,
      breached: false,
      nextStage: null,
      action: 'no-op',
      reason: `sample size ${matched.length} < min ${minSampleSize}`,
    });
  }

  const meanDelta = matched.reduce((sum, e) => sum + e.delta, 0) / matched.length;
  const toleranceBand = Math.abs(slo.target) * toleranceFraction;

  // No breach: meanDelta is at-or-above target (delta convention: negative = bad).
  if (meanDelta >= 0) {
    return Object.freeze({
      subMd: slo.subMd,
      metric: slo.metric,
      breached: false,
      nextStage: null,
      action: 'no-op',
      reason: `meanDelta ${meanDelta.toFixed(4)} >= 0 (within SLO)`,
    });
  }

  // Inside tolerance band → soft breach: warn only, never demote.
  if (Math.abs(meanDelta) <= toleranceBand) {
    return Object.freeze({
      subMd: slo.subMd,
      metric: slo.metric,
      breached: true,
      nextStage: slo.canaryStage,
      action: 'warn',
      reason: `meanDelta ${meanDelta.toFixed(4)} inside tolerance band ±${toleranceBand.toFixed(4)}`,
    });
  }

  // Hard breach — honour the SLO's configured action.
  if (slo.breachAction === 'warn') {
    return Object.freeze({
      subMd: slo.subMd,
      metric: slo.metric,
      breached: true,
      nextStage: slo.canaryStage,
      action: 'warn',
      reason: `meanDelta ${meanDelta.toFixed(4)} breached (warn-only policy)`,
    });
  }

  if (slo.breachAction === 'reduce-traffic') {
    const next = demoteStage(slo.canaryStage);
    return Object.freeze({
      subMd: slo.subMd,
      metric: slo.metric,
      breached: true,
      nextStage: next ?? slo.canaryStage,
      action: next === null ? 'warn' : 'reduce-traffic',
      reason:
        next === null
          ? `meanDelta ${meanDelta.toFixed(4)} breached at floor stage 'shadow' — warn-only`
          : `meanDelta ${meanDelta.toFixed(4)} breached — demote ${slo.canaryStage} → ${next}`,
    });
  }

  if (slo.breachAction === 'handoff') {
    return Object.freeze({
      subMd: slo.subMd,
      metric: slo.metric,
      breached: true,
      nextStage: 'shadow',
      action: 'handoff',
      reason: `meanDelta ${meanDelta.toFixed(4)} breached — quarantine sub-MD, route to handoff queue`,
    });
  }

  // kill-and-rollback — terminal
  return Object.freeze({
    subMd: slo.subMd,
    metric: slo.metric,
    breached: true,
    nextStage: 'shadow',
    action: 'kill-and-rollback',
    reason: `meanDelta ${meanDelta.toFixed(4)} breached — disable sub-MD and restore prior version`,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Live stream consumer (Phase E.5.3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Single-SLO event-stream consumer. Resolves an SLO definition per event,
 * batches events into the SLO's rolling window, and runs `evaluateSlo`
 * every `evaluateEveryNEvents` events. When the verdict is a breach, the
 * configured `AutoRollbackDeps` are invoked.
 *
 * Wire-side (production composition) supplies:
 *   - `sloResolver`         : look up the (subMd, metric, tenant) SLO row
 *   - `windowBuffer`        : an in-memory ring buffer per SLO key
 *   - `rollbackDeps`        : canary store + handoff queue + revert port
 *
 * The consumer is a *pull* API — callers stream events into `consume(event)`.
 * That makes it trivially testable + transport-agnostic (NATS / Postgres
 * LISTEN / file tailer all fan into the same surface).
 */
export interface SloResolver {
  /**
   * Resolve the active SLO for the (subMd, metric, tenantId) tuple.
   * Returns `null` when no SLO is configured — the event is ignored.
   */
  resolve(args: {
    readonly subMd: string;
    readonly metric: SloEvent['metric'];
    readonly tenantId: string | null;
  }): Promise<SubMdSlo | null>;
}

export interface SloWindowBuffer {
  /** Append the event; the buffer trims to the SLO's rolling window. */
  append(key: string, event: SloEvent): Promise<void>;
  /** Read every event currently inside the window for this key. */
  read(key: string): Promise<ReadonlyArray<SloEvent>>;
  /** Number of events seen for `key` since the last evaluate. */
  sinceLastEvaluate(key: string): Promise<number>;
  /** Reset the sinceLastEvaluate counter for `key`. */
  markEvaluated(key: string): Promise<void>;
}

export interface SloStreamConsumer {
  consume(event: SloEvent): Promise<SloMonitorVerdict | null>;
}

export interface SubscribeSloStreamArgs {
  readonly resolver: SloResolver;
  readonly buffer: SloWindowBuffer;
  readonly rollbackDeps: AutoRollbackDeps;
  /**
   * Evaluate the SLO every N events seen for the (subMd, metric, tenant)
   * key. Default = 10 (matches `evaluateSlo`'s `minSampleSize` default).
   */
  readonly evaluateEveryNEvents?: number;
  /** Forwarded to `evaluateSlo`. */
  readonly monitorOptions?: SloMonitorOptions;
  /**
   * Side-effect hook for tests + audit: called for every rollback receipt
   * (including no-op + warn). Defaults to a no-op.
   */
  readonly onReceipt?: (receipt: AutoRollbackReceipt) => Promise<void> | void;
}

function bufferKey(event: SloEvent | SubMdSlo): string {
  const t = (event as SloEvent).tenantId ?? null;
  const sub = event.subMd;
  const metric = (event as SloEvent).metric ?? (event as SubMdSlo).metric;
  return `${sub}::${metric}::${t ?? '*'}`;
}

/**
 * Create a streaming consumer that drives `evaluateSlo` + `executeAutoRollback`
 * for every Nth event observed on the SLO event stream.
 *
 * The consumer is pure-ish: it owns no transport. Wire-side adapters (NATS
 * subscription, Postgres LISTEN, file tail) call `consume(event)` for each
 * incoming event; the consumer batches into the buffer + decides when to
 * evaluate.
 */
export function subscribeSloStream(args: SubscribeSloStreamArgs): SloStreamConsumer {
  const {
    resolver,
    buffer,
    rollbackDeps,
    evaluateEveryNEvents = 10,
    monitorOptions = {},
    onReceipt,
  } = args;

  return Object.freeze({
    async consume(event: SloEvent): Promise<SloMonitorVerdict | null> {
      const slo = await resolver.resolve({
        subMd: event.subMd,
        metric: event.metric,
        tenantId: event.tenantId,
      });
      if (slo === null) return null;

      const key = bufferKey(event);
      await buffer.append(key, event);

      const since = await buffer.sinceLastEvaluate(key);
      if (since < evaluateEveryNEvents) return null;

      const window = await buffer.read(key);
      const verdict = evaluateSlo(slo, window, monitorOptions);
      await buffer.markEvaluated(key);

      if (verdict.action !== 'no-op') {
        const receipt = await executeAutoRollback(
          { slo, verdict },
          rollbackDeps,
        );
        if (onReceipt) await onReceipt(receipt);
      }

      return verdict;
    },
  });
}
