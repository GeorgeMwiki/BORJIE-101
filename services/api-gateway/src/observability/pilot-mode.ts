/**
 * Api-gateway pilot-mode bootstrap.
 *
 * Wires the platform's `@borjie/observability` Sentry client with the
 * pilot-mode flag so during the 3-5 pilot cohort window EVERY error
 * captured server-side carries the pilot cohort tag, the pilot user id,
 * and a wider trace sample rate (default 1.0).
 *
 * The OTel bootstrap still owns trace + metric pipelines (see
 * `otel-bootstrap.ts`). This module only configures the *Sentry* layer
 * — the two are deliberately separate so the OTel SDK can no-op
 * cleanly while Sentry runs at pilot fidelity.
 *
 * Behaviour
 * ─────────
 * - `SENTRY_DSN` set → calls `initSentry()` from `@borjie/observability`
 *   with the pilot-mode-resolved sample rate. The platform's Sentry
 *   client gracefully no-ops when `@sentry/node` is absent.
 * - `BORJIE_PILOT_MODE=true` and a cohort is set → every captured event
 *   carries `pilot_cohort`, `pilot_mode`, and (if known) `pilot_user_id`.
 * - Otherwise → defaults to the baseline 10% trace sample rate.
 *
 * Idempotent: calling `initPilotObservability()` twice is safe; the
 * second call returns the cached snapshot.
 */

import {
  buildPilotEventContext,
  initSentry,
  getSentry,
  isPilotMode,
  optionalEnv,
  readDefaultPilotCohort,
  resolvePilotSampleRate,
} from '@borjie/observability';

// Inline-typed mirrors of `@borjie/observability` public types — keeps the
// gateway's NodeNext resolver happy without forcing a build step on the
// package every typecheck.
interface LoggerContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
  sessionId?: string;
  attributes?: Record<string, unknown>;
}

interface SentryClient {
  captureException: (err: unknown, context?: LoggerContext) => void;
  captureMessage: (msg: string, context?: LoggerContext) => void;
  addBreadcrumb: (b: {
    category: string;
    message: string;
    level?: string;
  }) => void;
  flush: (timeoutMs?: number) => Promise<boolean>;
  isEnabled: () => boolean;
}

interface PilotObservabilitySnapshot {
  readonly sentry: SentryClient;
  readonly pilotMode: boolean;
  readonly cohort?: string;
  readonly tracesSampleRate: number;
}

let snapshot: PilotObservabilitySnapshot | null = null;

export interface InitPilotObservabilityOptions {
  readonly service?: string;
  readonly environment?: string;
  readonly release?: string;
  /** Override the DSN — primarily used by tests. */
  readonly dsn?: string;
}

/**
 * Initialise the pilot-aware Sentry client. Returns a frozen snapshot
 * the rest of the gateway can introspect (e.g. health probes can
 * report whether pilot mode is on).
 */
export async function initPilotObservability(
  options: InitPilotObservabilityOptions = {},
): Promise<PilotObservabilitySnapshot> {
  if (snapshot) return snapshot;
  const tracesSampleRate = resolvePilotSampleRate();
  const sentry = await initSentry({
    dsn: options.dsn ?? optionalEnv('SENTRY_DSN') ?? '',
    service: options.service ?? 'api-gateway',
    environment:
      options.environment ?? optionalEnv('NODE_ENV') ?? 'production',
    release: options.release ?? optionalEnv('GIT_SHA'),
    tracesSampleRate,
  });
  snapshot = Object.freeze({
    sentry,
    pilotMode: isPilotMode(),
    cohort: readDefaultPilotCohort(),
    tracesSampleRate,
  });
  return snapshot;
}

/**
 * Reset the cached snapshot. Tests only — production should never call
 * this. Exposed so `__tests__/pilot-mode.test.ts` (if added later) can
 * reinitialise after env mutation.
 */
export function __resetPilotObservabilityForTests(): void {
  snapshot = null;
}

/**
 * Build a logger-context bundle for the supplied request scope. The
 * shape matches `LoggerContext` from `@borjie/observability` so it can
 * be passed straight to `client.captureException(err, ctx)`.
 */
export function buildPilotLoggerContext(input: {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly requestId?: string;
  readonly cohort?: string;
  readonly replaySessionId?: string;
  readonly route?: string;
}): LoggerContext {
  const cohort = input.cohort ?? snapshot?.cohort;
  const ctx = buildPilotEventContext({
    pilotUserId: input.userId,
    pilotCohort: cohort,
    replaySessionId: input.replaySessionId,
  });
  return {
    ...(input.tenantId && { tenantId: input.tenantId }),
    ...(input.userId && { userId: input.userId }),
    ...(input.requestId && { requestId: input.requestId }),
    attributes: {
      ...ctx.tags,
      ...ctx.extra,
      ...(input.route && { route: input.route }),
    },
  };
}

/**
 * Capture an error with pilot-aware context. Safe to call before
 * `initPilotObservability()` has resolved — falls back to the platform
 * Sentry client's no-op shape. Also appends to the in-memory pilot
 * sink so the /pilot/errors endpoint can serve it without an external
 * store dependency.
 */
export function captureErrorWithPilotContext(
  err: unknown,
  input: Parameters<typeof buildPilotLoggerContext>[0],
): void {
  const client = snapshot?.sentry ?? getSentry();
  client.captureException(err, buildPilotLoggerContext(input));
  const sinkInput: PilotErrorAppendInput = {
    err,
    ...(input.cohort && { cohort: input.cohort }),
    ...(input.userId && { userId: input.userId }),
    ...(input.tenantId && { tenantId: input.tenantId }),
    ...(input.route && { route: input.route }),
    ...(input.replaySessionId && {
      extra: { replaySessionId: input.replaySessionId },
    }),
  };
  appendPilotError(sinkInput);
}

/**
 * Capture an informational message with pilot-aware context.
 */
export function captureMessageWithPilotContext(
  msg: string,
  input: Parameters<typeof buildPilotLoggerContext>[0],
): void {
  const client = snapshot?.sentry ?? getSentry();
  client.captureMessage(msg, buildPilotLoggerContext(input));
}

/**
 * Returns the cached snapshot or `null` when bootstrap has not run.
 */
export function getPilotObservabilitySnapshot(): PilotObservabilitySnapshot | null {
  return snapshot;
}

// ─────────────────────────────────────────────────────────────────────────
// Pilot-error in-memory sink
// ─────────────────────────────────────────────────────────────────────────
//
// During the pilot window we run a bounded ring buffer of captured
// errors so the /api/v1/pilot/errors dashboard can serve them WITHOUT
// requiring an external store (Sentry, Loki, etc.). This is deliberately
// pilot-scope only — 5 users * realistic error volume comfortably fits
// in the default 500-event buffer.
//
// The Sentry forwarding path remains the canonical long-term store; this
// sink is the FALLBACK so QA and pilot leads can pull "show me the last
// hour of errors per cohort" without standing up infrastructure.
//
// Tests can reset via `__resetPilotErrorSinkForTests()`.

export interface PilotErrorRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly message: string;
  readonly cohort?: string;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly route?: string;
  readonly stack?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

const DEFAULT_MAX_BUFFER = 500;

interface SinkState {
  buffer: PilotErrorRecord[];
  maxSize: number;
  nextId: number;
}

const sinkState: SinkState = {
  buffer: [],
  maxSize: DEFAULT_MAX_BUFFER,
  nextId: 1,
};

export interface PilotErrorAppendInput {
  readonly err: unknown;
  readonly cohort?: string;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly route?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
  /** Override the timestamp — tests only. */
  readonly timestamp?: string;
}

/**
 * Append an error record to the in-memory sink. Bounded — when the
 * buffer overflows the oldest record is dropped (FIFO).
 */
export function appendPilotError(input: PilotErrorAppendInput): PilotErrorRecord {
  const id = `pe_${sinkState.nextId++}`;
  const message =
    input.err instanceof Error ? input.err.message : String(input.err);
  const stack = input.err instanceof Error ? input.err.stack : undefined;
  const cohort = input.cohort ?? snapshot?.cohort;
  const record: PilotErrorRecord = Object.freeze({
    id,
    timestamp: input.timestamp ?? new Date().toISOString(),
    message,
    ...(cohort && { cohort }),
    ...(input.userId && { userId: input.userId }),
    ...(input.tenantId && { tenantId: input.tenantId }),
    ...(input.route && { route: input.route }),
    ...(stack && { stack }),
    ...(input.extra && { extra: Object.freeze({ ...input.extra }) }),
  });
  // Immutable append — replace the buffer with a new array.
  const next = sinkState.buffer.concat(record);
  sinkState.buffer =
    next.length > sinkState.maxSize
      ? next.slice(next.length - sinkState.maxSize)
      : next;
  return record;
}

export interface QueryPilotErrorsOptions {
  readonly since?: string;
  readonly cohort?: string;
  readonly limit?: number;
}

export interface QueryPilotErrorsResult {
  readonly items: ReadonlyArray<PilotErrorRecord>;
  readonly byCohort: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * Query the in-memory sink. Filters are AND-combined.
 *
 * @param opts.since — ISO timestamp; records with `timestamp >= since`
 *   are returned. Invalid timestamps are silently ignored.
 * @param opts.cohort — exact-match cohort filter.
 * @param opts.limit — caps the returned items (default 100, max 500).
 */
export function queryPilotErrors(
  opts: QueryPilotErrorsOptions = {},
): QueryPilotErrorsResult {
  const sinceMs =
    opts.since && !Number.isNaN(Date.parse(opts.since))
      ? Date.parse(opts.since)
      : undefined;
  const cohort = opts.cohort?.trim();
  const limit = clampLimit(opts.limit);

  const filtered = sinkState.buffer.filter((rec) => {
    if (sinceMs !== undefined) {
      const ts = Date.parse(rec.timestamp);
      if (Number.isNaN(ts) || ts < sinceMs) return false;
    }
    if (cohort && rec.cohort !== cohort) return false;
    return true;
  });

  // Most-recent first, then cap.
  const ordered = filtered.slice().reverse();
  const items = ordered.slice(0, limit);

  const byCohort: Record<string, number> = {};
  for (const rec of filtered) {
    const key = rec.cohort ?? '(unknown)';
    byCohort[key] = (byCohort[key] ?? 0) + 1;
  }

  return Object.freeze({
    items: Object.freeze(items),
    byCohort: Object.freeze(byCohort),
    total: filtered.length,
  });
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return 100;
  if (!Number.isFinite(limit) || limit < 1) return 100;
  if (limit > 500) return 500;
  return Math.floor(limit);
}

/**
 * Returns the configured buffer ceiling. Used by health probes.
 */
export function getPilotErrorBufferLimit(): number {
  return sinkState.maxSize;
}

/**
 * Reset the in-memory pilot-error sink. Tests only.
 */
export function __resetPilotErrorSinkForTests(maxSize?: number): void {
  sinkState.buffer = [];
  sinkState.nextId = 1;
  if (maxSize !== undefined) sinkState.maxSize = maxSize;
}
