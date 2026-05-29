/**
 * Regulator lookup — Issue #207 (world-scale tenants), WS-3.
 *
 * Reads the tenant-agnostic `regulator_jurisdictions` catalogue
 * (migration 0143) and returns the authorities active for a given
 * regulator set. Callers pass the `TenantConfig.regulatorSet` they
 * already resolved through `TenantConfigService.get`.
 */

import { sql } from 'drizzle-orm';

import type { RegulatorSet } from './types.js';

export interface RegulatorAuthority {
  readonly id: string;
  readonly countryCode: string;
  readonly nameEn: string;
  readonly nameLocal: string | null;
  readonly slug: string;
  readonly regulatorSet: RegulatorSet;
  readonly mandate: string;
  readonly contactUrl: string | null;
  readonly dsrEndpoint: string | null;
  readonly licenceRenewalEndpoint: string | null;
}

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

function rowToAuthority(
  row: Record<string, unknown>,
): RegulatorAuthority | null {
  const id = row['id'];
  const slug = row['slug'];
  const regulatorSet = row['regulator_set'];
  if (typeof id !== 'string' || typeof slug !== 'string' || typeof regulatorSet !== 'string') {
    return null;
  }
  return Object.freeze({
    id,
    countryCode: String(row['country_code'] ?? ''),
    nameEn: String(row['name_en'] ?? ''),
    nameLocal: row['name_local'] == null ? null : String(row['name_local']),
    slug,
    regulatorSet: regulatorSet as RegulatorSet,
    mandate: String(row['mandate'] ?? 'generic'),
    contactUrl: row['contact_url'] == null ? null : String(row['contact_url']),
    dsrEndpoint:
      row['dsr_endpoint'] == null ? null : String(row['dsr_endpoint']),
    licenceRenewalEndpoint:
      row['licence_renewal_endpoint'] == null
        ? null
        : String(row['licence_renewal_endpoint']),
  });
}

export interface RegulatorLookup {
  /**
   * Returns every active authority for a regulator set. Excludes
   * rows that have been retired via active_until <= today.
   */
  forSet(
    regulatorSet: RegulatorSet,
  ): Promise<ReadonlyArray<RegulatorAuthority>>;
}

export function createDrizzleRegulatorLookup(db: PersistenceDb): RegulatorLookup {
  return {
    async forSet(regulatorSet) {
      const result = await db.execute(sql`
        SELECT
          id, country_code, name_en, name_local, slug, regulator_set,
          mandate, contact_url, dsr_endpoint, licence_renewal_endpoint
        FROM regulator_jurisdictions
        WHERE regulator_set = ${regulatorSet}
          AND (active_from IS NULL OR active_from <= CURRENT_DATE)
          AND (active_until IS NULL OR active_until > CURRENT_DATE)
        ORDER BY mandate ASC, slug ASC
      `);
      return Object.freeze(
        rowsOf(result)
          .map(rowToAuthority)
          .filter((r): r is RegulatorAuthority => r !== null),
      );
    },
  };
}
