/**
 * DB adapter — the existing pattern in Borjie: flags live in a
 * Postgres table, evaluated per-tenant. This wraps the existing
 * pattern in the port shape so it can be composed alongside or
 * fallback-from external providers.
 *
 * The adapter is constructed against a minimal `DBClient` shape —
 * pass a Drizzle / pg / Postgres.js wrapper that exposes `query`.
 * Keeping the dep zero-runtime means consumers wire their own driver.
 */

import type { FeatureFlagsPort, Flag, FlagContext } from "./types.js";

/** Minimal client surface — Drizzle exec / pg.query both fit. */
export interface DBClient {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface DBAdapterConfig {
  readonly db: DBClient;
  /** Override for custom schemas. Default: `feature_flags`. */
  readonly tableName?: string;
}

interface FlagRow {
  readonly key: string;
  readonly tenant_id: string | null;
  readonly enabled: boolean;
  readonly variant: string | null;
  readonly rollout_percent: number | null;
}

export function createDBFeatureFlagsAdapter(
  config: DBAdapterConfig
): FeatureFlagsPort {
  const table = config.tableName ?? "feature_flags";

  async function fetchFlag(
    flag: string,
    tenantId: string
  ): Promise<FlagRow | undefined> {
    const rows = await config.db.query<FlagRow>(
      `SELECT key, tenant_id, enabled, variant, rollout_percent
       FROM ${table}
       WHERE key = $1 AND (tenant_id = $2 OR tenant_id IS NULL)
       ORDER BY tenant_id NULLS LAST
       LIMIT 1`,
      [flag, tenantId]
    );
    return rows[0];
  }

  function passesRollout(row: FlagRow, context: FlagContext): boolean {
    if (row.rollout_percent === null) return true;
    const bucket = stickyBucket(row.key, context);
    return bucket < row.rollout_percent;
  }

  return {
    async isEnabled(flag: string, context: FlagContext): Promise<boolean> {
      const row = await fetchFlag(flag, context.tenantId);
      if (!row) return false;
      if (!row.enabled) return false;
      return passesRollout(row, context);
    },

    async getVariant(flag: string, context: FlagContext): Promise<string> {
      const row = await fetchFlag(flag, context.tenantId);
      if (!row || !row.enabled) return "control";
      if (!passesRollout(row, context)) return "control";
      return row.variant ?? "treatment";
    },

    async getAllFlags(tenantId: string): Promise<readonly Flag[]> {
      const rows = await config.db.query<FlagRow>(
        `SELECT DISTINCT ON (key) key, tenant_id, enabled, variant, rollout_percent
         FROM ${table}
         WHERE tenant_id = $1 OR tenant_id IS NULL
         ORDER BY key, tenant_id NULLS LAST`,
        [tenantId]
      );
      return rows.map((r): Flag => {
        return r.variant
          ? { key: r.key, enabled: r.enabled, variant: r.variant }
          : { key: r.key, enabled: r.enabled };
      });
    },
  };
}

function stickyBucket(flag: string, context: FlagContext): number {
  const key = `${flag}:${context.tenantId}:${context.userId ?? "_"}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}
