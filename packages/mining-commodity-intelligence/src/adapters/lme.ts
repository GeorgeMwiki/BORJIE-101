/**
 * LME REST adapter — stub implementation.
 *
 * TODO: wire up the real LME REST endpoint once credentials + base
 * URL are provisioned. The structural shape matches PriceSourceAdapter
 * so the orchestrator can already consume this in tests.
 */

import type { PriceSourceAdapter } from '../ports.js';
import type { Commodity, PriceTick } from '../types.js';

export interface LmeAdapterConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export const LME_SOURCE_ID = 'lme-rest';

const DEFAULT_BASE_URL = 'https://api.lme.com/v1';

export function createLmeAdapter(config: LmeAdapterConfig = {}): PriceSourceAdapter {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const apiKey = config.apiKey;
  const f = config.fetchImpl ?? fetch;
  return {
    name: LME_SOURCE_ID,
    async fetchLatest(commodity: Commodity): Promise<PriceTick> {
      // TODO: production fetch — for now return a deterministic stub.
      // Keeping the same shape lets the orchestrator + tests run.
      if (apiKey === undefined) {
        return stubTick(commodity, 1);
      }
      const url = `${baseUrl}/spot/${commodity}`;
      const res = await f(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`LME fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as { price: number; asOf: string };
      return {
        commodity,
        pricePerTonne: body.price,
        currency: 'USD',
        source: LME_SOURCE_ID,
        asOfISO: body.asOf,
      };
    },
    async fetchHistory(commodity: Commodity, sinceISO: string): Promise<ReadonlyArray<PriceTick>> {
      if (apiKey === undefined) {
        const days = Math.max(1, daysBetween(sinceISO, new Date().toISOString()));
        return Array.from({ length: days }, (_, idx) => stubTick(commodity, days - idx));
      }
      const url = `${baseUrl}/history/${commodity}?since=${encodeURIComponent(sinceISO)}`;
      const res = await f(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`LME history fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as Array<{ price: number; asOf: string }>;
      return body.map((row) => ({
        commodity,
        pricePerTonne: row.price,
        currency: 'USD',
        source: LME_SOURCE_ID,
        asOfISO: row.asOf,
      }));
    },
  };
}

function stubTick(commodity: Commodity, daysAgo: number): PriceTick {
  const base = STUB_BASE[commodity] ?? 1000;
  const drift = base * 0.001 * daysAgo;
  const day = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    commodity,
    pricePerTonne: base + drift,
    currency: 'USD',
    source: LME_SOURCE_ID,
    asOfISO: day.toISOString(),
  };
}

function daysBetween(aISO: string, bISO: string): number {
  return Math.abs(
    Math.round((new Date(aISO).getTime() - new Date(bISO).getTime()) / (24 * 60 * 60 * 1000)),
  );
}

const STUB_BASE: Partial<Record<Commodity, number>> = {
  gold: 65_000_000,
  silver: 800_000,
  copper: 9_500,
  cobalt: 30_000,
  nickel: 18_000,
  tin: 28_000,
  zinc: 2_500,
  lead: 2_100,
};
