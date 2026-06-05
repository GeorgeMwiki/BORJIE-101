/**
 * Adapter ports + in-memory test doubles for the 8 universal sleep passes.
 *
 * Production composition wires real adapters (Drizzle, Redis, audit chain).
 * Tests use the in-memory builders here for deterministic runs.
 */

import type {
  IsoTimestamp,
  PassId,
  SleepEmission,
  SleepRunFinalize,
  SleepRunStore,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// DLQ port — used by `dead-letter-replay`
// ─────────────────────────────────────────────────────────────────────

export interface DeadLetterMessage {
  readonly id: string;
  readonly queue: string;
  readonly payload: unknown;
  readonly enqueuedAt: IsoTimestamp;
  readonly attempts: number;
}

export interface DeadLetterAdapter {
  list(opts: { limit: number }): Promise<ReadonlyArray<DeadLetterMessage>>;
  replay(messageId: string): Promise<{ ok: boolean }>;
}

export function createInMemoryDeadLetterAdapter(
  seed: ReadonlyArray<DeadLetterMessage> = [],
): DeadLetterAdapter & { dropped: () => ReadonlyArray<string> } {
  const queue = new Map(seed.map((m) => [m.id, m] as const));
  const dropped: string[] = [];
  return {
    async list({ limit }) {
      return Array.from(queue.values()).slice(0, limit);
    },
    async replay(id) {
      queue.delete(id);
      dropped.push(id);
      return { ok: true };
    },
    dropped: () => [...dropped],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cache port — used by `cache-warm-up`
// ─────────────────────────────────────────────────────────────────────

export interface CacheAdapter {
  prewarm(key: string, value: unknown): Promise<void>;
  size(): Promise<number>;
}

export function createInMemoryCacheAdapter(): CacheAdapter & {
  warmedKeys: () => ReadonlyArray<string>;
} {
  const store = new Map<string, unknown>();
  return {
    async prewarm(key, value) {
      store.set(key, value);
    },
    async size() {
      return store.size;
    },
    warmedKeys: () => Array.from(store.keys()),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Data-quality port — used by `data-quality-check`
// ─────────────────────────────────────────────────────────────────────

export interface DataQualityRow {
  readonly table: string;
  readonly recordId: string;
  readonly recordedAt: IsoTimestamp;
  readonly anomaly: string | null;
}

export interface DataQualityAdapter {
  scanRecentInserts(opts: { sinceMs: number }): Promise<
    ReadonlyArray<DataQualityRow>
  >;
  flagAnomaly(row: DataQualityRow): Promise<void>;
}

export function createInMemoryDataQualityAdapter(
  seed: ReadonlyArray<DataQualityRow> = [],
): DataQualityAdapter & { flagged: () => ReadonlyArray<DataQualityRow> } {
  const flagged: DataQualityRow[] = [];
  return {
    async scanRecentInserts() {
      return seed;
    },
    async flagAnomaly(row) {
      flagged.push(row);
    },
    flagged: () => [...flagged],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Index port — used by `index-maintenance`
// ─────────────────────────────────────────────────────────────────────

export interface IndexAdapter {
  /** Return tables flagged hot (bloat > threshold). */
  listHotIndexes(): Promise<ReadonlyArray<string>>;
  reindex(table: string): Promise<{ ok: boolean }>;
}

export function createInMemoryIndexAdapter(
  hot: ReadonlyArray<string> = [],
): IndexAdapter & { reindexed: () => ReadonlyArray<string> } {
  const reindexed: string[] = [];
  return {
    async listHotIndexes() {
      return hot;
    },
    async reindex(table) {
      reindexed.push(table);
      return { ok: true };
    },
    reindexed: () => [...reindexed],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Audit chain port — used by `audit-chain-verify`
// ─────────────────────────────────────────────────────────────────────

export interface AuditChainEntry {
  readonly id: string;
  readonly previousHash: string | null;
  readonly hash: string;
  readonly payload: unknown;
}

export interface AuditChainAdapter {
  /** Return entries in insertion order. */
  listAll(): Promise<ReadonlyArray<AuditChainEntry>>;
  recomputeHash(entry: AuditChainEntry): string;
}

export function createInMemoryAuditChainAdapter(
  entries: ReadonlyArray<AuditChainEntry>,
): AuditChainAdapter {
  return {
    async listAll() {
      return entries;
    },
    recomputeHash(entry) {
      // Deterministic mock: sha-like hex from prev + json payload.
      const json = JSON.stringify(entry.payload ?? null);
      let h = 0;
      const seed = `${entry.previousHash ?? ''}|${json}`;
      for (let i = 0; i < seed.length; i++) {
        h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Token cleanup port — used by `expired-token-cleanup`
// ─────────────────────────────────────────────────────────────────────

export interface ExpirableToken {
  readonly id: string;
  readonly kind: 'session' | 'refresh' | 'api-key' | 'magic-link';
  readonly expiresAt: IsoTimestamp;
}

export interface TokenAdapter {
  listExpired(opts: { nowMs: number }): Promise<ReadonlyArray<ExpirableToken>>;
  purge(id: string): Promise<void>;
}

export function createInMemoryTokenAdapter(
  seed: ReadonlyArray<ExpirableToken> = [],
): TokenAdapter & { purged: () => ReadonlyArray<string> } {
  const tokens = new Map(seed.map((t) => [t.id, t] as const));
  const purged: string[] = [];
  return {
    async listExpired({ nowMs }) {
      return Array.from(tokens.values()).filter(
        (t) => Date.parse(t.expiresAt) <= nowMs,
      );
    },
    async purge(id) {
      tokens.delete(id);
      purged.push(id);
    },
    purged: () => [...purged],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Metrics port — used by `metrics-rollup`
// ─────────────────────────────────────────────────────────────────────

export interface HourlyMetric {
  readonly hour: IsoTimestamp;
  readonly key: string;
  readonly value: number;
}

export interface DailyMetric {
  readonly day: IsoTimestamp;
  readonly key: string;
  readonly sum: number;
  readonly count: number;
}

export interface MetricsAdapter {
  fetchHourly(opts: { sinceMs: number }): Promise<ReadonlyArray<HourlyMetric>>;
  upsertDaily(d: DailyMetric): Promise<void>;
}

export function createInMemoryMetricsAdapter(
  seed: ReadonlyArray<HourlyMetric> = [],
): MetricsAdapter & { dailies: () => ReadonlyArray<DailyMetric> } {
  const dailies: DailyMetric[] = [];
  return {
    async fetchHourly() {
      return seed;
    },
    async upsertDaily(d) {
      dailies.push(d);
    },
    dailies: () => [...dailies],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tenant activity port — used by `dormant-tenant-detector`
// ─────────────────────────────────────────────────────────────────────

export interface TenantActivity {
  readonly tenantId: string;
  readonly lastActiveAt: IsoTimestamp;
}

export interface TenantAdapter {
  listActivity(): Promise<ReadonlyArray<TenantActivity>>;
  flagDormant(tenantId: string): Promise<void>;
}

export function createInMemoryTenantAdapter(
  seed: ReadonlyArray<TenantActivity> = [],
): TenantAdapter & { dormant: () => ReadonlyArray<string> } {
  const dormant: string[] = [];
  return {
    async listActivity() {
      return seed;
    },
    async flagDormant(tenantId) {
      dormant.push(tenantId);
    },
    dormant: () => [...dormant],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sleep-run store — used by `runSleepTick` (LP-21a)
// ─────────────────────────────────────────────────────────────────────

interface InMemoryRunRow {
  readonly id: string;
  readonly passId: PassId;
  status: 'running' | 'done' | 'failed' | 'timeout' | 'skipped';
  readonly startedAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
  errorText: string | null;
}

interface InMemoryEmissionRow {
  readonly runId: string;
  readonly kind: string;
  readonly payload: unknown;
}

export interface InMemorySleepRunStore extends SleepRunStore {
  /** Inspect persisted run rows (tests). */
  runs(): ReadonlyArray<InMemoryRunRow>;
  /** Inspect persisted emission rows (tests). */
  emissions(): ReadonlyArray<InMemoryEmissionRow>;
}

/**
 * Deterministic in-memory {@link SleepRunStore} for tests + standalone mode.
 *
 * Mirrors the production single-flight + stale-row-rescue semantics:
 *   - A still-fresh `running` row for the same pass causes `beginRun` to
 *     return `null` (another worker is in flight — skip this tick).
 *   - A `running` row older than `rescueAgeMs` is reaped to `failed`
 *     ("presumed crash") and a fresh row is inserted, so a crashed pass is
 *     never permanently wedged.
 *
 * @param opts.rescueAgeMs stale-row rescue window (default 30 min).
 * @param opts.nowMs       monotonic clock injection for deterministic tests.
 * @param opts.idFactory   id generator (default monotonic counter).
 */
export function createInMemorySleepRunStore(opts: {
  readonly rescueAgeMs?: number;
  readonly nowMs?: () => number;
  readonly idFactory?: () => string;
} = {}): InMemorySleepRunStore {
  const rescueAgeMs = opts.rescueAgeMs ?? 30 * 60 * 1000;
  const nowMs = opts.nowMs ?? (() => Date.now());
  let seq = 0;
  const idFactory = opts.idFactory ?? (() => `run_${++seq}`);

  const rows: InMemoryRunRow[] = [];
  const emissionRows: InMemoryEmissionRow[] = [];

  function freshestRunning(passId: PassId): InMemoryRunRow | undefined {
    return rows
      .filter((r) => r.passId === passId && r.status === 'running')
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  }

  return {
    async beginRun(passId) {
      const stuck = freshestRunning(passId);
      if (stuck) {
        const ageMs = nowMs() - Date.parse(stuck.startedAt);
        if (ageMs > rescueAgeMs) {
          stuck.status = 'failed';
          stuck.completedAt = new Date(nowMs()).toISOString();
          stuck.errorText = `presumed crash — 'running' for ${Math.round(
            ageMs / 60000,
          )}min, exceeded ${rescueAgeMs / 60000}min budget`;
          // fall through to insert a fresh row
        } else {
          // single-flight: another worker is legitimately in flight
          return null;
        }
      }
      const row: InMemoryRunRow = {
        id: idFactory(),
        passId,
        status: 'running',
        startedAt: new Date(nowMs()).toISOString(),
        completedAt: null,
        errorText: null,
      };
      rows.push(row);
      return row.id;
    },

    async recordEmissions(
      runId: string | null,
      emissions: ReadonlyArray<SleepEmission>,
    ) {
      if (!runId || emissions.length === 0) return;
      for (const e of emissions) {
        emissionRows.push({ runId, kind: e.kind, payload: e.payload });
      }
    },

    async finalizeRun(runId: string | null, fin: SleepRunFinalize) {
      if (!runId) return;
      const row = rows.find((r) => r.id === runId);
      if (!row) return;
      row.status = fin.status;
      row.completedAt = new Date(nowMs()).toISOString();
      row.errorText = fin.errorText ?? null;
    },

    async lastRunAt(passId) {
      const latest = rows
        .filter((r) => r.passId === passId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
      return latest?.startedAt ?? null;
    },

    runs: () => rows.map((r) => ({ ...r })),
    emissions: () => emissionRows.map((e) => ({ ...e })),
  };
}
