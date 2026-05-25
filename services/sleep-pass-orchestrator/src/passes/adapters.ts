/**
 * Adapter ports + in-memory test doubles for the 8 universal sleep passes.
 *
 * Production composition wires real adapters (Drizzle, Redis, audit chain).
 * Tests use the in-memory builders here for deterministic runs.
 */

import type { IsoTimestamp } from '../types.js';

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
