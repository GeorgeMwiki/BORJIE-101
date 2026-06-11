/**
 * Drizzle/Postgres narrative store (MEM-01).
 *
 * Durable counterpart to `createInMemoryNarrativeStore`. Persists arcs to
 * `memory_v2_narrative_arcs` (migration 0312) so multi-episode arcs survive a
 * process restart. Same `NarrativeStore` port; the composition root swaps one
 * for the other with no other change.
 */

import { desc, eq } from 'drizzle-orm';
import {
  memoryV2NarrativeArcs,
  type DatabaseClient,
  type MemoryV2NarrativeArcRow,
} from '@borjie/database';
import { z } from 'zod';

import type { NarrativeArc, NarrativeStore, TenantId } from '../types.js';
import {
  errMessage,
  toIso,
  toIsoOrNull,
  NOOP_STORE_LOGGER,
  type DrizzleStoreLogger,
} from '../drizzle-logger.js';

const arcSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  title: z.string(),
  summary: z.string(),
});

function rowToArc(row: MemoryV2NarrativeArcRow): NarrativeArc {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    summary: row.summary,
    episodeIds: Object.freeze([...row.episodeIds]),
    startedAt: toIso(row.startedAt),
    endedAt: toIsoOrNull(row.endedAt),
    tags: Object.freeze([...row.tags]),
    recordedAt: toIso(row.recordedAt),
  });
}

export function createDrizzleNarrativeStore(
  db: DatabaseClient,
  logger: DrizzleStoreLogger = NOOP_STORE_LOGGER,
): NarrativeStore {
  return {
    async upsertArc(arc: NarrativeArc): Promise<NarrativeArc> {
      const parsed = arcSchema.safeParse(arc);
      if (!parsed.success) {
        throw new Error(
          `memory-v2 drizzle narrative: invalid arc (${JSON.stringify(parsed.error.issues)})`,
        );
      }
      const values = {
        id: arc.id,
        tenantId: arc.tenantId,
        title: arc.title,
        summary: arc.summary,
        episodeIds: [...arc.episodeIds],
        startedAt: new Date(arc.startedAt),
        endedAt: arc.endedAt === null ? null : new Date(arc.endedAt),
        tags: [...arc.tags],
        recordedAt: new Date(arc.recordedAt),
      };
      try {
        await db
          .insert(memoryV2NarrativeArcs)
          .values(values)
          .onConflictDoUpdate({
            target: memoryV2NarrativeArcs.id,
            set: {
              title: values.title,
              summary: values.summary,
              episodeIds: values.episodeIds,
              startedAt: values.startedAt,
              endedAt: values.endedAt,
              tags: values.tags,
              recordedAt: values.recordedAt,
            },
          });
        return Object.freeze({ ...arc });
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle narrative: upsertArc failed for ${arc.id}: ${errMessage(err)}`,
        );
      }
    },

    async listArcsForTenant(
      tenantId: TenantId,
      limit = 25,
    ): Promise<ReadonlyArray<NarrativeArc>> {
      try {
        const rows = (await db
          .select()
          .from(memoryV2NarrativeArcs)
          .where(eq(memoryV2NarrativeArcs.tenantId, tenantId))
          .orderBy(desc(memoryV2NarrativeArcs.recordedAt))
          .limit(limit)) as ReadonlyArray<MemoryV2NarrativeArcRow>;
        return rows.map(rowToArc);
      } catch (err) {
        logger.warn('memory-v2 drizzle narrative: listArcsForTenant failed', {
          error: errMessage(err),
        });
        return [];
      }
    },
  };
}
