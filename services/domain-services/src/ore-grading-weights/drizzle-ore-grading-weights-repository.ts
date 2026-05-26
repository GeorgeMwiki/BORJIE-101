/**
 * Drizzle-backed Ore Grading Weights repository (Borjie mining).
 *
 * Reads/writes per-tenant ore-grading weights inside the existing
 * `tenants.settings` jsonb column. We deliberately avoid a dedicated
 * table — weights are a single six-number config blob per tenant, so
 * a sibling jsonb key inside settings keeps the schema flat and
 * removes the need for a migration.
 */

import { eq, sql } from 'drizzle-orm';
import { tenants } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  DEFAULT_ORE_GRADING_WEIGHTS,
  oreGradingWeightsSchema,
  parseWeights,
  type OreGradingWeights,
  type OreGradingWeightsRepository,
} from './types.js';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

const SETTINGS_KEY = 'oreGradingWeights';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class DrizzleOreGradingWeightsRepository
  implements OreGradingWeightsRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async getWeights(tenantId: TenantId): Promise<OreGradingWeights> {
    const rows = (await (
      this.db as unknown as {
        select: (cols: Record<string, unknown>) => {
          from: (t: typeof tenants) => {
            where: (cond: unknown) => {
              limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId as unknown as string))
      .limit(1)) as readonly Record<string, unknown>[];
    if (rows.length === 0) return DEFAULT_ORE_GRADING_WEIGHTS;
    const settings = (rows[0]?.settings ?? {}) as Record<string, unknown>;
    return parseWeights(settings[SETTINGS_KEY]);
  }

  async setWeights(
    tenantId: TenantId,
    weights: OreGradingWeights,
  ): Promise<OreGradingWeights> {
    const validated = oreGradingWeightsSchema.parse(weights);
    // jsonb_set on the existing settings preserves every other key the
    // tenant has configured (billing, branding, etc.). Falls back to an
    // empty object if settings is NULL.
    await (
      this.db as unknown as {
        update: (t: typeof tenants) => {
          set: (v: Record<string, unknown>) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
      }
    )
      .update(tenants)
      .set({
        settings: sql`jsonb_set(COALESCE(${tenants.settings}, '{}'::jsonb), ${'{' + SETTINGS_KEY + '}'}::text[], ${JSON.stringify(validated)}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId as unknown as string));
    return validated;
  }
}
