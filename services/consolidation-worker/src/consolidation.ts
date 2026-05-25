/**
 * Consolidation worker — core ingestion logic.
 *
 * LITFIN parity gap A (`.planning/parity-litfin/02-memory-learning.md`):
 *   BORJIE built `runConsolidationCycle` but it had no scheduler.
 *   This worker is the scheduler — it pulls the last 24h of unconsumed
 *   CoT-reservoir rows, groups them by (tenantId, userId), and persists
 *   one semantic fact per N grouped turns. Marks the consumed rows so
 *   they aren't re-processed the next tick.
 *
 * Design notes:
 *
 *   - Storage is abstracted by ports (`ReservoirSource`, `SemanticSink`,
 *     `ConsolidatorPort`) so this module compiles + tests without ever
 *     touching @borjie/database. The composition root in
 *     `services/consolidation-worker/src/index.ts` is the only place
 *     that wires real Drizzle adapters.
 *
 *   - Hard errors at any port DEGRADE the worker to a no-op for that
 *     scope: a write failure in tenant A must not block tenant B, and
 *     a consolidator throw must not leave half-marked rows. The worker
 *     never crashes — the next tick retries.
 *
 *   - `consolidated_at` is the worker's idempotency cursor: only rows
 *     where `consolidated_at IS NULL` are picked up. Marking is done
 *     after the semantic write succeeds. A crash between write +
 *     mark just produces a duplicate upsert on the next tick — facts
 *     are idempotent on (tenantId, userId, key) so this is safe.
 */

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface ReservoirEntry {
  readonly thoughtId: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly capturedAt: string;
}

export interface ConsolidatedFact {
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
}

export interface ReservoirSource {
  /**
   * Pull all unconsumed reservoir rows captured since `since`. Returns
   * an empty array on any failure — the caller treats that the same as
   * "queue is empty."
   */
  fetchUnconsolidated(args: {
    readonly since: Date;
    readonly limit?: number;
  }): Promise<ReadonlyArray<ReservoirEntry>>;
  /**
   * Mark a set of reservoir rows as consolidated. The worker only calls
   * this AFTER a successful semantic write for the group, so a partial
   * failure on the sink does not produce orphan markers.
   */
  markConsolidated(thoughtIds: ReadonlyArray<string>): Promise<void>;
}

export interface SemanticSink {
  /**
   * Persist one consolidated fact for a (tenantId, userId) pair. Must
   * be idempotent on (tenantId, userId, key) — the underlying
   * `upsertFact` already is. Throwing is OK; the worker catches +
   * logs.
   */
  upsertFact(args: {
    readonly tenantId: string | null;
    readonly userId: string;
    readonly key: string;
    readonly value: unknown;
    readonly confidence: number;
    readonly source: 'consolidated';
  }): Promise<void>;
}

/**
 * Per-group fact extractor. Default impl: emit one semantic fact per
 * `turnsPerFact` turns, with a fixed `recent-topic` key whose value is
 * the most recent summary in the group. Real impl would call Haiku
 * (see `services/api-gateway/src/composition/consolidation-runner.ts`).
 */
export interface ConsolidatorPort {
  consolidate(args: {
    readonly tenantId: string | null;
    readonly userId: string;
    readonly entries: ReadonlyArray<ReservoirEntry>;
  }): Promise<ReadonlyArray<ConsolidatedFact>>;
}

export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

export interface ConsolidationDeps {
  readonly source: ReservoirSource;
  readonly sink: SemanticSink;
  readonly consolidator: ConsolidatorPort;
  readonly logger: WorkerLogger;
  /** Default 24h. */
  readonly windowMs?: number;
  /** Default 5000 — soft cap on rows pulled per tick. */
  readonly fetchLimit?: number;
}

export interface ConsolidationTickResult {
  readonly entriesProcessed: number;
  readonly groupsProcessed: number;
  readonly factsUpserted: number;
  readonly thoughtIdsMarked: number;
  readonly errors: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Stub consolidator — 1 fact per N turns, deterministic. Production
// composes the real Haiku consolidator over this same port shape.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_TURNS_PER_FACT = 5;
const DEFAULT_RECENT_TOPIC_KEY = 'recent-topic';
const DEFAULT_CONFIDENCE = 0.6;

export function createStubConsolidator(
  config: {
    readonly turnsPerFact?: number;
    readonly key?: string;
    readonly confidence?: number;
  } = {},
): ConsolidatorPort {
  const turnsPerFact = config.turnsPerFact ?? DEFAULT_TURNS_PER_FACT;
  const key = config.key ?? DEFAULT_RECENT_TOPIC_KEY;
  const confidence = config.confidence ?? DEFAULT_CONFIDENCE;
  return {
    async consolidate({ entries }) {
      const count = Math.floor(entries.length / Math.max(1, turnsPerFact));
      if (count <= 0) return [];
      // Take the most recent N entries as the value source — they are
      // already ordered newest-first by `fetchUnconsolidated`.
      const recent = entries.slice(0, count);
      return recent.map((entry) => ({
        key,
        value: { summary: entry.summary, sourceTurnId: entry.thoughtId },
        confidence,
      }));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Single-tick ingestion — the unit of work invoked by the cron loop.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FETCH_LIMIT = 5000;

export async function runConsolidationTick(
  deps: ConsolidationDeps,
): Promise<ConsolidationTickResult> {
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS;
  const fetchLimit = deps.fetchLimit ?? DEFAULT_FETCH_LIMIT;
  const since = new Date(Date.now() - windowMs);
  const errors: string[] = [];

  let entries: ReadonlyArray<ReservoirEntry> = [];
  try {
    entries = await deps.source.fetchUnconsolidated({ since, limit: fetchLimit });
  } catch (error) {
    const msg = asMessage(error);
    deps.logger.warn({ err: msg }, 'consolidation-worker: fetch failed — skipping tick');
    errors.push(`fetch:${msg}`);
    return emptyResult(errors);
  }

  if (entries.length === 0) {
    return emptyResult();
  }

  const groups = groupByScope(entries);
  let factsUpserted = 0;
  let thoughtIdsMarked = 0;
  let groupsProcessed = 0;

  for (const group of groups) {
    try {
      const facts = await deps.consolidator.consolidate({
        tenantId: group.tenantId,
        userId: group.userId,
        entries: group.entries,
      });

      // Per the contract, only mark + count the group when the
      // consolidator returned facts AND every upsert succeeded. A
      // partial sink failure leaves the group's reservoir rows for
      // the next tick to retry.
      let groupHadError = false;
      let groupFactsUpserted = 0;
      for (const fact of facts) {
        try {
          await deps.sink.upsertFact({
            tenantId: group.tenantId,
            userId: group.userId,
            key: fact.key,
            value: fact.value,
            confidence: fact.confidence,
            source: 'consolidated',
          });
          groupFactsUpserted += 1;
        } catch (error) {
          const msg = asMessage(error);
          deps.logger.warn(
            { tenantId: group.tenantId, userId: group.userId, err: msg },
            'consolidation-worker: upsertFact failed',
          );
          errors.push(`upsert:${group.userId}:${msg}`);
          groupHadError = true;
        }
      }

      if (!groupHadError && groupFactsUpserted > 0) {
        try {
          const ids = group.entries.map((e) => e.thoughtId);
          await deps.source.markConsolidated(ids);
          thoughtIdsMarked += ids.length;
        } catch (error) {
          const msg = asMessage(error);
          deps.logger.warn(
            { tenantId: group.tenantId, userId: group.userId, err: msg },
            'consolidation-worker: markConsolidated failed',
          );
          errors.push(`mark:${group.userId}:${msg}`);
        }
      }

      factsUpserted += groupFactsUpserted;
      groupsProcessed += 1;
    } catch (error) {
      // Consolidator throw — degrade to a no-write for this group only.
      // The reservoir rows stay unmarked so the next tick retries.
      const msg = asMessage(error);
      deps.logger.warn(
        { tenantId: group.tenantId, userId: group.userId, err: msg },
        'consolidation-worker: consolidator failed — no facts written for group',
      );
      errors.push(`consolidator:${group.userId}:${msg}`);
    }
  }

  deps.logger.info(
    {
      entriesProcessed: entries.length,
      groupsProcessed,
      factsUpserted,
      thoughtIdsMarked,
      errors: errors.length,
    },
    'consolidation-worker: tick complete',
  );

  return {
    entriesProcessed: entries.length,
    groupsProcessed,
    factsUpserted,
    thoughtIdsMarked,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cron loop — setInterval-based supervisor with SIGTERM-safe stop.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ConsolidationLoopOptions extends ConsolidationDeps {
  /** Cadence in ms. Defaults to env `CONSOLIDATION_INTERVAL_MS` or 1h. */
  readonly intervalMs?: number;
  /**
   * Inject a clock for tests. Default uses real `setInterval`. The
   * stop function MUST be idempotent — calling `.stop()` more than
   * once is a SIGTERM safety hatch.
   */
  readonly scheduler?: LoopScheduler;
}

export interface LoopScheduler {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ConsolidationLoop {
  /** Returns a handle to stop. Calls `runConsolidationTick` immediately. */
  start(): Promise<void>;
  stop(): void;
  readonly intervalMs: number;
}

export function createConsolidationLoop(
  options: ConsolidationLoopOptions,
): ConsolidationLoop {
  const intervalMs = clampInterval(options.intervalMs);
  const scheduler: LoopScheduler =
    options.scheduler ?? {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    };

  let handle: unknown = null;
  let stopping = false;

  async function safeTick(): Promise<void> {
    if (stopping) return;
    try {
      await runConsolidationTick(options);
    } catch (error) {
      // runConsolidationTick swallows its own errors. Any throw that
      // reaches here is a bug — log it and keep the loop alive.
      const msg = asMessage(error);
      const errLog = options.logger.error ?? options.logger.warn;
      errLog({ err: msg }, 'consolidation-worker: unexpected tick error');
    }
  }

  return {
    intervalMs,
    async start() {
      if (handle) return;
      options.logger.info({ intervalMs }, 'consolidation-worker: starting loop');
      // Fire one tick immediately so operators see the worker is alive.
      await safeTick();
      if (stopping) return;
      handle = scheduler.setInterval(() => void safeTick(), intervalMs);
    },
    stop() {
      stopping = true;
      if (!handle) {
        options.logger.info({}, 'consolidation-worker: stop called (no-op, not running)');
        return;
      }
      scheduler.clearInterval(handle);
      handle = null;
      options.logger.info({}, 'consolidation-worker: loop stopped');
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface ScopeGroup {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly entries: ReadonlyArray<ReservoirEntry>;
}

function groupByScope(
  entries: ReadonlyArray<ReservoirEntry>,
): ReadonlyArray<ScopeGroup> {
  const map = new Map<string, ReservoirEntry[]>();
  for (const entry of entries) {
    const key = `${entry.tenantId ?? ''}::${entry.userId}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }
  const groups: ScopeGroup[] = [];
  for (const bucket of map.values()) {
    const first = bucket[0];
    if (!first) continue;
    // Sort newest-first so the stub consolidator picks the most recent.
    const ordered = [...bucket].sort((a, b) =>
      a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0,
    );
    groups.push({ tenantId: first.tenantId, userId: first.userId, entries: ordered });
  }
  return groups;
}

function clampInterval(input: number | undefined): number {
  const envRaw = process.env.CONSOLIDATION_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  const candidate =
    typeof input === 'number' && Number.isFinite(input) && input > 0
      ? input
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(candidate)));
}

function emptyResult(errors: ReadonlyArray<string> = []): ConsolidationTickResult {
  return {
    entriesProcessed: 0,
    groupsProcessed: 0,
    factsUpserted: 0,
    thoughtIdsMarked: 0,
    errors,
  };
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
