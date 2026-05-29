/**
 * Saved-search worker — Roadmap R2.
 *
 * Ticks at 60s and processes every `saved_searches` row whose
 * `frequency` cadence has elapsed since `last_run_at`. For each row the
 * worker:
 *
 *   1. Resolves the source corpus (marketplace | opportunities |
 *      regulatory) via the injected `SearchExecutor`.
 *   2. Runs `query_json` against the corpus and counts matches.
 *   3. If `matchCount > last_match_count`, dispatches an owner-messaging
 *      alert via the injected `OwnerAlertSender`.
 *   4. Writes `last_run_at`, `last_match_count`, and (on alert)
 *      `last_alert_at`.
 *
 * Pure-logic shape mirrors `lease-expiry-alert-cron.ts` —
 * `DbLike`/`SearchExecutor`/`OwnerAlertSender` interfaces are injected
 * so vitest can drive every branch deterministically without a real
 * Postgres or notifications service. The composition root wires the
 * real Drizzle client and the real owner-messaging dispatcher.
 *
 * Env knobs:
 *   - SAVED_SEARCH_WORKER_INTERVAL_MS  override the 60s cadence (tests)
 *   - SAVED_SEARCH_WORKER_DISABLED=true inert in this process (k8s
 *                                       CronJob takes over instead)
 */

import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const SAVED_SEARCH_FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;
export type SavedSearchFrequency = (typeof SAVED_SEARCH_FREQUENCIES)[number];

export interface SavedSearchRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly label: string;
  readonly queryJson: Record<string, unknown>;
  readonly frequency: SavedSearchFrequency;
  readonly source: string;
  readonly lastRunAt: Date | null;
  readonly lastMatchCount: number;
}

export interface SearchExecutor {
  /** Run a query against a named corpus; return how many matches. */
  run(args: {
    readonly tenantId: string;
    readonly source: string;
    readonly query: Record<string, unknown>;
  }): Promise<{ readonly matchCount: number }>;
}

export interface OwnerAlertSender {
  send(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly savedSearch: SavedSearchRow;
    readonly newMatches: number;
    readonly idempotencyKey: string;
  }): Promise<{ readonly delivered: boolean }>;
}

export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface SavedSearchWorkerOptions {
  readonly db: DbLike;
  readonly search: SearchExecutor;
  readonly alerts: OwnerAlertSender;
  readonly logger?: Logger;
  /** Test seam for deterministic now(). */
  readonly now?: () => Date;
  /** Override 60s tick for tests. */
  readonly intervalMs?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Convert frequency to the minimum gap (ms) before re-running. */
export function frequencyToGapMs(freq: SavedSearchFrequency): number {
  switch (freq) {
    case 'hourly':
      return 60 * 60 * 1000;
    case 'daily':
      return 24 * 60 * 60 * 1000;
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Is the row due for a fresh search? True when `lastRunAt` is null
 * (never run) OR the elapsed time is ≥ the frequency gap.
 */
export function isDue(row: SavedSearchRow, now: Date): boolean {
  if (!row.lastRunAt) return true;
  const elapsed = now.getTime() - row.lastRunAt.getTime();
  return elapsed >= frequencyToGapMs(row.frequency);
}

/**
 * Deterministic idempotency key — caller passes the row + the
 * snapshot match-count; the same delta only ever fires once.
 */
export function buildAlertIdempotencyKey(
  savedSearchId: string,
  matchCount: number,
): string {
  return `saved-search-alert:${savedSearchId}:${matchCount}`;
}

// ---------------------------------------------------------------------------
// Cron lifecycle
// ---------------------------------------------------------------------------

export interface SavedSearchWorker {
  start(): void;
  stop(): void;
  /** One tick — exposed for tests. */
  tickOnce(): Promise<{
    readonly scanned: number;
    readonly alerted: number;
  }>;
}

const DEFAULT_INTERVAL_MS = 60 * 1000;

export function createSavedSearchWorker(
  opts: SavedSearchWorkerOptions,
): SavedSearchWorker {
  const logger = opts.logger;
  const now = opts.now ?? (() => new Date());
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<{
    readonly scanned: number;
    readonly alerted: number;
  }> {
    const tickAt = now();
    const rows = (await opts.db.execute({
      __op: 'select_due_saved_searches',
      at: tickAt.toISOString(),
    })) as unknown as ReadonlyArray<SavedSearchRow>;
    let alerted = 0;
    let scanned = 0;
    for (const row of rows) {
      if (!isDue(row, tickAt)) continue;
      scanned += 1;
      try {
        const { matchCount } = await opts.search.run({
          tenantId: row.tenantId,
          source: row.source,
          query: row.queryJson,
        });
        const delta = matchCount - row.lastMatchCount;
        if (delta > 0) {
          const idempotencyKey = buildAlertIdempotencyKey(row.id, matchCount);
          const result = await opts.alerts.send({
            tenantId: row.tenantId,
            userId: row.userId,
            savedSearch: row,
            newMatches: delta,
            idempotencyKey,
          });
          if (result.delivered) alerted += 1;
        }
        await opts.db.execute({
          __op: 'update_saved_search_after_run',
          id: row.id,
          tenantId: row.tenantId,
          lastRunAt: tickAt.toISOString(),
          lastMatchCount: matchCount,
          alerted: matchCount > row.lastMatchCount,
        });
      } catch (err) {
        logger?.error(
          { err, savedSearchId: row.id, tenantId: row.tenantId },
          'saved-search-worker tick failed',
        );
      }
    }
    return { scanned, alerted };
  }

  return {
    start(): void {
      if (timer) return;
      if (process.env.SAVED_SEARCH_WORKER_DISABLED === 'true') return;
      timer = setInterval(() => {
        void tickOnce().catch((err: unknown) => {
          logger?.error({ err }, 'saved-search-worker scheduled tick failed');
        });
      }, interval);
      // Don't keep the event-loop alive in tests.
      if (typeof timer === 'object' && timer && 'unref' in timer) {
        (timer as { unref: () => void }).unref();
      }
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickOnce,
  };
}
