/**
 * Outcome recorder — closes the predicted-vs-actual feedback loop
 * (Reflexion-style). Each record is immutable and gets a
 * Reflexion-style critique tag the MD reads back when re-running the
 * redesign stage.
 *
 * Phase E.5.3 wires this to the autonomy-governance SloEvent stream. The
 * `SloEventSink` port is OPTIONAL — when injected, every recorded outcome
 * fans out an SloEvent so the live SLO monitor can demote / rollback
 * misbehaving sub-MDs in real time.
 *
 * To avoid a circular workspace dep between this package and
 * `@borjie/autonomy-governance`, the SloEvent shape is mirrored here
 * structurally. The autonomy-governance side accepts `SloEvent` and is
 * structurally compatible (verified by the cross-package integration
 * test in `packages/autonomy-governance/src/slo/__tests__/slo-stream.test.ts`).
 */

import type { ActualOutcome, PredictedOutcome } from './sub-md-base.js';

export interface OutcomeRecord {
  readonly subMdName: string;
  readonly predicted: PredictedOutcome;
  readonly actual: ActualOutcome;
  /** signed error (actual - predicted) in predicted units. */
  readonly delta: number;
  /** absolute error / predicted magnitude. Clamped to [0, 10]. */
  readonly relativeError: number;
  readonly verdict: 'on-target' | 'under-performed' | 'over-performed';
  readonly recordedAtMs: number;
}

export interface OutcomeRecorderSink {
  record(rec: OutcomeRecord): Promise<void>;
}

/**
 * Structural mirror of
 * `@borjie/autonomy-governance:SloEvent`. The autonomy-governance
 * stream consumer accepts this shape verbatim.
 *
 * `metric` is restricted to the 4 SloMetric values the autonomy-governance
 * package recognises. `outcome-recorder` emits `task-completion-rate` by
 * default because that's the metric every sub-MD always produces (every
 * recorded outcome is by definition a completion event).
 */
export interface SubMdSloEvent {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly timestamp: string;
  readonly metric:
    | 'resolution-quality'
    | 'task-completion-rate'
    | 'owner-cs-score'
    | 'cost-per-resolution';
  readonly actualValue: number;
  readonly predictedValue?: number;
  readonly delta: number;
}

/**
 * Port for fanning out per-outcome SLO events. Default in tests is
 * `undefined` (no-op). Production composition (kernel boot) wires this
 * to the autonomy-governance stream sink.
 */
export interface SloEventSink {
  emit(event: SubMdSloEvent): Promise<void>;
}

export interface OutcomeRecorderOptions {
  /** Tenant scope tag; passed through to every emitted SloEvent. */
  readonly tenantId?: string | null;
  /** SLO event stream sink — optional. When omitted, no events are emitted. */
  readonly sloEventSink?: SloEventSink;
  /**
   * HIGH-B — when true, an SloEvent emission failure throws.
   * When false (default), the failure is logged via `logger.error` but
   * the recorded outcome still returns successfully.
   *
   * Persistence (the `sink.record(rec)` write) is ALWAYS independent
   * of the SloEvent emission. If `sink.record` throws, we attempt the
   * SloEvent emit anyway so auto-rollback breach detection isn't
   * silently swallowed when the audit sink is down.
   */
  readonly failFast?: boolean;
  /** Optional logger port for partial-failure surfaces. */
  readonly logger?: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface OutcomeRecorder {
  record(args: {
    readonly subMdName: string;
    readonly predicted: PredictedOutcome;
    readonly actual: ActualOutcome;
  }): Promise<OutcomeRecord>;
  history(): ReadonlyArray<OutcomeRecord>;
}

const ON_TARGET_BAND = 0.1;

/**
 * Map the recorded outcome onto an SloEvent. The conversion rule:
 *
 *   actualValue   = actual.value
 *   predictedValue = predicted.value
 *   delta         = computed against an implicit target of `predicted.value`
 *                   (the sub-MD's own forecast), sign-flipped for cost-style
 *                   metrics so "negative delta = breach" holds.
 *
 * The default `metric` is `task-completion-rate` — every outcome record IS
 * a task completion. Callers that want a different metric can override via
 * the explicit `metric` property on the actual outcome's unit field
 * (`unit === 'usd-cents'` → `cost-per-resolution`).
 */
function outcomeToSloEvent(args: {
  readonly subMdName: string;
  readonly predicted: PredictedOutcome;
  readonly actual: ActualOutcome;
  readonly tenantId: string | null;
}): SubMdSloEvent {
  const { subMdName, predicted, actual, tenantId } = args;

  // Pick metric: heuristic — units of `usd-cents` are cost; quality-like
  // units (`score`, `ratio`, anything ≤1) are resolution-quality; default
  // is task-completion-rate.
  let metric: SubMdSloEvent['metric'] = 'task-completion-rate';
  if (actual.unit === 'usd-cents' || predicted.unit === 'usd-cents') {
    metric = 'cost-per-resolution';
  } else if (actual.unit === 'score' || actual.unit === 'ratio') {
    metric = 'resolution-quality';
  }

  // Delta convention: for higher-is-better metrics, delta = actual - target.
  // We use the sub-MD's own prediction as the local target. For
  // cost-per-resolution (lower is better), flip the sign.
  const rawDelta = actual.value - predicted.value;
  const delta = metric === 'cost-per-resolution' ? -rawDelta : rawDelta;

  return Object.freeze({
    subMd: subMdName,
    tenantId,
    timestamp: new Date(actual.recordedAtMs).toISOString(),
    metric,
    actualValue: actual.value,
    predictedValue: predicted.value,
    delta,
  });
}

/**
 * H5 — Single-options signature for `createOutcomeRecorder`. The
 * canonical recommended shape going forward is:
 *
 *   createOutcomeRecorder({ sink, sloEventSink, tenantId, failFast, logger })
 *
 * The two-arg legacy signature `(sink, options?)` remains for one
 * release but is `@deprecated` — the discriminator is fragile because a
 * future `OutcomeRecorderOptions` could grow a `.record` method and the
 * structural `isSink` check would misclassify the options object as a
 * sink. The new options interface is explicit and futureproof.
 */
export interface OutcomeRecorderOptionsV2 extends OutcomeRecorderOptions {
  /** Persistence sink. Optional — when omitted, only the in-memory
   *  history + sloEventSink (if present) is updated. */
  readonly sink?: OutcomeRecorderSink;
}

export function createOutcomeRecorder(
  sinkOrOptions?:
    | OutcomeRecorderSink
    | OutcomeRecorderOptions
    | OutcomeRecorderOptionsV2,
  legacyOptions?: OutcomeRecorderOptions,
): OutcomeRecorder {
  // H5 — Discriminator hardened. The new canonical shape carries `sink`
  // as a property; the legacy two-arg signature passes the sink as the
  // first argument. We test for the new shape FIRST (presence of any
  // OutcomeRecorderOptions key) so an options object that happens to
  // expose `record` does NOT get classified as a sink.
  //
  // Backwards-compatible signature precedence:
  //   createOutcomeRecorder()                       — no args
  //   createOutcomeRecorder({ sink, ... })          — canonical (v2)
  //   createOutcomeRecorder({ tenantId, ... })      — legacy options
  //   createOutcomeRecorder(sink)                   — legacy sink-arg
  //   createOutcomeRecorder(sink, options)          — legacy two-arg
  let sink: OutcomeRecorderSink | undefined;
  let options: OutcomeRecorderOptions;
  if (sinkOrOptions === undefined) {
    sink = undefined;
    options = {};
  } else if (isOptionsObject(sinkOrOptions)) {
    const v2 = sinkOrOptions as OutcomeRecorderOptionsV2;
    sink = v2.sink;
    options = sinkOrOptions;
  } else if (isSink(sinkOrOptions)) {
    sink = sinkOrOptions;
    options = legacyOptions ?? {};
  } else {
    sink = undefined;
    options = sinkOrOptions ?? {};
  }
  const tenantId: string | null = options.tenantId ?? null;
  const sloEventSink = options.sloEventSink;
  const failFast = options.failFast ?? false;
  const logger = options.logger;

  const history: OutcomeRecord[] = [];
  return {
    async record(args) {
      const { subMdName, predicted, actual } = args;
      const delta = actual.value - predicted.value;
      const denom = Math.abs(predicted.value) < 1e-6 ? 1 : Math.abs(predicted.value);
      const relativeError = Math.min(10, Math.abs(delta) / denom);
      const verdict: OutcomeRecord['verdict'] =
        relativeError <= ON_TARGET_BAND
          ? 'on-target'
          : delta < 0
            ? 'under-performed'
            : 'over-performed';
      const rec: OutcomeRecord = Object.freeze({
        subMdName,
        predicted: Object.freeze({ ...predicted }),
        actual: Object.freeze({ ...actual }),
        delta,
        relativeError,
        verdict,
        recordedAtMs: actual.recordedAtMs,
      });
      history.push(rec);

      // HIGH-B — Persist + emit are now INDEPENDENT. If persistence
      // throws, we still attempt the SLO event emission (so the
      // auto-rollback monitor still observes the breach). If the SLO
      // event emission throws, we either log + swallow (default) or
      // rethrow when `failFast` is true.
      //
      // Both writes use `Promise.allSettled` so each gets independently
      // attempted regardless of the other's outcome.
      const tasks: Promise<unknown>[] = [];
      if (sink) tasks.push(sink.record(rec));
      if (sloEventSink) {
        const event = outcomeToSloEvent({
          subMdName,
          predicted,
          actual,
          tenantId,
        });
        tasks.push(sloEventSink.emit(event));
      }
      const settled = await Promise.allSettled(tasks);

      const failures = settled
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.status === 'rejected');

      if (failures.length > 0) {
        for (const { r, i } of failures) {
          const reason =
            r.status === 'rejected'
              ? r.reason instanceof Error
                ? r.reason.message
                : String(r.reason)
              : '';
          const which = sink && i === 0 ? 'persistence-sink' : 'slo-event-sink';
          if (logger) {
            logger.error(`outcome-recorder.${which} failed`, {
              subMdName,
              reason,
            });
          }
        }
        if (failFast) {
          // Surface the first failure when caller opts in.
          const first = failures[0]?.r;
          if (first && first.status === 'rejected') {
            throw first.reason instanceof Error
              ? first.reason
              : new Error(String(first.reason));
          }
        }
      }
      return rec;
    },
    history() {
      return Object.freeze(history.slice());
    },
  };
}

function isSink(x: unknown): x is OutcomeRecorderSink {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { record?: unknown }).record === 'function' &&
    typeof (x as { emit?: unknown }).emit !== 'function'
  );
}

/**
 * H5 — Identify the new canonical options-object shape. The shape is
 * recognised by the presence of ANY known options field
 * (`sink`, `sloEventSink`, `tenantId`, `failFast`, `logger`). A sink
 * object that has only a `.record` method does NOT match because
 * `record` is not in the recognised key set.
 *
 * Note: we deliberately do NOT consider an object "options-shaped" just
 * because it lacks `.record`; that would silently accept any random
 * input as options. The presence of at least one named option key is
 * required.
 */
function isOptionsObject(x: unknown): x is OutcomeRecorderOptionsV2 {
  if (typeof x !== 'object' || x === null) return false;
  const obj = x as Record<string, unknown>;
  return (
    'sink' in obj ||
    'sloEventSink' in obj ||
    'tenantId' in obj ||
    'failFast' in obj ||
    'logger' in obj
  );
}
