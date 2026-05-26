/**
 * Kitco gold spot adapter — stub implementation.
 *
 * TODO(#32): replace with the real Kitco JSON endpoint once vendor SLA
 * is agreed. The stub preserves the PriceSourceAdapter shape so it can
 * be wired alongside the LME adapter today.
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
      // TODO(#32): live request — current implementation falls back to
      // stub on network/HTTP failure so downstream pipelines stay green.
      try {
        const res = await f(`${baseUrl}/spot/${commodity}`);
        if (!res.ok) return stubGoldTick(commodity, 0);
        const body = (await res.json()) as { price: number; asOf?: string };
        return {
          commodity,
          pricePerTonne: body.price,
          currency: 'USD',
          source: KITCO_SOURCE_ID,
          asOfISO: body.asOf ?? new Date().toISOString(),
        };
      } catch {
        return stubGoldTick(commodity, 0);
      }
    },
    async fetchHistory(commodity: Commodity, sinceISO: string): Promise<ReadonlyArray<PriceTick>> {
      assertGoldFamily(commodity);
      const days = Math.max(1, daysBetween(sinceISO, new Date().toISOString()));
      return Array.from({ length: days }, (_, idx) =>
        stubGoldTick(commodity, days - idx),
      );
    },
  };
}

function assertGoldFamily(commodity: Commodity): void {
  if (commodity !== 'gold' && commodity !== 'silver') {
    throw new Error(`Kitco adapter only supports gold/silver, got ${commodity}`);
  }
}

function stubGoldTick(commodity: Commodity, daysAgo: number): PriceTick {
  const base = commodity === 'gold' ? 65_500_000 : 820_000;
  const drift = base * 0.0005 * daysAgo;
  const day = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    commodity,
    pricePerTonne: base + drift,
    currency: 'USD',
    source: KITCO_SOURCE_ID,
    asOfISO: day.toISOString(),
  };
}

function daysBetween(aISO: string, bISO: string): number {
  return Math.abs(
    Math.round((new Date(aISO).getTime() - new Date(bISO).getTime()) / (24 * 60 * 60 * 1000)),
  );
}
