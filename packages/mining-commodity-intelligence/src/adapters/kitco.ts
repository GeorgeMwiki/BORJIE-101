/**
 * Kitco gold spot adapter.
 *
 * Wave 18Z-cleanup (SCRUB-3): the previous catch-all + non-ok branches
 * silently fabricated `stubGoldTick` responses, violating the live-test
 * discipline (`borjie/no-mock-data-in-runtime`). The adapter now rethrows
 * fetch / HTTP failures so consumers learn the upstream is unavailable
 * rather than receiving fake spot prices.
 *
 * Tests inject `fetchImpl` to deliver canned responses; see
 * `__tests__/commodity-intelligence.spec.ts`.
 *
 * See gh-issue #32: replace with the real Kitco JSON endpoint once
 * vendor SLA is agreed.
 */

import type { PriceSourceAdapter } from '../ports.js';
import type { Commodity, PriceTick } from '../types.js';

export interface KitcoAdapterConfig {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export const KITCO_SOURCE_ID = 'kitco-spot';

const DEFAULT_BASE_URL = 'https://data.kitco.com/v1';

export function createKitcoAdapter(config: KitcoAdapterConfig = {}): PriceSourceAdapter {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const f = config.fetchImpl ?? fetch;
  return {
    name: KITCO_SOURCE_ID,
    async fetchLatest(commodity: Commodity): Promise<PriceTick> {
      assertGoldFamily(commodity);
      const res = await f(`${baseUrl}/spot/${commodity}`);
      if (!res.ok) {
        throw new Error(`Kitco fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as { price: number; asOf?: string };
      return {
        commodity,
        pricePerTonne: body.price,
        currency: 'USD',
        source: KITCO_SOURCE_ID,
        asOfISO: body.asOf ?? new Date().toISOString(),
      };
    },
    async fetchHistory(commodity: Commodity, sinceISO: string): Promise<ReadonlyArray<PriceTick>> {
      assertGoldFamily(commodity);
      const res = await f(
        `${baseUrl}/history/${commodity}?since=${encodeURIComponent(sinceISO)}`,
      );
      if (!res.ok) {
        throw new Error(`Kitco history fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as Array<{ price: number; asOf: string }>;
      return body.map((row) => ({
        commodity,
        pricePerTonne: row.price,
        currency: 'USD',
        source: KITCO_SOURCE_ID,
        asOfISO: row.asOf,
      }));
    },
  };
}

function assertGoldFamily(commodity: Commodity): void {
  if (commodity !== 'gold' && commodity !== 'silver') {
    throw new Error(`Kitco adapter only supports gold/silver, got ${commodity}`);
  }
}
