/**
 * Composite `MarketRatePort` — fans the same query out to every
 * configured upstream adapter and concatenates their comparable
 * listings, with per-adapter failure isolation.
 *
 * Strategy:
 *   - `mode: 'merge'` (default) — call every inner adapter in parallel
 *     and concatenate successful results. A failed adapter is logged
 *     and skipped; the overall call still resolves.
 *   - `mode: 'failover'` — try inner adapters in declaration order;
 *     return the first non-empty success. A failure falls through to
 *     the next adapter. Useful when the upstreams cover overlapping
 *     geographies and we want to minimise quota burn.
 *
 * `createCompositeAdapterFromEnv` reads the three first-party env vars
 * (`RENTOMETER_API_KEY`, `ZILLOW_API_KEY`, `AIRBNB_API_KEY`) and returns
 * a composite spanning whichever adapters are configured. Returns
 * `null` when no env vars are set so the wiring root can drop back to
 * the existing stub adapter.
 *
 * The aggregated `adapterId` is `composite[<a>+<b>+...]` so the
 * `MarketRateSnapshot.sourceAdapter` column tells you which providers
 * actually contributed to that snapshot.
 */

import type {
  ComparableListing,
  MarketRatePort,
} from '@borjie/ai-copilot/ai-native';
import {
  createRentometerAdapterFromEnv,
  type RentometerEnv,
} from './rentometer-adapter.js';
import {
  createZillowAdapterFromEnv,
  type ZillowEnv,
} from './zillow-adapter.js';
import {
  createAirbnbAdapterFromEnv,
  type AirbnbEnv,
} from './airbnb-adapter.js';

export type CompositeMode = 'merge' | 'failover';

export interface CompositeAdapterLogger {
  warn(meta: object, msg: string): void;
}

export interface CompositeAdapterDeps {
  readonly adapters: readonly MarketRatePort[];
  readonly mode?: CompositeMode;
  readonly logger?: CompositeAdapterLogger;
}

export type CompositeEnv = RentometerEnv & ZillowEnv & AirbnbEnv;

export function createCompositeAdapter(
  deps: CompositeAdapterDeps,
): MarketRatePort {
  const adapters = deps.adapters.filter(
    (a): a is MarketRatePort => a !== null && a !== undefined,
  );
  if (adapters.length === 0) {
    throw new Error('composite-adapter: at least one adapter required');
  }
  const mode = deps.mode ?? 'merge';
  const id = buildCompositeId(adapters);

  return {
    adapterId: id,
    async fetchComparables(params): Promise<readonly ComparableListing[]> {
      if (mode === 'failover') {
        return runFailover(adapters, params, deps.logger);
      }
      return runMerge(adapters, params, deps.logger);
    },
  };
}

/**
 * Build a composite from environment variables. Returns `null` when no
 * recognised env var is configured so the caller can fall back to the
 * existing stub adapter.
 */
export function createCompositeAdapterFromEnv(
  env: CompositeEnv = process.env as CompositeEnv,
  options: {
    readonly mode?: CompositeMode;
    readonly logger?: CompositeAdapterLogger;
  } = {},
): MarketRatePort | null {
  const candidates: readonly (MarketRatePort | null)[] = [
    createRentometerAdapterFromEnv(env),
    createZillowAdapterFromEnv(env),
    createAirbnbAdapterFromEnv(env),
  ];
  const live = candidates.filter(
    (a): a is MarketRatePort => a !== null,
  );
  if (live.length === 0) return null;
  return createCompositeAdapter({
    adapters: live,
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  });
}

function buildCompositeId(adapters: readonly MarketRatePort[]): string {
  const parts = adapters.map((a) => a.adapterId).join('+');
  return `composite[${parts}]`;
}

async function runMerge(
  adapters: readonly MarketRatePort[],
  params: Parameters<MarketRatePort['fetchComparables']>[0],
  logger?: CompositeAdapterLogger,
): Promise<readonly ComparableListing[]> {
  const settled = await Promise.allSettled(
    adapters.map((a) => a.fetchComparables(params)),
  );

  return settled.flatMap((result, idx) => {
    if (result.status === 'fulfilled') return result.value;
    logger?.warn(
      {
        wiring: 'market-surveillance',
        adapter: adapters[idx]?.adapterId,
        err: result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      },
      'composite-adapter: inner adapter failed in merge mode; skipping',
    );
    return [];
  });
}

async function runFailover(
  adapters: readonly MarketRatePort[],
  params: Parameters<MarketRatePort['fetchComparables']>[0],
  logger?: CompositeAdapterLogger,
): Promise<readonly ComparableListing[]> {
  for (const adapter of adapters) {
    try {
      const out = await adapter.fetchComparables(params);
      if (out.length > 0) return out;
    } catch (error) {
      logger?.warn(
        {
          wiring: 'market-surveillance',
          adapter: adapter.adapterId,
          err: error instanceof Error ? error.message : String(error),
        },
        'composite-adapter: inner adapter failed in failover mode; trying next',
      );
    }
  }
  return [];
}
