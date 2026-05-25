/**
 * aop-registry-store.service — Drizzle-backed adapter.
 *
 * Satisfies the `AOPRegistryStore` port declared in
 * `packages/central-intelligence/src/agent/aops/aop-registry.ts`. The
 * in-memory store remains the default for dev/tests; this adapter is
 * opt-in at the api-gateway composition root.
 *
 * Operations match the port exactly:
 *
 *   - putSpec(spec): append-only; throws on (id, version) collision.
 *   - listSpecs(): all specs in insertion order.
 *   - putRegressionSet(set): overwrite-on-id allowed.
 *   - listRegressionSets(): all regression sets.
 *   - putActiveVersion(id, version | null): flip active version;
 *     null deactivates.
 *   - listActiveVersions(): all active-version rows.
 *
 * Tenant scoping:
 *   - The port itself is tenant-agnostic (AOPs are typically platform-
 *     global). The constructor accepts an optional `scopeTenantId` so
 *     a multi-tenant deployment can scope reads + writes to a single
 *     tenant. `scopeTenantId === null` = platform-wide pool (default).
 *
 * Error handling:
 *   - `putSpec` rethrows on duplicate so the registry honours the port
 *     contract ("Throws when (id, version) already exists").
 *   - All other writes log + swallow on transient DB errors; the
 *     registry's `refresh()` will re-hydrate on next start.
 *   - All reads return `[]` on DB error so a transient outage doesn't
 *     wedge the registry boot path.
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - Specs are system prompts; no user personal data lands here.
 *   - Append-only on `aop_specs` ⇒ tamper-evident behaviour change
 *     trail (new behaviour = new version row).
 *   - tenant scoping is opt-in via constructor — multi-tenant DPIA
 *     supports either platform-global or per-tenant catalogues.
 */

import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {

  aopActiveVersions,
  aopRegressionSets,
  aopSpecs,
  type AopActiveVersionRow,
  type AopRegressionSetRow,
  type AopSpecRow,
} from '../schemas/aop-registry.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Port shape (mirrors aop-registry.ts AOPSpec / RegressionSet via
// `unknown` so the database package does not compile-time-depend on
// central-intelligence's Zod-derived types).
// ─────────────────────────────────────────────────────────────────────

/** Minimal AOPSpec shape — full schema lives in @borjie/central-intelligence. */
export interface AopSpecLike {
  readonly id: string;
  readonly version: string;
  readonly [k: string]: unknown;
}

export interface RegressionSetLike {
  readonly id: string;
  readonly [k: string]: unknown;
}

export interface AopRegistryStore {
  putSpec(spec: AopSpecLike): Promise<void>;
  listSpecs(): Promise<ReadonlyArray<AopSpecLike>>;
  putRegressionSet(set: RegressionSetLike): Promise<void>;
  listRegressionSets(): Promise<ReadonlyArray<RegressionSetLike>>;
  putActiveVersion(id: string, version: string | null): Promise<void>;
  listActiveVersions(): Promise<
    ReadonlyArray<{ readonly id: string; readonly version: string }>
  >;
}

export interface AopRegistryStoreOpts {
  /** NULL = platform-wide pool. */
  readonly scopeTenantId?: string | null;
}

export function createAopRegistryStoreService(
  db: DatabaseClient,
  opts: AopRegistryStoreOpts = {},
): AopRegistryStore {
  const scopeTenantId = opts.scopeTenantId ?? null;

  function scopePredicate(col: {
    name?: string;
  }): SQL<unknown> {
    return scopeTenantId === null
      ? isNull(col as never)
      : eq(col as never, scopeTenantId);
  }

  return {
    async putSpec(spec) {
      if (!spec?.id || !spec?.version) {
        throw new Error('aop-registry-store.putSpec: id + version are required');
      }
      try {
        // Append-only contract: enforce duplicate-rejection at the
        // application layer too (the PK does it at the SQL layer).
        const existing = (await db
          .select({ id: aopSpecs.id })
          .from(aopSpecs)
          .where(
            and(
              eq(aopSpecs.id, spec.id),
              eq(aopSpecs.version, spec.version),
              scopePredicate(aopSpecs.scopeTenantId),
            ),
          )
          .limit(1)) as ReadonlyArray<{ id: string }>;
        if (existing?.length) {
          throw new Error(
            `aop-registry: duplicate (${spec.id}, ${spec.version})`,
          );
        }

        await db
          .insert(aopSpecs)
          .values({
            id: spec.id,
            version: spec.version,
            scopeTenantId,
            spec: spec as never,
          } as never)
          .onConflictDoNothing({
            target: [aopSpecs.id, aopSpecs.version],
          });
      } catch (error) {
        // Re-throw duplicate errors per port contract; log others.
        if (
          error instanceof Error &&
          /duplicate/i.test(error.message)
        ) {
          throw error;
        }
        logger.error('aop-registry-store.putSpec failed', { error: error });
        throw error;
      }
    },

    async listSpecs() {
      try {
        const rows = (await db
          .select(SPEC_SELECT_COLS)
          .from(aopSpecs)
          .where(scopePredicate(aopSpecs.scopeTenantId))
          .orderBy(asc(aopSpecs.insertedAt))) as ReadonlyArray<AopSpecRow>;
        return Object.freeze(
          (rows ?? []).map((row) => row.spec as unknown as AopSpecLike),
        );
      } catch (error) {
        logger.error('aop-registry-store.listSpecs failed', { error: error });
        return Object.freeze([]);
      }
    },

    async putRegressionSet(set) {
      if (!set?.id) {
        throw new Error('aop-registry-store.putRegressionSet: id is required');
      }
      try {
        await db
          .insert(aopRegressionSets)
          .values({
            id: set.id,
            scopeTenantId,
            payload: set as never,
            updatedAt: new Date(),
          } as never)
          .onConflictDoUpdate({
            target: aopRegressionSets.id,
            set: {
              payload: set as never,
              updatedAt: sql`now()`,
              scopeTenantId,
            } as never,
          });
      } catch (error) {
        logger.error('aop-registry-store.putRegressionSet failed', { error: error });
        // Don't throw — the registry hydrates from listRegressionSets at
        // boot; a transient outage shouldn't wedge the host. The next
        // `putRegressionSet` succeeds without operator intervention.
      }
    },

    async listRegressionSets() {
      try {
        const rows = (await db
          .select(SET_SELECT_COLS)
          .from(aopRegressionSets)
          .where(
            scopePredicate(aopRegressionSets.scopeTenantId),
          )) as ReadonlyArray<AopRegressionSetRow>;
        return Object.freeze(
          (rows ?? []).map(
            (row) => row.payload as unknown as RegressionSetLike,
          ),
        );
      } catch (error) {
        logger.error('aop-registry-store.listRegressionSets failed', { error: error });
        return Object.freeze([]);
      }
    },

    async putActiveVersion(id, version) {
      if (!id) {
        throw new Error(
          'aop-registry-store.putActiveVersion: id is required',
        );
      }
      try {
        if (version === null) {
          await db
            .delete(aopActiveVersions)
            .where(
              and(
                eq(aopActiveVersions.id, id),
                scopePredicate(aopActiveVersions.scopeTenantId),
              ),
            );
          return;
        }
        await db
          .insert(aopActiveVersions)
          .values({
            id,
            scopeTenantId,
            version,
            activatedAt: new Date(),
          } as never)
          .onConflictDoUpdate({
            target: [
              aopActiveVersions.scopeTenantId,
              aopActiveVersions.id,
            ],
            set: {
              version,
              activatedAt: sql`now()`,
            } as never,
          });
      } catch (error) {
        logger.error('aop-registry-store.putActiveVersion failed', { error: error });
        // Best-effort — the registry's refresh() will re-hydrate.
      }
    },

    async listActiveVersions() {
      try {
        const rows = (await db
          .select(ACTIVE_SELECT_COLS)
          .from(aopActiveVersions)
          .where(
            scopePredicate(aopActiveVersions.scopeTenantId),
          )) as ReadonlyArray<AopActiveVersionRow>;
        return Object.freeze(
          (rows ?? []).map((row) =>
            Object.freeze({ id: row.id, version: row.version }),
          ),
        );
      } catch (error) {
        logger.error('aop-registry-store.listActiveVersions failed', { error: error });
        return Object.freeze([]);
      }
    },
  };
}

const SPEC_SELECT_COLS = {
  id: aopSpecs.id,
  version: aopSpecs.version,
  scopeTenantId: aopSpecs.scopeTenantId,
  spec: aopSpecs.spec,
  insertedAt: aopSpecs.insertedAt,
} as const;

const SET_SELECT_COLS = {
  id: aopRegressionSets.id,
  scopeTenantId: aopRegressionSets.scopeTenantId,
  payload: aopRegressionSets.payload,
  updatedAt: aopRegressionSets.updatedAt,
} as const;

const ACTIVE_SELECT_COLS = {
  id: aopActiveVersions.id,
  scopeTenantId: aopActiveVersions.scopeTenantId,
  version: aopActiveVersions.version,
  activatedAt: aopActiveVersions.activatedAt,
} as const;

export { aopActiveVersions, aopRegressionSets, aopSpecs };
