/**
 * PostGIS extension probe + idempotent installer.
 *
 * Piece A's `core_entity.geo_geog` column uses PostGIS `geography`. On
 * Supabase / RDS-15+ / Neon / Render the extension is one-click; on
 * self-hosted Postgres it requires the operator to run
 * `apt-get install postgresql-15-postgis-3` first.
 *
 * Migration 0186 installs the extension idempotently inside a
 * DO/EXCEPTION block. This module is the runtime probe — callers use
 * it to decide whether geo features are available.
 */

import { sql } from 'drizzle-orm';

/**
 * Minimal port the probe depends on. Any Drizzle client (postgres-js,
 * node-postgres, etc.) satisfies it because they all expose `execute`.
 */
export interface PostGisProbeClient {
  readonly execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

export interface PostGisProbeResult {
  readonly available: boolean;
  readonly version: string | null;
  readonly reason: string | null;
}

/**
 * Probe whether PostGIS is available + installed on the connected
 * database. Returns `{ available: false }` with a `reason` when the
 * extension is unavailable.
 *
 * Safe to call repeatedly — pure read; takes a sub-millisecond table
 * lookup.
 */
export async function probePostGis(
  client: PostGisProbeClient,
): Promise<PostGisProbeResult> {
  try {
    const rows = (await client.execute(
      sql`SELECT extversion FROM pg_extension WHERE extname = 'postgis'`,
    )) as { rows?: ReadonlyArray<{ extversion?: string }> } | unknown;

    const list =
      (rows as { rows?: ReadonlyArray<{ extversion?: string }> })?.rows ?? [];
    if (list.length === 0) {
      return {
        available: false,
        version: null,
        reason: 'postgis extension not installed on this server',
      };
    }
    const first = list[0];
    return {
      available: true,
      version: first?.extversion ?? null,
      reason: null,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'unknown probe error';
    return { available: false, version: null, reason };
  }
}

/**
 * Idempotent installer. Wraps `CREATE EXTENSION IF NOT EXISTS postgis`
 * in a try/catch. Returns the probe result after the attempt.
 *
 * On a managed Postgres that disallows arbitrary extensions, the
 * CREATE EXTENSION call will fail with SQLSTATE 42501
 * (insufficient_privilege) or 0A000 (feature_not_supported). The
 * function does not throw — it returns `{ available: false, reason }`
 * so the caller can decide whether to surface a setup warning.
 */
export async function ensurePostGis(
  client: PostGisProbeClient,
): Promise<PostGisProbeResult> {
  try {
    await client.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'unknown install error';
    // Probe anyway in case the extension was already installed and
    // the CREATE call hit a privilege error.
    const probe = await probePostGis(client);
    if (probe.available) return probe;
    return { available: false, version: null, reason };
  }
  return probePostGis(client);
}
