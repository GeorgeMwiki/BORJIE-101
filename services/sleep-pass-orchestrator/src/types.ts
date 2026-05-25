/**
 * `@borjie/sleep-pass-orchestrator` — types.
 *
 * Heartbeat orchestrator runs off-peak passes. Each pass is a tiny
 * self-contained unit returning a deterministic PassResult. Adapters
 * (Drizzle, Redis, audit chain) are injected — never imported directly
 * — so unit tests use in-memory mocks and production wires real adapters
 * at the composition root.
 *
 * Ported from LITFIN PROJECT/src/core/heartbeat/sleep-passes.
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
