/**
 * Drizzle/Postgres cohort-cache store (MEM-01).
 *
 * Durable counterpart to `createInMemoryCohortCacheStore`. Persists entries to
 * `memory_v2_cohort_cache` (migration 0312) so the per-tenant + per-
 * jurisdiction cache survives a process restart. Same `CohortCacheStore` port.
 *
 * Semantics mirror the in-memory store: `expiresAt` is checked on read
 * (expired entries return null and are evicted), and `invalidate` supports an
 * optional key prefix. The `jurisdiction` null is stored as the `_global_`
 * sentinel (same namespacing as the in-memory key) and re-projected to null on
 * read.
 */

import { and, eq, like } from 'drizzle-orm';
import {
  memoryV2CohortCache,
  type DatabaseClient,
  type MemoryV2CohortCacheRow,
} from '@borjie/database';
import { z } from 'zod';

import type {
  CohortCacheEntry,
  CohortCacheStore,
  Jurisdiction,
  TenantId,
} from '../types.js';
import {
  errMessage,
  toIso,
  toIsoOrNull,
  NOOP_STORE_LOGGER,
  type DrizzleStoreLogger,
} from '../drizzle-logger.js';

const GLOBAL_SENTINEL = '_global_';

const entrySchema = z.object({
  tenantId: z.string().min(1),
  key: z.string().min(1),
});

function jurisToColumn(jurisdiction: Jurisdiction): string {
  return jurisdiction ?? GLOBAL_SENTINEL;
}

function columnToJuris(value: string): Jurisdiction {
  return value === GLOBAL_SENTINEL ? null : value;
}

function rowKey(tenantId: TenantId, jurisdiction: Jurisdiction, key: string): string {
  return `${tenantId}:${jurisToColumn(jurisdiction)}:${key}`;
}

function rowToEntry<TValue>(
  row: MemoryV2CohortCacheRow,
): CohortCacheEntry<TValue> {
  return Object.freeze({
    tenantId: row.tenantId,
    jurisdiction: columnToJuris(row.jurisdiction),
    key: row.cacheKey,
    value: row.value as TValue,
    recordedAt: toIso(row.recordedAt),
    expiresAt: toIsoOrNull(row.expiresAt),
  });
}

export function createDrizzleCohortCacheStore(
  db: DatabaseClient,
  logger: DrizzleStoreLogger = NOOP_STORE_LOGGER,
): CohortCacheStore {
  return {
    async get<TValue>(
      tenantId: TenantId,
      jurisdiction: Jurisdiction,
      key: string,
    ): Promise<CohortCacheEntry<TValue> | null> {
      const id = rowKey(tenantId, jurisdiction, key);
      try {
        const rows = (await db
          .select()
          .from(memoryV2CohortCache)
          .where(eq(memoryV2CohortCache.id, id))
          .limit(1)) as ReadonlyArray<MemoryV2CohortCacheRow>;
        const row = rows[0];
        if (row === undefined) return null;
        if (row.expiresAt !== null) {
          const exp =
            row.expiresAt instanceof Date
              ? row.expiresAt.getTime()
              : Date.parse(String(row.expiresAt));
          if (Number.isFinite(exp) && exp <= Date.now()) {
            // Lazy eviction — drop the expired row so it never re-surfaces.
            await db
              .delete(memoryV2CohortCache)
              .where(eq(memoryV2CohortCache.id, id))
              .catch((err: unknown) => {
                logger.warn(
                  'memory-v2 drizzle cohort: expired-evict failed (non-fatal)',
                  { error: errMessage(err) },
                );
              });
            return null;
          }
        }
        return rowToEntry<TValue>(row);
      } catch (err) {
        logger.warn('memory-v2 drizzle cohort: get failed', {
          error: errMessage(err),
        });
        return null;
      }
    },

    async set<TValue>(entry: CohortCacheEntry<TValue>): Promise<void> {
      const parsed = entrySchema.safeParse(entry);
      if (!parsed.success) {
        throw new Error(
          `memory-v2 drizzle cohort: invalid entry (${JSON.stringify(parsed.error.issues)})`,
        );
      }
      const id = rowKey(entry.tenantId, entry.jurisdiction, entry.key);
      try {
        await db
          .insert(memoryV2CohortCache)
          .values({
            id,
            tenantId: entry.tenantId,
            jurisdiction: jurisToColumn(entry.jurisdiction),
            cacheKey: entry.key,
            value: entry.value as unknown,
            recordedAt: new Date(entry.recordedAt),
            expiresAt:
              entry.expiresAt === null ? null : new Date(entry.expiresAt),
          })
          .onConflictDoUpdate({
            target: memoryV2CohortCache.id,
            set: {
              value: entry.value as unknown,
              recordedAt: new Date(entry.recordedAt),
              expiresAt:
                entry.expiresAt === null ? null : new Date(entry.expiresAt),
            },
          });
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle cohort: set failed for ${id}: ${errMessage(err)}`,
        );
      }
    },

    async invalidate(
      tenantId: TenantId,
      jurisdiction: Jurisdiction,
      keyPrefix?: string,
    ): Promise<void> {
      const prefix = rowKey(tenantId, jurisdiction, keyPrefix ?? '');
      try {
        await db
          .delete(memoryV2CohortCache)
          .where(
            and(
              eq(memoryV2CohortCache.tenantId, tenantId),
              eq(
                memoryV2CohortCache.jurisdiction,
                jurisToColumn(jurisdiction),
              ),
              like(memoryV2CohortCache.id, `${escapeLike(prefix)}%`),
            ),
          );
      } catch (err) {
        logger.warn('memory-v2 drizzle cohort: invalidate failed', {
          error: errMessage(err),
        });
      }
    },
  };
}

/** Escape LIKE metacharacters so a literal prefix never matches wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
