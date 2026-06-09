/**
 * Platform LLM-routing-config Drizzle adapter — backs the internal admin
 * console's CONTROL PLANE over model selection (migration 0320). One row per
 * `scope` (a single JSONB `config` document), where scope is `global` or
 * `tenant:<tenantId>`.
 *
 * Mirrors the platform feature-flags service contract exactly:
 *   - read        : degrades to `null` on a hard DB failure (the router then
 *                   falls back to the static TASK_LADDER — fail-safe).
 *   - setRouting  : RE-THROWS on write failure (sovereign-grade contract; the
 *                   admin route must know the write failed). Captures the
 *                   previousValue for the rollback contract + stamps
 *                   created_by / last_set_by via the injected actor getter.
 *   - restoreRouting : RE-THROWS; restores the captured previousValue (or
 *                   deletes the row when there was none).
 *
 * This service NEVER touches the money path, ledger, or any sovereign rail —
 * it only reads/writes which-model config. The route layer enforces admin-only
 * auth + emits the hash-chained audit event; this adapter is the storage seam.
 */
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { platformLlmRoutingConfig } from '../../schemas/platform-llm-routing-config.schema.js';
import type { DatabaseClient } from '../../client.js';
import { logger } from '../../logger.js';

/** A scope is `global` or `tenant:<tenantId>`. */
export type RoutingConfigScope = 'global' | `tenant:${string}`;

/**
 * The routing-config document. Kept structurally loose here (the
 * brain-llm-router owns the authoritative validateRoutingConfig); this service
 * persists + reads it as an opaque JSON document so the schema stays in one
 * place (the consumer) and the DB row never blocks a new field.
 */
export interface RoutingConfigDocument {
  readonly coreModel?: string;
  readonly orderedFallbacks?: readonly string[];
  readonly ensemble?: {
    readonly enabled: boolean;
    readonly members: readonly string[];
    readonly combineStrategy:
      | 'first-wins'
      | 'majority-vote'
      | 'judge-synthesis'
      | 'debate';
    readonly judgeModel?: string;
  };
  readonly perUseCase?: Readonly<Record<string, string>>;
}

export interface ReadRoutingConfigResult {
  readonly scope: RoutingConfigScope;
  readonly config: RoutingConfigDocument | null;
  readonly lastSetAt: string | null;
}

export interface SetRoutingConfigArgs {
  readonly scope: RoutingConfigScope;
  readonly config: RoutingConfigDocument;
}

export interface SetRoutingConfigResult {
  readonly scope: RoutingConfigScope;
  readonly previousConfig: RoutingConfigDocument | null;
  readonly config: RoutingConfigDocument;
  readonly updatedAt: string;
}

export interface RestoreRoutingConfigArgs {
  readonly scope: RoutingConfigScope;
  readonly previousConfig: RoutingConfigDocument | null;
}

export interface PlatformLlmRoutingConfigService {
  /** Read the config for one scope; null when none is set or on DB failure. */
  read(scope: RoutingConfigScope): Promise<ReadRoutingConfigResult>;
  /** Read every scope's config (admin catalog view). Degrades to [] on failure. */
  readAll(): Promise<ReadonlyArray<ReadRoutingConfigResult>>;
  /** Upsert the config for a scope. RE-THROWS on write failure. */
  setRouting(args: SetRoutingConfigArgs): Promise<SetRoutingConfigResult>;
  /** Restore a captured previous config (rollback). RE-THROWS on failure. */
  restoreRouting(args: RestoreRoutingConfigArgs): Promise<void>;
}

export interface LlmRoutingConfigDeps {
  /**
   * Caller id (from the admin auth context) for audit columns created_by +
   * last_set_by. A getter so writes always stamp the active operator without
   * binding to a singleton.
   */
  readonly resolveActor: () => string;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const asDate = new Date(value);
    return Number.isNaN(asDate.getTime()) ? value : asDate.toISOString();
  }
  return null;
}

function readConfig(raw: unknown): RoutingConfigDocument | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  // The router's validateRoutingConfig is the authoritative gate; here we only
  // confirm it is a plain object so a corrupt row reads as `null` (fail-safe).
  return raw as RoutingConfigDocument;
}

export function createPlatformLlmRoutingConfigService(
  db: DatabaseClient,
  deps: LlmRoutingConfigDeps,
): PlatformLlmRoutingConfigService {
  return {
    async read(scope) {
      const empty: ReadRoutingConfigResult = { scope, config: null, lastSetAt: null };
      try {
        if (!scope) return empty;
        const rows = (await db
          .select({
            config: platformLlmRoutingConfig.config,
            lastSetAt: platformLlmRoutingConfig.lastSetAt,
          })
          .from(platformLlmRoutingConfig)
          .where(eq(platformLlmRoutingConfig.scope, scope))
          .limit(1)) as ReadonlyArray<{ config: unknown; lastSetAt: Date | string }>;
        if (rows.length === 0) return empty;
        return {
          scope,
          config: readConfig(rows[0]?.config),
          lastSetAt: toIso(rows[0]?.lastSetAt),
        };
      } catch (error) {
        logger.error('platform.llmRoutingConfig.read failed', { error });
        return empty;
      }
    },

    async readAll() {
      try {
        const rows = (await db
          .select({
            scope: platformLlmRoutingConfig.scope,
            config: platformLlmRoutingConfig.config,
            lastSetAt: platformLlmRoutingConfig.lastSetAt,
          })
          .from(platformLlmRoutingConfig)) as ReadonlyArray<{
          scope: string;
          config: unknown;
          lastSetAt: Date | string;
        }>;
        return rows.map((r) => ({
          scope: r.scope as RoutingConfigScope,
          config: readConfig(r.config),
          lastSetAt: toIso(r.lastSetAt),
        }));
      } catch (error) {
        logger.error('platform.llmRoutingConfig.readAll failed', { error });
        return [];
      }
    },

    async setRouting(args) {
      if (!args.scope) {
        throw new Error('platform.llmRoutingConfig.setRouting: scope is required');
      }
      const actor = deps.resolveActor();
      const now = new Date();
      try {
        const existing = (await db
          .select({ config: platformLlmRoutingConfig.config })
          .from(platformLlmRoutingConfig)
          .where(eq(platformLlmRoutingConfig.scope, args.scope))
          .limit(1)) as ReadonlyArray<{ config: unknown }>;
        const previousConfig =
          existing.length > 0 ? readConfig(existing[0]?.config) : null;

        if (existing.length === 0) {
          await db.insert(platformLlmRoutingConfig).values({
            id: randomUUID(),
            scope: args.scope,
            config: args.config as never,
            createdAt: now,
            createdBy: actor,
            lastSetAt: now,
            lastSetBy: actor,
          } as never);
        } else {
          await db
            .update(platformLlmRoutingConfig)
            .set({
              config: args.config as never,
              lastSetAt: now,
              lastSetBy: actor,
            } as never)
            .where(eq(platformLlmRoutingConfig.scope, args.scope));
        }
        return {
          scope: args.scope,
          previousConfig,
          config: args.config,
          updatedAt: now.toISOString(),
        };
      } catch (error) {
        logger.error('platform.llmRoutingConfig.setRouting failed', { error });
        throw error instanceof Error
          ? error
          : new Error('platform.llmRoutingConfig.setRouting failed');
      }
    },

    async restoreRouting(args) {
      if (!args.scope) {
        throw new Error('platform.llmRoutingConfig.restoreRouting: scope is required');
      }
      try {
        if (args.previousConfig === null) {
          await db
            .delete(platformLlmRoutingConfig)
            .where(eq(platformLlmRoutingConfig.scope, args.scope));
          return;
        }
        const actor = deps.resolveActor();
        const now = new Date();
        await db
          .update(platformLlmRoutingConfig)
          .set({
            config: args.previousConfig as never,
            lastSetAt: now,
            lastSetBy: actor,
          } as never)
          .where(eq(platformLlmRoutingConfig.scope, args.scope));
      } catch (error) {
        logger.error('platform.llmRoutingConfig.restoreRouting failed', { error });
        throw error instanceof Error
          ? error
          : new Error('platform.llmRoutingConfig.restoreRouting failed');
      }
    },
  };
}

// `and` reserved for a future composite (scope, use_case) lookup helper.
void and;
