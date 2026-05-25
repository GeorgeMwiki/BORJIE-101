/**
 * Platform feature-flags Drizzle adapter — backs the HQ-tier
 * `platform.read_feature_flag` + `platform.set_feature_flag` tools
 * (Central Command Phase B — B1). Migration 0137.
 *
 * Implements both `FeatureFlagReadPort` and `FeatureFlagWritePort` on
 * `platform_feature_flags` (one row per (scope, flag_name)). The
 * `flag_value` JSONB column carries either a boolean or a free-form
 * string variant — the HQ-tool `FeatureFlagValueSchema` validates the
 * union upstream.
 *
 * Hard DB failures degrade gracefully:
 *   - read              : returns the empty default `{ globalValue: null, tenantOverrides: [] }`
 *   - setFlag           : RE-THROWS (sovereign-grade contract — caller must know)
 *   - restoreFlag       : RE-THROWS
 */
import { randomUUID } from 'crypto';
import { and, eq, like } from 'drizzle-orm';
import { platformFeatureFlags } from '../../schemas/platform-feature-flags.schema.js';
import type { DatabaseClient } from '../../client.js';
import { logger } from '../../logger.js';

export type FeatureFlagValue = boolean | string;

export interface ReadFeatureFlagResult {
  readonly flagName: string;
  readonly globalValue: FeatureFlagValue | null;
  readonly tenantOverrides: ReadonlyArray<{
    readonly tenantId: string;
    readonly value: FeatureFlagValue;
    readonly updatedAt: string;
  }>;
}

export interface SetFeatureFlagArgs {
  readonly flagName: string;
  readonly value: FeatureFlagValue;
  readonly scope: 'global' | `tenant:${string}`;
}

export interface SetFeatureFlagResult {
  readonly flagName: string;
  readonly scope: 'global' | `tenant:${string}`;
  readonly previousValue: FeatureFlagValue | null;
  readonly value: FeatureFlagValue;
  readonly updatedAt: string;
}

export interface RestoreFlagArgs {
  readonly flagName: string;
  readonly scope: 'global' | `tenant:${string}`;
  readonly previousValue: FeatureFlagValue | null;
}

export interface PlatformFeatureFlagsService {
  read(flagName: string): Promise<ReadFeatureFlagResult>;
  setFlag(args: SetFeatureFlagArgs): Promise<SetFeatureFlagResult>;
  restoreFlag(args: RestoreFlagArgs): Promise<void>;
}

function toIso(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
    return value;
  }
  return '';
}

function readValue(raw: unknown): FeatureFlagValue | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean' || typeof raw === 'string') return raw;
  // JSONB sometimes round-trips boolean-as-string when serialised by
  // postgres-js for older driver versions; trust booleans only.
  return null;
}

function parseTenantFromScope(scope: string): string | null {
  if (scope === 'global') return null;
  if (scope.startsWith('tenant:')) return scope.slice('tenant:'.length);
  return null;
}

export interface FeatureFlagsDeps {
  /**
   * Caller id (from `HqToolContext.caller.callerId`) for audit columns
   * `created_by` + `last_set_by`. The HQ-tool wiring threads this through
   * a per-call factory; the adapter accepts a getter so writes always
   * stamp the active operator without binding to a singleton.
   */
  readonly resolveActor: () => string;
}

export function createPlatformFeatureFlagsService(
  db: DatabaseClient,
  deps: FeatureFlagsDeps,
): PlatformFeatureFlagsService {
  return {
    async read(flagName) {
      const empty: ReadFeatureFlagResult = {
        flagName,
        globalValue: null,
        tenantOverrides: [],
      };
      try {
        if (!flagName) return empty;
        const rows = (await db
          .select({
            scope: platformFeatureFlags.scope,
            flagValue: platformFeatureFlags.flagValue,
            lastSetAt: platformFeatureFlags.lastSetAt,
          })
          .from(platformFeatureFlags)
          .where(eq(platformFeatureFlags.flagName, flagName))) as ReadonlyArray<{
          scope: string;
          flagValue: unknown;
          lastSetAt: Date | string;
        }>;
        let globalValue: FeatureFlagValue | null = null;
        const overrides: Array<{
          tenantId: string;
          value: FeatureFlagValue;
          updatedAt: string;
        }> = [];
        for (const row of rows) {
          const value = readValue(row.flagValue);
          if (value === null) continue;
          if (row.scope === 'global') {
            globalValue = value;
            continue;
          }
          const tenantId = parseTenantFromScope(row.scope);
          if (!tenantId) continue;
          overrides.push({
            tenantId,
            value,
            updatedAt: toIso(row.lastSetAt),
          });
        }
        return { flagName, globalValue, tenantOverrides: overrides };
      } catch (error) {
        logger.error('platform.featureFlags.read failed', { error: error });
        return empty;
      }
    },

    async setFlag(args) {
      if (!args.flagName) {
        throw new Error('platform.featureFlags.setFlag: flagName is required');
      }
      const actor = deps.resolveActor();
      const now = new Date();
      try {
        // Read the current value for the rollback contract BEFORE we
        // upsert. The HQ-tool spec requires `previousValue` on the
        // output so the rollback can restore deterministically.
        const existing = (await db
          .select({ flagValue: platformFeatureFlags.flagValue })
          .from(platformFeatureFlags)
          .where(
            and(
              eq(platformFeatureFlags.scope, args.scope),
              eq(platformFeatureFlags.flagName, args.flagName),
            ),
          )
          .limit(1)) as ReadonlyArray<{ flagValue: unknown }>;
        const previousValue =
          existing.length > 0 ? readValue(existing[0]?.flagValue) : null;

        if (existing.length === 0) {
          await db.insert(platformFeatureFlags).values({
            id: randomUUID(),
            scope: args.scope,
            flagName: args.flagName,
            flagValue: args.value as never,
            createdAt: now,
            createdBy: actor,
            lastSetAt: now,
            lastSetBy: actor,
          } as never);
        } else {
          await db
            .update(platformFeatureFlags)
            .set({
              flagValue: args.value as never,
              lastSetAt: now,
              lastSetBy: actor,
            } as never)
            .where(
              and(
                eq(platformFeatureFlags.scope, args.scope),
                eq(platformFeatureFlags.flagName, args.flagName),
              ),
            );
        }
        return {
          flagName: args.flagName,
          scope: args.scope,
          previousValue,
          value: args.value,
          updatedAt: now.toISOString(),
        };
      } catch (error) {
        logger.error('platform.featureFlags.setFlag failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.featureFlags.setFlag failed');
      }
    },

    async restoreFlag(args) {
      if (!args.flagName) {
        throw new Error(
          'platform.featureFlags.restoreFlag: flagName is required',
        );
      }
      try {
        if (args.previousValue === null) {
          // Hard-delete the row — there was no prior value, so the
          // override is fully reversed.
          await db
            .delete(platformFeatureFlags)
            .where(
              and(
                eq(platformFeatureFlags.scope, args.scope),
                eq(platformFeatureFlags.flagName, args.flagName),
              ),
            );
          return;
        }
        const actor = deps.resolveActor();
        const now = new Date();
        await db
          .update(platformFeatureFlags)
          .set({
            flagValue: args.previousValue as never,
            lastSetAt: now,
            lastSetBy: actor,
          } as never)
          .where(
            and(
              eq(platformFeatureFlags.scope, args.scope),
              eq(platformFeatureFlags.flagName, args.flagName),
            ),
          );
      } catch (error) {
        logger.error('platform.featureFlags.restoreFlag failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.featureFlags.restoreFlag failed');
      }
    },
  };
}

// `like` reserved for future prefix-search helper exposed to the dashboard.
void like;
