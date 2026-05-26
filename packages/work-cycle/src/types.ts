/**
 * `@borjie/work-cycle` — public type surface.
 *
 * Companion to `Docs/DESIGN/CONTINUOUS_24_7_WORK_CYCLE_SPEC.md`.
 *
 * Mr. Mwikila's continuous 24/7 work loop. Every type here is immutable
 * (`readonly`) — ticks, journal entries, briefs are projections; the
 * spinal column is the append-only `work_cycle_journal` table.
 *
 * Persona naming invariant: anything user-facing references "Mr. Mwikila"
 * exclusively. Internal routing metadata may reference junior
 * specialisations (e.g. `junior-fx-treasury`) but those identifiers
 * never appear in `ResumptionBrief.headline` or in `TickOutput.summary`.
 * The `assertNoJuniorLeak` helper enforces this in tests.
 */

// ---------------------------------------------------------------------------
// Cadence + mode
// ---------------------------------------------------------------------------

export const WORK_CYCLE_MODES = ['active', 'idle', 'night', 'observe'] as const;

export type WorkCycleMode = (typeof WORK_CYCLE_MODES)[number];

/**
 * Default cadence per mode, in milliseconds. Aligned with spec §4.
 *
 *   active  → 30 s   (owner in app)
 *   idle    →  5 min (app closed but daytime + reachable)
 *   night   → 15 min (owner-local 22:00–06:00 OR DND)
 *   observe → 60 min (cost cap reached OR weekday off)
 */
export const DEFAULT_CADENCE_MS: Readonly<Record<WorkCycleMode, number>> =
  Object.freeze({
    active: 30_000,
    idle: 5 * 60_000,
    night: 15 * 60_000,
    observe: 60 * 60_000,
  });

// ---------------------------------------------------------------------------
// Tick I/O
// ---------------------------------------------------------------------------

/**
 * Inputs into a tick. Frozen at run-start so the journal records the
 * exact decision input. `recall` is the cognitive-memory recall set;
 * `pending_threads` is the slow-burn investigation list from
 * `work_cycle_state`.
 */
export interface TickInput {
  readonly tenant_id: string;
  readonly tick_no: bigint;
  readonly mode: WorkCycleMode;
  readonly last_hash: string | null;
  readonly recall: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly pending_threads: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
  }>;
  readonly clock_iso: string;
}

/**
 * Output of a tick. `status` discriminates success vs failure;
 * `requires_owner_attention` surfaces to the next `ResumptionBrief`
 * `awaiting_approval` bucket.
 */
export interface TickOutput {
  readonly status: 'completed' | 'failed' | 'skipped';
  readonly kind:
    | 'sweep'
    | 'review'
    | 'draft'
    | 'watch'
    | 'investigate'
    | 'mode_transition';
  readonly summary: string;
  readonly reason?: string;
  readonly artifact_refs: ReadonlyArray<{
    readonly kind: string;
    readonly id: string;
  }>;
  readonly requires_owner_attention: boolean;
}

/**
 * One indivisible work pulse — the unit the scheduler emits and the
 * runner consumes. The runner returns a JournalEntry, not a Tick;
 * `WorkCycleTick` is the input + output projection used by tests and
 * by the budget gate's estimator.
 */
export interface WorkCycleTick {
  readonly input: TickInput;
  readonly output: TickOutput;
  readonly cost_usd_cents: number;
  readonly started_at: string;
  readonly ended_at: string;
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/**
 * Append-only journal row. The hash chain links via
 * `prev_hash` (last entry's `audit_hash`) + `audit_hash`
 * (sha256(canonical_json({prev, payload}))).
 *
 * `tick_no` is monotone per tenant. The DB enforces uniqueness on
 * `(tenant_id, tick_no)` — a re-run after crash rejects the duplicate.
 */
export interface JournalEntry {
  readonly id: string;
  readonly tenant_id: string;
  readonly tick_no: bigint;
  readonly started_at: string;
  readonly ended_at: string;
  readonly mode: WorkCycleMode;
  readonly inputs: TickInput;
  readonly outputs: TickOutput;
  readonly cost_usd_cents: number;
  readonly audit_hash: string;
  readonly prev_hash: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Per-tenant state row. Updated atomically with each journal append.
 */
export interface WorkCycleState {
  readonly tenant_id: string;
  readonly last_tick_no: bigint;
  readonly last_tick_at: string | null;
  readonly current_mode: WorkCycleMode;
  readonly pending_threads: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
  }>;
}

// ---------------------------------------------------------------------------
// Resumption
// ---------------------------------------------------------------------------

/**
 * Token-budgeted resumption brief. Produced deterministically from the
 * last K journal entries — no LLM call on the critical path. See spec
 * §6 (MemGPT-style main-context / external-memory paging).
 */
export interface ResumptionBrief {
  readonly headline: string;
  readonly pending_threads: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
  }>;
  readonly completed_overnight: ReadonlyArray<string>;
  readonly awaiting_approval: ReadonlyArray<string>;
  readonly escalations: ReadonlyArray<string>;
  readonly last_tick_at: string | null;
  readonly token_estimate: number;
}

// ---------------------------------------------------------------------------
// Mutation-authority tier
// ---------------------------------------------------------------------------

export const MUTATION_TIERS = [
  't0', // read-only
  't1', // drafts
  't2', // decisions with external impact
  't2-critical', // irreversible / killswitch
] as const;

export type MutationTier = (typeof MUTATION_TIERS)[number];

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class WorkCycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkCycleError';
  }
}

// ---------------------------------------------------------------------------
// Logger port — structurally compatible with `@borjie/observability`
// ---------------------------------------------------------------------------

/**
 * Minimal logger surface. Compatible with the `Logger` returned by
 * `@borjie/observability/createLogger` (Pino-backed) when present, and
 * with a no-op stand-in when the package is not wired.
 */
export interface WorkCycleLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(
    message: string,
    error?: Error | Record<string, unknown>,
    data?: Record<string, unknown>,
  ): void;
}

export function noopLogger(): WorkCycleLogger {
  return {
    info() {
      /* no-op */
    },
    warn() {
      /* no-op */
    },
    error() {
      /* no-op */
    },
  };
}
