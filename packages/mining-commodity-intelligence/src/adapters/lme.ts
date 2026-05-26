/**
 * LME REST adapter.
 *
 * Wave 18Z-cleanup (SCRUB-3): the previous stub branch fabricated price
 * ticks when no `apiKey` was configured. That violates the live-test
 * discipline (`borjie/no-mock-data-in-runtime`) — a managing director
 * the owner trusts MUST NOT make up data. The adapter now throws a
 * `LmeAdapterNotConfiguredError` when no key is present, so the
 * orchestrator surfaces the missing-config posture rather than feeding
 * fake numbers into downstream recommendations.
 *
 * Tests inject `fetchImpl` to return canned responses (see
 * `__tests__/commodity-intelligence.spec.ts` + `__fixtures__/`).
 *
 * See gh-issue #32: wire up the real LME REST endpoint once credentials
 * + base URL are provisioned in the production secret store.
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

export class LmeAdapterNotConfiguredError extends Error {
  constructor() {
    super(
      'LME adapter not configured — set LmeAdapterConfig.apiKey before ' +
        'wiring this adapter into the live commodity-intelligence pipeline. ' +
        'See packages/mining-commodity-intelligence/README.md.',
    );
    this.name = 'LmeAdapterNotConfiguredError';
  }
}

export function createLmeAdapter(config: LmeAdapterConfig = {}): PriceSourceAdapter {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const apiKey = config.apiKey;
  const f = config.fetchImpl ?? fetch;
  return {
    name: LME_SOURCE_ID,
    async fetchLatest(commodity: Commodity): Promise<PriceTick> {
      if (apiKey === undefined) {
        throw new LmeAdapterNotConfiguredError();
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
        throw new LmeAdapterNotConfiguredError();
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
