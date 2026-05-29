/**
 * Drizzle-backed cache adapter — JC-1.
 *
 * Reads / writes the `discovered_jurisdictions` table (migration 0148).
 *
 * RLS-aware: the table is GLOBAL with `is_borjie_internal_admin`
 * gating writes; the api-gateway sets that GUC for the discovery
 * worker so the cache fills transparently during normal chat turns.
 * In test / degraded mode the adapter swallows DB errors and returns
 * `null` — the discovery service falls back to a fresh synthesis.
 */

import { sql } from 'drizzle-orm';
import pino from 'pino';

import type {
  DiscoveryCacheAdapter,
  DiscoveryResult,
  DiscoverySource,
  JurisdictionProfile,
} from './types.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'jurisdiction-discovery-cache',
});

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface DiscoveredRow {
  readonly country_code: string;
  readonly country_name: string;
  readonly profile: unknown;
  readonly confidence_score: string;
  readonly sources: unknown;
  readonly cached_until: string;
}

function isExpired(cachedUntil: string): boolean {
  const expiry = Date.parse(cachedUntil);
  if (!Number.isFinite(expiry)) return true;
  return expiry < Date.now();
}

function rowToResult(row: DiscoveredRow): DiscoveryResult | null {
  if (isExpired(row.cached_until)) return null;
  const profile = row.profile as JurisdictionProfile;
  const sources = row.sources as ReadonlyArray<DiscoverySource>;
  if (!profile || !Array.isArray(sources)) return null;
  const validity = Number(row.confidence_score);
  return Object.freeze({
    profile: Object.freeze({
      ...profile,
      validityScore: Number.isFinite(validity)
        ? validity
        : profile.validityScore,
    }),
    sources: Object.freeze(sources),
    origin: 'cache' as const,
    lowConfidence: validity < 0.5,
  });
}

export function createDrizzleDiscoveryCache(
  db: DbLike | null,
): DiscoveryCacheAdapter {
  return {
    async get(countryCode) {
      if (!db) return null;
      try {
        const result = (await db.execute(sql`
          SELECT
            country_code,
            country_name,
            profile,
            confidence_score::text,
            sources,
            cached_until::text
          FROM discovered_jurisdictions
          WHERE country_code = ${countryCode}
            AND cached_until > NOW()
          LIMIT 1
        `)) as { readonly rows?: ReadonlyArray<DiscoveredRow> } | ReadonlyArray<DiscoveredRow>;
        const rows = Array.isArray(result)
          ? (result as ReadonlyArray<DiscoveredRow>)
          : (result.rows ?? []);
        const row = rows[0];
        if (!row) return null;
        return rowToResult(row);
      } catch (err) {
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            countryCode,
          },
          'discovery-cache: get failed',
        );
        return null;
      }
    },
    async put({ countryCode, result }) {
      if (!db) return;
      try {
        await db.execute(sql`
          INSERT INTO discovered_jurisdictions (
            country_code,
            country_name,
            profile,
            confidence_score,
            sources,
            discovered_at,
            cached_until
          ) VALUES (
            ${countryCode},
            ${result.profile.countryName},
            ${JSON.stringify(result.profile)}::jsonb,
            ${result.profile.validityScore},
            ${JSON.stringify(result.sources)}::jsonb,
            NOW(),
            NOW() + INTERVAL '24 hours'
          )
          ON CONFLICT (country_code) DO UPDATE
             SET country_name      = EXCLUDED.country_name,
                 profile           = EXCLUDED.profile,
                 confidence_score  = EXCLUDED.confidence_score,
                 sources           = EXCLUDED.sources,
                 discovered_at     = EXCLUDED.discovered_at,
                 cached_until      = EXCLUDED.cached_until
        `);
      } catch (err) {
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            countryCode,
          },
          'discovery-cache: put failed',
        );
      }
    },
  };
}
