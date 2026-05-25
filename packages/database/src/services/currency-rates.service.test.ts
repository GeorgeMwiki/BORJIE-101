/**
 * Unit tests for createCurrencyRatesService.
 *
 * Mocks the Drizzle DatabaseClient to a tiny thenable chain whose
 * resolved rows we control per-test. We exercise:
 *   • loadAll returns a Map keyed by code
 *   • normaliseToUsd converts a single TZS sum correctly
 *   • normaliseToUsd handles mixed currencies and sums them
 *   • Unknown currency codes contribute 0 (with console.warn)
 *   • Empty rates table → loadAll returns USD=1.0 fallback (no throw)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCurrencyRatesService } from './currency-rates.service.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Stub DatabaseClient — `select(...).from(...)` resolves to the rows
// we hand it. Just enough surface to satisfy the service's call shape.
// ─────────────────────────────────────────────────────────────────────

interface StubRow {
  code: string;
  rateToUsd: number;
}

function makeStubDb(rows: ReadonlyArray<StubRow> | Error): DatabaseClient {
  function makeChain(): unknown {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        if (rows instanceof Error) {
          if (reject) return reject(rows);
          throw rows;
        }
        return resolve(rows);
      },
      catch: (reject: (reason: unknown) => unknown) => {
        if (rows instanceof Error) return reject(rows);
        return chain;
      },
      finally: () => chain,
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => makeChain(),
  };
  return db as unknown as DatabaseClient;
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('createCurrencyRatesService', () => {
  // Inferred-type holders (vi.spyOn's generic return widens awkwardly
  // when annotated explicitly across vitest minor versions; let
  // inference do the work).
  let warnSpy = vi.spyOn(console, 'warn');
  let errorSpy = vi.spyOn(console, 'error');

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('loadAll returns a Map keyed by uppercase code', async () => {
    const db = makeStubDb([
      { code: 'USD', rateToUsd: 1.0 },
      { code: 'TZS', rateToUsd: 0.000395 },
      { code: 'KES', rateToUsd: 0.0077 },
    ]);
    const svc = createCurrencyRatesService(db);

    const map = await svc.loadAll();

    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(3);
    expect(map.get('USD')).toBeCloseTo(1.0, 12);
    expect(map.get('TZS')).toBeCloseTo(0.000395, 12);
    expect(map.get('KES')).toBeCloseTo(0.0077, 12);
  });

  it('normaliseToUsd converts a single TZS sum correctly', async () => {
    // 100,000,000 TZS minor = 1,000,000 TZS major × 0.000395 = ~395 USD
    const db = makeStubDb([
      { code: 'USD', rateToUsd: 1.0 },
      { code: 'TZS', rateToUsd: 0.000395 },
    ]);
    const svc = createCurrencyRatesService(db);

    const usd = await svc.normaliseToUsd([
      { currency: 'TZS', amountMinor: 100_000_000 },
    ]);

    expect(usd).toBeCloseTo(395, 6);
  });

  it('normaliseToUsd handles mixed currencies and sums them', async () => {
    const db = makeStubDb([
      { code: 'USD', rateToUsd: 1.0 },
      { code: 'TZS', rateToUsd: 0.000395 },
      { code: 'KES', rateToUsd: 0.0077 },
    ]);
    const svc = createCurrencyRatesService(db);

    // 100,000,000 TZS minor → 1,000,000 TZS major × 0.000395 = 395.00 USD
    // 10,000,000 KES minor → 100,000 KES major × 0.0077 = 770.00 USD
    // 50,000 USD minor → 500.00 USD major × 1.0 = 500.00 USD
    // Sum ≈ 1665.00 USD
    const usd = await svc.normaliseToUsd([
      { currency: 'TZS', amountMinor: 100_000_000 },
      { currency: 'KES', amountMinor: 10_000_000 },
      { currency: 'USD', amountMinor: 50_000 },
    ]);

    expect(usd).toBeCloseTo(395 + 770 + 500, 6);
  });

  it('unknown currency code contributes 0 and warns via console.warn', async () => {
    const db = makeStubDb([
      { code: 'USD', rateToUsd: 1.0 },
      { code: 'TZS', rateToUsd: 0.000395 },
    ]);
    const svc = createCurrencyRatesService(db);

    // 100,000,000 TZS → 395 USD; XYZ (unknown) → 0
    const usd = await svc.normaliseToUsd([
      { currency: 'TZS', amountMinor: 100_000_000 },
      { currency: 'XYZ', amountMinor: 999_999_999 },
    ]);

    expect(usd).toBeCloseTo(395, 6);
    expect(warnSpy).toHaveBeenCalled();
    const warnArg = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(warnArg).toContain('XYZ');
  });

  it('empty rates table → loadAll returns USD=1.0 fallback (no throw)', async () => {
    const db = makeStubDb([]);
    const svc = createCurrencyRatesService(db);

    const map = await svc.loadAll();

    expect(map.size).toBe(1);
    expect(map.get('USD')).toBe(1.0);
  });

  it('respects custom minorPerMajor when provided', async () => {
    // JPY uses 1 minor unit per major. 1000 JPY minor = 1000 JPY major.
    const db = makeStubDb([{ code: 'JPY', rateToUsd: 0.0067 }]);
    const svc = createCurrencyRatesService(db);

    const usd = await svc.normaliseToUsd([
      { currency: 'JPY', amountMinor: 1000, minorPerMajor: 1 },
    ]);

    expect(usd).toBeCloseTo(1000 * 0.0067, 6);
  });

  it('hard DB error in loadAll falls back to USD=1.0 (no throw)', async () => {
    const db = makeStubDb(new Error('connection lost'));
    const svc = createCurrencyRatesService(db);

    const map = await svc.loadAll();

    expect(map.size).toBe(1);
    expect(map.get('USD')).toBe(1.0);
    expect(errorSpy).toHaveBeenCalled();
  });
});
