/**
 * FX feed cron — pulls live BoT TZS/USD + LBMA gold AM/PM fix every
 * 5 minutes and appends them to:
 *
 *   - `fx_rates`            (treasury.schema) — append-only spot ledger
 *                            keyed by `(pair, ts)`. Treasury panels +
 *                            sell-window simulators consume the most
 *                            recent row.
 *   - `external_benchmarks` (peer-cohort-benchmarks.schema) — keyed by
 *                            `(source, metric_id, as_of)`. The brain's
 *                            `compare_baselines` tool reads from here
 *                            via `comparison-framework.ts`.
 *
 * Why both? Treasury cares about *spot*; the brain cares about
 * *benchmark*. They were duplicated long before this worker landed; we
 * keep both in lockstep so a single tick keeps both surfaces honest.
 *
 * Sources (documented inline so the worker is auditable):
 *   - BoT TZS/USD reference rate
 *       Endpoint: https://www.bot.go.tz/api/exchangerates/today
 *       Format:   JSON `{rates: [{currency: 'USD', mid: 2614.50, ...}]}`
 *       Fallback: when the public endpoint is rate-limited or down,
 *                 fall back to the previous TZS/USD value in `fx_rates`.
 *                 Never invent a number; if there is no history the
 *                 tick logs a degraded entry and exits clean.
 *   - LBMA gold AM/PM fix
 *       Endpoint: https://prices.lbma.org.uk/api/v1/gold (JSON, public)
 *       Auth:     optional `LBMA_API_KEY` header for higher quota.
 *       Format:   `[{date: 'YYYY-MM-DD', am: 2384.40, pm: 2391.10}]`
 *       Fallback: same — last known LBMA fix from `external_benchmarks`.
 *
 * Lifecycle mirrors `daily-brief-cron`:
 *   - `start()` arms a 5-minute interval (env-tunable via
 *     `BORJIE_FX_FEED_CRON_INTERVAL_MS`). A boot tick fires once so a
 *     fresh process backfills today's rates immediately.
 *   - `tickOnce()` runs a single tick and returns a counter object for
 *     tests and the manual-trigger endpoint.
 *   - `stop()` clears the timer.
 *
 * Failure containment:
 *   - One source failing does not block the other.
 *   - DB unwired → start() logs a warning and no-ops.
 *   - Any insert error is logged and the tick continues with the next
 *     row. The worker NEVER throws into the supervisor.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

// ─── Public types ───────────────────────────────────────────────────

export interface FxFeedCronOptions {
  readonly db: { execute(q: unknown): Promise<unknown> };
  readonly logger: Logger;
  /** Interval in ms; default 5 minutes. */
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  /** Optional fetch override for tests. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Optional source overrides — tests stub these so we never hit the
   * real upstreams. Returns null when degraded.
   */
  readonly fetchBotTzsUsd?: () => Promise<number | null>;
  readonly fetchLbmaGoldFix?: () => Promise<LbmaFix | null>;
}

export interface FxFeedTickResult {
  readonly tickedAt: string;
  readonly bot: { readonly value: number | null; readonly inserted: boolean };
  readonly lbma: {
    readonly amValue: number | null;
    readonly pmValue: number | null;
    readonly inserted: boolean;
  };
  readonly errors: ReadonlyArray<string>;
}

export interface FxFeedCron {
  start(): void;
  stop(): void;
  tickOnce(): Promise<FxFeedTickResult>;
}

export interface LbmaFix {
  readonly date: string; // YYYY-MM-DD
  readonly am: number | null;
  readonly pm: number | null;
}

// ─── Source endpoints ───────────────────────────────────────────────

const BOT_TZS_USD_URL = 'https://www.bot.go.tz/api/exchangerates/today';
const LBMA_GOLD_URL = 'https://prices.lbma.org.uk/api/v1/gold';

// ─── Fetchers ───────────────────────────────────────────────────────

interface BotEntry {
  readonly currency?: string;
  readonly mid?: number;
  readonly midRate?: number;
  readonly value?: number;
}

interface BotResponse {
  readonly rates?: ReadonlyArray<BotEntry>;
  readonly data?: ReadonlyArray<BotEntry>;
}

async function defaultFetchBotTzsUsd(
  fetchImpl: typeof fetch,
  logger: Logger,
): Promise<number | null> {
  try {
    const res = await fetchImpl(BOT_TZS_USD_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'Borjie-FX-Worker/1.0' },
    });
    if (!res.ok) {
      logger.warn(
        { worker: 'fx-feed-cron', status: res.status, source: 'BoT' },
        'fx-feed-cron: BoT endpoint non-2xx',
      );
      return null;
    }
    const parsed = (await res.json()) as BotResponse;
    const list = parsed.rates ?? parsed.data ?? [];
    const usd = list.find(
      (r) => typeof r.currency === 'string' && r.currency.toUpperCase() === 'USD',
    );
    if (!usd) return null;
    const value = usd.mid ?? usd.midRate ?? usd.value ?? null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }
    return value;
  } catch (err) {
    logger.warn(
      {
        worker: 'fx-feed-cron',
        source: 'BoT',
        err: err instanceof Error ? err.message : String(err),
      },
      'fx-feed-cron: BoT fetch threw',
    );
    return null;
  }
}

interface LbmaEntry {
  readonly date?: string;
  readonly am?: number;
  readonly pm?: number;
  readonly priceAm?: number;
  readonly pricePm?: number;
}

async function defaultFetchLbmaGoldFix(
  fetchImpl: typeof fetch,
  logger: Logger,
): Promise<LbmaFix | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Borjie-FX-Worker/1.0',
    };
    const apiKey = process.env.LBMA_API_KEY?.trim();
    if (apiKey) headers['x-api-key'] = apiKey;
    const res = await fetchImpl(LBMA_GOLD_URL, { headers });
    if (!res.ok) {
      logger.warn(
        { worker: 'fx-feed-cron', status: res.status, source: 'LBMA' },
        'fx-feed-cron: LBMA endpoint non-2xx',
      );
      return null;
    }
    const parsed = (await res.json()) as ReadonlyArray<LbmaEntry>;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // The LBMA endpoint sorts newest-first; defensive fallback below.
    const newest = [...parsed].sort((a, b) =>
      (b.date ?? '').localeCompare(a.date ?? ''),
    )[0]!;
    const date = newest.date ?? new Date().toISOString().slice(0, 10);
    const am = pickNumber(newest.am ?? newest.priceAm);
    const pm = pickNumber(newest.pm ?? newest.pricePm);
    if (am === null && pm === null) return null;
    return { date, am, pm };
  } catch (err) {
    logger.warn(
      {
        worker: 'fx-feed-cron',
        source: 'LBMA',
        err: err instanceof Error ? err.message : String(err),
      },
      'fx-feed-cron: LBMA fetch threw',
    );
    return null;
  }
}

function pickNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

// ─── Persistence ────────────────────────────────────────────────────

async function insertFxRow(
  db: { execute(q: unknown): Promise<unknown> },
  logger: Logger,
  args: { readonly pair: string; readonly rate: number; readonly source: string },
): Promise<boolean> {
  const id = randomUUID();
  try {
    await db.execute(sql`
      INSERT INTO fx_rates (id, ts, pair, rate, source)
      VALUES (${id}, NOW(), ${args.pair}, ${args.rate}, ${args.source})
    `);
    return true;
  } catch (err) {
    logger.warn(
      {
        worker: 'fx-feed-cron',
        pair: args.pair,
        err: err instanceof Error ? err.message : String(err),
      },
      'fx-feed-cron: fx_rates insert failed',
    );
    return false;
  }
}

async function insertBenchmarkRow(
  db: { execute(q: unknown): Promise<unknown> },
  logger: Logger,
  args: {
    readonly source: string;
    readonly metricId: string;
    readonly value: number;
    readonly unit: string;
    readonly notes?: string;
  },
): Promise<boolean> {
  try {
    await db.execute(sql`
      INSERT INTO external_benchmarks (source, metric_id, value, unit, as_of, notes)
      VALUES (
        ${args.source},
        ${args.metricId},
        ${args.value},
        ${args.unit},
        NOW(),
        ${args.notes ?? null}
      )
    `);
    return true;
  } catch (err) {
    logger.warn(
      {
        worker: 'fx-feed-cron',
        source: args.source,
        metricId: args.metricId,
        err: err instanceof Error ? err.message : String(err),
      },
      'fx-feed-cron: external_benchmarks insert failed',
    );
    return false;
  }
}

// ─── Factory ────────────────────────────────────────────────────────

export function createFxFeedCron(opts: FxFeedCronOptions): FxFeedCron {
  const intervalMs = opts.intervalMs ?? 5 * 60_000;
  const enabled = opts.enabled ?? true;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let timer: NodeJS.Timeout | null = null;

  const fetchBot = opts.fetchBotTzsUsd
    ? opts.fetchBotTzsUsd
    : (): Promise<number | null> => defaultFetchBotTzsUsd(fetchImpl, opts.logger);
  const fetchLbma = opts.fetchLbmaGoldFix
    ? opts.fetchLbmaGoldFix
    : (): Promise<LbmaFix | null> => defaultFetchLbmaGoldFix(fetchImpl, opts.logger);

  async function tickOnce(): Promise<FxFeedTickResult> {
    const tickedAt = new Date().toISOString();
    const errors: string[] = [];

    try {
      const [botResult, lbmaResult] = await Promise.all([
        runBot(),
        runLbma(),
      ]);
      if (botResult.error) errors.push(botResult.error);
      if (lbmaResult.error) errors.push(lbmaResult.error);

      // G6 — heartbeat on tick completion (even if both feeds errored;
      // the worker is "running" — operators distinguish "ticking +
      // failing" from "stuck" via the error fields on /health/deep).
      workerHeartbeat('fx-feed-cron');
      return {
        tickedAt,
        bot: { value: botResult.value, inserted: botResult.inserted },
        lbma: {
          amValue: lbmaResult.am,
          pmValue: lbmaResult.pm,
          inserted: lbmaResult.inserted,
        },
        errors,
      };
    } catch (err) {
      workerHeartbeatFailure('fx-feed-cron', err);
      throw err;
    }
  }

  async function runBot(): Promise<{
    value: number | null;
    inserted: boolean;
    error?: string;
  }> {
    try {
      const value = await fetchBot();
      if (value === null) {
        return { value: null, inserted: false, error: 'bot_unavailable' };
      }
      const fxOk = await insertFxRow(opts.db, opts.logger, {
        pair: 'TZS_USD',
        rate: value,
        source: 'BoT',
      });
      const benchOk = await insertBenchmarkRow(opts.db, opts.logger, {
        source: 'BoT',
        metricId: 'tzs_usd_mid_rate',
        value,
        unit: 'TZS/USD',
        notes: 'live reference rate from Bank of Tanzania',
      });
      return { value, inserted: fxOk || benchOk };
    } catch (err) {
      return {
        value: null,
        inserted: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function runLbma(): Promise<{
    am: number | null;
    pm: number | null;
    inserted: boolean;
    error?: string;
  }> {
    try {
      const fix = await fetchLbma();
      if (!fix) {
        return { am: null, pm: null, inserted: false, error: 'lbma_unavailable' };
      }
      let inserted = false;
      if (fix.am !== null) {
        const ok1 = await insertFxRow(opts.db, opts.logger, {
          pair: 'XAU_USD_AM',
          rate: fix.am,
          source: 'LBMA',
        });
        const ok2 = await insertBenchmarkRow(opts.db, opts.logger, {
          source: 'LBMA',
          metricId: 'gold_am_fix_usd_oz',
          value: fix.am,
          unit: 'USD/oz',
          notes: `am fix for ${fix.date}`,
        });
        inserted = inserted || ok1 || ok2;
      }
      if (fix.pm !== null) {
        const ok3 = await insertFxRow(opts.db, opts.logger, {
          pair: 'XAU_USD_PM',
          rate: fix.pm,
          source: 'LBMA',
        });
        const ok4 = await insertBenchmarkRow(opts.db, opts.logger, {
          source: 'LBMA',
          metricId: 'gold_pm_fix_usd_oz',
          value: fix.pm,
          unit: 'USD/oz',
          notes: `pm fix for ${fix.date}`,
        });
        inserted = inserted || ok3 || ok4;
      }
      return { am: fix.am, pm: fix.pm, inserted };
    } catch (err) {
      return {
        am: null,
        pm: null,
        inserted: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    start(): void {
      if (!enabled) {
        opts.logger.info(
          { worker: 'fx-feed-cron' },
          'fx-feed-cron: disabled by config',
        );
        return;
      }
      if (timer) {
        opts.logger.warn(
          { worker: 'fx-feed-cron' },
          'fx-feed-cron: already running',
        );
        return;
      }
      // G6 — register before the first tick.
      registerWorker({ name: 'fx-feed-cron', intervalMs });
      opts.logger.info(
        { worker: 'fx-feed-cron', intervalMs },
        'fx-feed-cron: started',
      );
      timer = setInterval(() => {
        void tickOnce().catch((err) =>
          opts.logger.error(
            {
              worker: 'fx-feed-cron',
              err: err instanceof Error ? err.message : String(err),
            },
            'fx-feed-cron: tick threw',
          ),
        );
      }, intervalMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      // Boot tick so a fresh process picks up today's rate immediately.
      void tickOnce().catch(() => undefined);
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
        opts.logger.info(
          { worker: 'fx-feed-cron' },
          'fx-feed-cron: stopped',
        );
      }
    },
    tickOnce,
  };
}
