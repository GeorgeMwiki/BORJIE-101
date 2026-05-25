/**
 * Currency rates service — Drizzle/Postgres adapter for the FX
 * normalisation layer used by the platform-overview HQ KPI router.
 *
 * Responsibility: read the `currency_rates` table (migration 0117)
 * and convert per-currency payment sums into a single USD figure.
 *
 * Design notes:
 *   1. `loadAll()` returns a Map keyed by ISO-4217 code. If the table
 *      is empty (e.g. a fresh database that hasn't applied the seed
 *      INSERTs yet) we fall back to a one-entry map with USD=1.0 so
 *      downstream callers never see a hard failure on cold-start.
 *   2. `normaliseToUsd(...)` walks per-currency slices, converts each
 *      to USD using the loaded map, and sums. Unknown currency codes
 *      contribute 0 with a `console.warn` — the aggregator must NOT
 *      throw for the platform KPI tile (the router has its own PARTIAL
 *      fallback for hard DB errors).
 *   3. `minorPerMajor` is per-slice and defaults to 100. TZS / KES /
 *      USD all use 100 minor units per major; if a future currency
 *      uses a different scale (e.g. JPY uses 1) the caller passes
 *      it explicitly.
 */

import { currencyRates } from '../schemas/currency-rates.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface CurrencyRate {
  readonly code: string;
  readonly rateToUsd: number;
  readonly asOf: string;
  readonly source: string | null;
}

export interface CurrencySum {
  readonly currency: string;
  readonly amountMinor: number;
  readonly minorPerMajor?: number;
}

export interface CurrencyRatesService {
  /**
   * Returns a Map<currencyCode, rateToUsd> with all known rates. If
   * the table is empty (cold-start before the seed INSERTs land) we
   * return a fallback Map with USD=1.0 — never throw.
   */
  loadAll(): Promise<Map<string, number>>;

  /**
   * Convert a list of per-currency sums to a single USD total.
   * Unknown currency codes contribute 0 with a `console.warn`. Does
   * not throw on missing rates. Equivalent to
   * `normaliseTo('USD', sums)` — kept for back-compat.
   */
  normaliseToUsd(sums: ReadonlyArray<CurrencySum>): Promise<number>;

  /**
   * Convert a list of per-currency sums to a single total in
   * `targetCurrency` (any ISO-4217 code present in `currency_rates`).
   *
   * Math: each slice is (amount in major units) × rate-to-USD ÷
   * target-rate-to-USD. So TZS → KES converts via USD as the bridge
   * unit even when no direct cross-rate exists.
   *
   * If `targetCurrency` is unknown (no row in `currency_rates`),
   * falls back to USD and emits a `console.warn`. If a slice's
   * currency is unknown the slice contributes 0 (same warn). Never
   * throws — currency normalisation is a display concern.
   *
   * Borjie is built for the world (starting with TZ); operators
   * add new currencies via the `refresh-fx-rates` CLI without code
   * changes. This method is the universal aggregator.
   */
  normaliseTo(
    targetCurrency: string,
    sums: ReadonlyArray<CurrencySum>,
  ): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_MINOR_PER_MAJOR = 100;
const FALLBACK_RATES: ReadonlyArray<readonly [string, number]> = [
  ['USD', 1.0],
];

export function createCurrencyRatesService(
  db: DatabaseClient,
): CurrencyRatesService {
  return {
    async loadAll(): Promise<Map<string, number>> {
      try {
        const rows = await db
          .select({
            code: currencyRates.code,
            rateToUsd: currencyRates.rateToUsd,
          })
          .from(currencyRates);

        if (!Array.isArray(rows) || rows.length === 0) {
          return new Map(FALLBACK_RATES);
        }

        const map = new Map<string, number>();
        for (const r of rows) {
          if (!r || typeof r.code !== 'string') continue;
          const rate = Number(r.rateToUsd);
          if (!Number.isFinite(rate) || rate <= 0) continue;
          map.set(r.code.toUpperCase(), rate);
        }

        // Empty after filtering ⇒ still hand back the USD fallback so
        // downstream callers never see a zero-entry map. We intentionally
        // do not include USD in the fallback when other rows existed —
        // operators may have deliberately removed USD (very unlikely,
        // but the fallback is only a cold-start crutch).
        if (map.size === 0) {
          return new Map(FALLBACK_RATES);
        }

        return map;
      } catch (error) {
        // Hard DB failure: surface a USD-only map so the caller can
        // still produce a well-formed (if degraded) USD figure rather
        // than crashing. The router's PARTIAL branch handles the
        // upstream signal.
        logger.error('currency-rates.loadAll failed', { error: error });
        return new Map(FALLBACK_RATES);
      }
    },

    async normaliseToUsd(sums) {
      return this.normaliseTo('USD', sums);
    },

    async normaliseTo(targetCurrency, sums) {
      if (!Array.isArray(sums) || sums.length === 0) return 0;

      const rates = await this.loadAll();
      const target = (targetCurrency ?? 'USD').toUpperCase();
      let targetRate = rates.get(target);
      if (targetRate === undefined) {
        logger.warn(`currency-rates: unknown target currency "${target}" — falling back to USD`);
        targetRate = 1.0; // USD-to-USD
      }

      let totalInTarget = 0;

      for (const slice of sums) {
        if (!slice || typeof slice.currency !== 'string') continue;

        const code = slice.currency.toUpperCase();
        const amountMinor = Number(slice.amountMinor);
        if (!Number.isFinite(amountMinor) || amountMinor === 0) continue;

        const rate = rates.get(code);
        if (rate === undefined) {
          logger.warn(`currency-rates: unknown currency code "${code}" — contributing 0 ${target}`);
          continue;
        }

        const minorPerMajor = Number(
          slice.minorPerMajor ?? DEFAULT_MINOR_PER_MAJOR,
        );
        const denom =
          Number.isFinite(minorPerMajor) && minorPerMajor > 0
            ? minorPerMajor
            : DEFAULT_MINOR_PER_MAJOR;

        const major = amountMinor / denom;
        // major × rate-to-USD = USD; ÷ target-rate-to-USD = target.
        // USD is the bridge so any → any works without direct cross-rates.
        totalInTarget += (major * rate) / targetRate;
      }

      return totalInTarget;
    },
  };
}
