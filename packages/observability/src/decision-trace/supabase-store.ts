/**
 * Supabase persistence adapter for DecisionTrace.
 *
 * Production-grade backing store for {@link DecisionTraceStore}. Writes
 * each finalised trace to the `decision_traces` table; reads use the
 * service-role client because the admin replay UI is a platform-staff
 * surface and bypasses tenant RLS by design.
 *
 * Design contract:
 *   - `save()` is fire-and-forget with three retry attempts (250ms,
 *     500ms, 1000ms backoff). After three failures the trace is dropped
 *     and a single warning is logged. We DO NOT block the decision path
 *     on storage availability — a brain turn must not 500 because the
 *     audit log is degraded.
 *   - `save()` is idempotent on `trace_id` (UNIQUE constraint). Upsert
 *     with `ignoreDuplicates: true` so a retried publish does not throw.
 *   - `load()` returns `null` on miss / on any error. The admin UI
 *     surfaces 404 on null — never crashes.
 *   - Adapter is hexagonal: takes a minimal client interface (no hard
 *     dependency on @supabase/supabase-js) so tests can pass a mock.
 *
 * @module packages/observability/src/decision-trace/supabase-store
 */

import type { DecisionTraceStore } from './persistence-port.js';
import type { DecisionTraceFinalised } from './types.js';

/**
 * Minimal Supabase client surface we depend on. Mirrors the subset of
 * `SupabaseClient` we actually use so tests can inject a mock without
 * pulling in the real package.
 */
export interface SupabaseLikeClient {
  from(table: string): SupabaseLikeQueryBuilder;
}

/** Insert/select query builder shape. */
export interface SupabaseLikeQueryBuilder {
  insert(
    rows: ReadonlyArray<Record<string, unknown>>,
    options?: { upsert?: boolean; onConflict?: string; ignoreDuplicates?: boolean },
  ): Promise<{ error: { message: string } | null }>;
  select(columns: string): SupabaseLikeQueryBuilder;
  eq(column: string, value: string): SupabaseLikeQueryBuilder;
  maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
}

/** Minimal logger surface — Pino-compatible. */
export interface SupabaseStoreLogger {
  warn(meta: Record<string, unknown>, msg: string): void;
}

const NOOP_LOGGER: SupabaseStoreLogger = {
  warn: () => {
    /* no-op */
  },
};

/** Options for {@link SupabaseDecisionTraceStore}. */
export interface SupabaseDecisionTraceStoreOptions {
  /** Service-role Supabase client (bypasses RLS — admin replay surface). */
  readonly client: SupabaseLikeClient;
  /** Table name override. Defaults to `decision_traces`. */
  readonly tableName?: string;
  /** Logger for the drop-after-3-retries warning. */
  readonly logger?: SupabaseStoreLogger;
  /** Test seam — base backoff in ms. Defaults to 250. */
  readonly backoffBaseMs?: number;
  /** Test seam — sleep override. Defaults to `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TABLE = 'decision_traces';
const DEFAULT_BACKOFF_MS = 250;
const MAX_ATTEMPTS = 3;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Postgres row shape for `decision_traces`. Mirrors the migration
 * schema. Snake_case keys to match the Postgres column names so the
 * Supabase REST API can round-trip without renaming.
 */
interface DecisionTraceRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly name: string;
  readonly started_at: string;
  readonly finalised_at: string;
  readonly duration_ms: number;
  readonly inputs: Record<string, unknown>;
  readonly branches: ReadonlyArray<Record<string, unknown>>;
  readonly chosen_branch_id: string | null;
  readonly chosen_rationale: string | null;
  readonly outcome: string;
  readonly attributes: Record<string, unknown>;
  readonly output: unknown;
  readonly error: string | null;
  readonly user_id: string | null;
  readonly request_id: string | null;
  readonly parent_trace_id: string | null;
}

/**
 * Project a {@link DecisionTraceFinalised} snapshot to the row shape we
 * insert. Branch arrays + jsonb columns round-trip as plain JSON values.
 */
function toRow(trace: DecisionTraceFinalised): DecisionTraceRow {
  return {
    id: trace.traceId,
    tenant_id: trace.context.tenantId ?? null,
    name: trace.name,
    started_at: trace.startedAt,
    finalised_at: trace.finalisedAt,
    duration_ms: trace.durationMs,
    inputs: { ...trace.inputs },
    branches: trace.branches.map((b) => ({ ...b })),
    chosen_branch_id: trace.chosenBranchId,
    chosen_rationale: trace.chosenRationale,
    outcome: trace.outcome,
    attributes: { ...(trace.context.attributes ?? {}) },
    output: trace.output,
    error: trace.error,
    user_id: trace.context.userId ?? null,
    request_id: trace.context.requestId ?? null,
    parent_trace_id: trace.context.parentTraceId ?? null,
  };
}

/**
 * Hydrate a row read from Postgres into an immutable
 * {@link DecisionTraceFinalised}. Used by `load()`.
 */
function fromRow(row: Record<string, unknown>): DecisionTraceFinalised | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const traceId = typeof r.id === 'string' ? r.id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  const startedAt = typeof r.started_at === 'string' ? r.started_at : null;
  const finalisedAt = typeof r.finalised_at === 'string' ? r.finalised_at : null;
  if (!traceId || !name || !startedAt || !finalisedAt) return null;
  return Object.freeze({
    traceId,
    name,
    startedAt,
    finalisedAt,
    durationMs:
      typeof r.duration_ms === 'number' && Number.isFinite(r.duration_ms)
        ? r.duration_ms
        : 0,
    context: Object.freeze({
      tenantId: typeof r.tenant_id === 'string' ? r.tenant_id : undefined,
      userId: typeof r.user_id === 'string' ? r.user_id : undefined,
      requestId: typeof r.request_id === 'string' ? r.request_id : undefined,
      parentTraceId:
        typeof r.parent_trace_id === 'string' ? r.parent_trace_id : undefined,
      attributes: Object.freeze(
        (r.attributes && typeof r.attributes === 'object'
          ? (r.attributes as Record<string, unknown>)
          : {}) as Record<string, unknown>,
      ),
    }),
    inputs: Object.freeze(
      (r.inputs && typeof r.inputs === 'object'
        ? (r.inputs as Record<string, unknown>)
        : {}) as Record<string, unknown>,
    ),
    branches: Object.freeze(
      Array.isArray(r.branches)
        ? (r.branches as ReadonlyArray<Record<string, unknown>>).map((b) =>
            Object.freeze({
              id: String((b as { id?: unknown }).id ?? ''),
              label: String((b as { label?: unknown }).label ?? ''),
              rationale: String((b as { rationale?: unknown }).rationale ?? ''),
              ...(typeof (b as { score?: unknown }).score === 'number'
                ? { score: (b as { score: number }).score }
                : {}),
              ...((b as { metadata?: unknown }).metadata !== undefined
                ? {
                    metadata: Object.freeze({
                      ...((b as { metadata: Record<string, unknown> }).metadata ??
                        {}),
                    }),
                  }
                : {}),
              recordedAt: String(
                (b as { recordedAt?: unknown }).recordedAt ?? '',
              ),
            }),
          )
        : [],
    ),
    chosenBranchId:
      typeof r.chosen_branch_id === 'string' ? r.chosen_branch_id : null,
    chosenRationale:
      typeof r.chosen_rationale === 'string' ? r.chosen_rationale : null,
    outcome: (typeof r.outcome === 'string'
      ? r.outcome
      : 'failed') as DecisionTraceFinalised['outcome'],
    output: r.output === undefined ? null : r.output,
    error: typeof r.error === 'string' ? r.error : null,
  });
}

/**
 * Supabase-backed implementation of {@link DecisionTraceStore}. Production
 * code wires this at startup via {@link setDefaultDecisionTraceStore}.
 */
export class SupabaseDecisionTraceStore implements DecisionTraceStore {
  private readonly client: SupabaseLikeClient;
  private readonly tableName: string;
  private readonly logger: SupabaseStoreLogger;
  private readonly backoffBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SupabaseDecisionTraceStoreOptions) {
    if (!options.client) {
      throw new Error('SupabaseDecisionTraceStore: client is required');
    }
    this.client = options.client;
    this.tableName = options.tableName ?? DEFAULT_TABLE;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Fire-and-forget persistence with retry. The factory's `finalize()`
   * calls this inside a `void store.save(...).catch(() => {})` so any
   * throw here is swallowed by the caller; we still capture errors in
   * the retry loop so we can log a single warning when we finally drop.
   *
   * Returns when the trace is persisted OR when the retry budget is
   * exhausted. Never throws — that contract is load-bearing for the
   * decision path.
   */
  async save(trace: DecisionTraceFinalised): Promise<void> {
    const row = toRow(trace);

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const { error } = await this.client.from(this.tableName).insert(
          [row as unknown as Record<string, unknown>],
          {
            upsert: true,
            onConflict: 'id',
            // Idempotent: a retried publish of the same id is a no-op.
            ignoreDuplicates: true,
          },
        );
        if (!error) return;
        lastError = error.message;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff: 250ms, 500ms, then 1000ms before drop.
        await this.sleep(this.backoffBaseMs * 2 ** (attempt - 1));
      }
    }

    // Three failures — drop the trace and log a single warning. We
    // include the trace id so an operator can chase it via OTel spans.
    this.logger.warn(
      {
        component: 'decision-trace.supabase-store',
        traceId: trace.traceId,
        tenantId: trace.context.tenantId ?? null,
        outcome: trace.outcome,
        attempts: MAX_ATTEMPTS,
        lastError,
      },
      'decision-trace: dropping trace after retries exhausted',
    );
  }

  /**
   * Read by trace id. Service-role bypasses RLS. Returns `null` on
   * miss OR on any failure — the admin UI maps null to a 404.
   */
  async load(traceId: string): Promise<DecisionTraceFinalised | null> {
    if (typeof traceId !== 'string' || traceId.length === 0) return null;
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('id', traceId)
        .maybeSingle();
      if (error || !data) return null;
      return fromRow(data);
    } catch (err) {
      this.logger.warn(
        {
          component: 'decision-trace.supabase-store',
          traceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'decision-trace: load failed',
      );
      return null;
    }
  }
}
