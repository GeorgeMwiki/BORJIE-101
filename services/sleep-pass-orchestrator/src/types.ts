/**
 * `@borjie/sleep-pass-orchestrator` — types.
 *
 * Heartbeat orchestrator runs off-peak passes. Each pass is a tiny
 * self-contained unit returning a deterministic PassResult. Adapters
 * (Drizzle, Redis, audit chain) are injected — never imported directly
 * — so unit tests use in-memory mocks and production wires real adapters
 * at the composition root.
 *
 * Structure inherited from a pre-fork lineage; evolved independently
 * as part of Borjie.
 */

/** ISO-8601 timestamp string. */
export type IsoTimestamp = string;

/** Pass id — kebab-case, stable across versions. */
export type PassId = string;

/** Per-pass schedule constraints. */
export interface PassSchedule {
  /** Cron-ish: 'hourly' | 'every-N-minutes' | 'daily-HH:MM' | 'weekly-DOW-HH:MM'. */
  readonly cadence:
    | { kind: 'every-minutes'; minutes: number }
    | { kind: 'hourly'; offsetMinutes: number }
    | { kind: 'daily'; hour: number; minute: number }
    | { kind: 'weekly'; dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number; minute: number };
  /** Minimum gap between runs, regardless of cadence. */
  readonly minIntervalMinutes: number;
  /** 1 = highest. Tie-broken by next-due time. */
  readonly priority: 1 | 2 | 3 | 4 | 5;
  /** Hard timeout for a single run. */
  readonly maxDurationMs: number;
}

/** Per-run inputs. */
export interface PassRunArgs {
  /** Cooperative abort — passes MUST check between expensive steps. */
  readonly abortSignal: AbortSignal;
  /** Clock injection so tests are deterministic. */
  readonly now: () => Date;
  /** Optional pass-specific config (e.g. lookback window). */
  readonly config?: Readonly<Record<string, unknown>>;
}

/** Per-run result. */
export interface PassResult {
  readonly passId: PassId;
  readonly itemsProcessed: number;
  readonly itemsEmitted: number;
  /** One-line summary persisted on the run row. */
  readonly notes: string;
  /** ISO timestamp the pass started. */
  readonly startedAt: IsoTimestamp;
  /** ISO timestamp the pass completed. */
  readonly completedAt: IsoTimestamp;
  /** True if the abort signal fired or the pass exceeded maxDurationMs. */
  readonly aborted: boolean;
  /** True if the pass threw — `notes` carries the error message. */
  readonly errored: boolean;
  /**
   * Optional "what the brain dreamed about" payloads. Persisted to
   * `brain_sleep_emissions` by {@link SleepRunStore.recordEmissions} so the
   * admin browse route can surface overnight findings. Existing passes that
   * don't emit anything simply omit this.
   */
  readonly emissions?: ReadonlyArray<SleepEmission>;
}

/** A single registered sleep pass. */
export interface SleepPass {
  readonly id: PassId;
  readonly schedule: PassSchedule;
  /** Implementation. */
  run(args: PassRunArgs): Promise<PassResult>;
}

/** Per-pass last-run state held by the orchestrator. */
export interface PassState {
  readonly lastRunAt: IsoTimestamp | null;
  readonly lastResult: PassResult | null;
  readonly nextDueAt: IsoTimestamp;
}

// ─────────────────────────────────────────────────────────────────────
// LP-21a — durable run + emission persistence
//
// The orchestrator used to keep all run state in an in-memory `Map`, so a
// crash (OOM, SIGKILL) lost every audit trail of what the brain did
// overnight, and a stuck `running` pass could silently starve later ticks.
// `SleepRunStore` bookends each pass with a `brain_sleep_runs` row
// (running → done/failed/timeout/skipped) and persists every emission to
// `brain_sleep_emissions`. The port is injected — tests use the in-memory
// store, production wires the Drizzle-backed adapter.
// ─────────────────────────────────────────────────────────────────────

/** Terminal status of a single pass run, persisted on the run row. */
export type SleepRunStatus = 'running' | 'done' | 'failed' | 'timeout' | 'skipped';

/** A single thing a pass "dreamed about" — surfaced by the admin browse route. */
export interface SleepEmission {
  /** kebab-case emission kind, e.g. `lesson`, `nudge`, `counterfactual`. */
  readonly kind: string;
  /** Arbitrary JSON payload — persisted verbatim into `emission_jsonb`. */
  readonly payload: unknown;
}

/** Fields written when a pass run reaches a terminal state. */
export interface SleepRunFinalize {
  readonly status: Exclude<SleepRunStatus, 'running'>;
  readonly itemsProcessed: number;
  readonly itemsEmitted: number;
  readonly durationMs: number;
  readonly notes: string;
  readonly errorText?: string;
}

/**
 * Durable store for sleep-pass runs + emissions.
 *
 * Implementations MUST be resilient: a persistence failure should never
 * crash the tick (passes still run; we just lose the audit row). All
 * methods therefore swallow their own errors and the run id is nullable.
 */
export interface SleepRunStore {
  /**
   * Insert a `running` row. Returns its id, or `null` when:
   *   - the insert failed (persistence is best-effort), or
   *   - a concurrent, still-fresh `running` row exists for this pass
   *     (single-flight skip — another worker is legitimately in flight).
   * A stale `running` row (older than the rescue window) is first reaped
   * to `failed` ("presumed crash") so the pass is never permanently wedged.
   */
  beginRun(passId: PassId): Promise<string | null>;
  /** Persist emissions for a run. No-op when `runId` is null or list empty. */
  recordEmissions(
    runId: string | null,
    emissions: ReadonlyArray<SleepEmission>,
  ): Promise<void>;
  /** Flip a run row to its terminal status. No-op when `runId` is null. */
  finalizeRun(runId: string | null, fin: SleepRunFinalize): Promise<void>;
  /** Most-recent `started_at` for a pass (drives min-interval skip). */
  lastRunAt(passId: PassId): Promise<IsoTimestamp | null>;
}

/** Per-pass run report returned by a budget-bounded tick. */
export interface PassRunReport {
  readonly passId: PassId;
  /** uuid of the `brain_sleep_runs` row; null when the row failed to insert. */
  readonly runId: string | null;
  readonly status: Exclude<SleepRunStatus, 'running'>;
  readonly itemsProcessed: number;
  readonly itemsEmitted: number;
  readonly durationMs: number;
  readonly notes: string;
  readonly errorText?: string;
}

/** Whole-tick report — one row per considered pass. */
export interface SleepTickReport {
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp;
  readonly overallBudgetMs: number;
  readonly runs: ReadonlyArray<PassRunReport>;
}

/** Heartbeat-tick output (one tick = one orchestrator decision cycle). */
export interface HeartbeatTick {
  readonly takenAt: IsoTimestamp;
  readonly considered: ReadonlyArray<PassId>;
  readonly dispatched: ReadonlyArray<PassId>;
  readonly skipped: ReadonlyArray<{ id: PassId; reason: string }>;
}

/** Composition-root inputs. */
export interface OrchestratorOptions {
  readonly passes: ReadonlyArray<SleepPass>;
  /** Default 60s. */
  readonly heartbeatIntervalMs?: number;
  /** Default uses Date(). */
  readonly now?: () => Date;
  /** Sink — orchestrator calls this for every dispatched pass result. */
  readonly resultSink?: (result: PassResult) => void;
  /** Sink — orchestrator calls this for every heartbeat tick decision. */
  readonly tickSink?: (tick: HeartbeatTick) => void;
}
