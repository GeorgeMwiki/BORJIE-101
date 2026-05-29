/**
 * Tenant-config persistence — Issue #207 (world-scale tenants).
 *
 * Wraps the Drizzle SELECT behind a port so the service stays test-
 * able without a live Postgres. The port is intentionally minimal:
 * one method, one row, immutable return.
 *
 * Reads from `tenants` only (no join to `regulator_jurisdictions`).
 * The downstream regulator-set lookup is a separate hop owned by the
 * compliance route layer; this service answers "what is this tenant's
 * regulator-set identifier?" not "what are the authorities in that
 * set?".
 */

import { sql } from 'drizzle-orm';

import type {
  RegulatorSet,
  SupportedCurrency,
  SupportedLanguage,
  TenantConfig,
} from './types.js';
import {
  REGULATOR_SETS,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LANGUAGES,
} from './types.js';

interface PersistenceDb {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as {
    rows?: ReadonlyArray<Record<string, unknown>>;
  };
  return wrapped?.rows ?? [];
}

function coerceCurrency(value: unknown): SupportedCurrency {
  const raw = typeof value === 'string' ? value : 'TZS';
  return (SUPPORTED_CURRENCIES as ReadonlyArray<string>).includes(raw)
    ? (raw as SupportedCurrency)
    : 'TZS';
}

function coerceLanguage(value: unknown): SupportedLanguage {
  const raw = typeof value === 'string' ? value : 'sw';
  return (SUPPORTED_LANGUAGES as ReadonlyArray<string>).includes(raw)
    ? (raw as SupportedLanguage)
    : 'sw';
}

function coerceRegulatorSet(value: unknown): RegulatorSet {
  const raw = typeof value === 'string' ? value : 'TZ-set';
  return (REGULATOR_SETS as ReadonlyArray<string>).includes(raw)
    ? (raw as RegulatorSet)
    : 'TZ-set';
}

function coerceMinerals(value: unknown): ReadonlyArray<string> {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.filter((m): m is string => typeof m === 'string'),
    );
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return coerceMinerals(parsed);
    } catch {
      return Object.freeze([]);
    }
  }
  return Object.freeze([]);
}

function rowToConfig(
  tenantId: string,
  row: Record<string, unknown> | undefined | null,
): TenantConfig | null {
  if (!row) return null;
  const countryCode =
    typeof row['country_code'] === 'string'
      ? (row['country_code'] as string)
      : typeof row['country'] === 'string'
        ? (row['country'] as string)
        : 'TZ';
  return Object.freeze({
    tenantId,
    countryCode,
    defaultCurrency: coerceCurrency(row['primary_currency']),
    defaultLanguage: coerceLanguage(row['default_language']),
    regulatorSet: coerceRegulatorSet(row['regulator_set']),
    allowedMinerals: coerceMinerals(row['allowed_minerals']),
  });
}

export function createDrizzleTenantConfigPersistence(db: PersistenceDb): {
  fetch(tenantId: string): Promise<TenantConfig | null>;
} {
  return {
    async fetch(tenantId) {
      const result = await db.execute(sql`
        SELECT
          country_code,
          country,
          primary_currency,
          default_language,
          regulator_set,
          allowed_minerals
        FROM tenants
        WHERE id = ${tenantId}
        LIMIT 1
      `);
      return rowToConfig(tenantId, rowsOf(result)[0] ?? null);
    },
  };
}
