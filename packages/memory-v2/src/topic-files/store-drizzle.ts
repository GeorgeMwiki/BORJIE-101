/**
 * Drizzle/Postgres topic-file store (MEM-01).
 *
 * Durable counterpart to `createInMemoryTopicFileStore`. Persists topic shards
 * to `memory_v2_topic_files` (migration 0312) so topic-scoped recall survives a
 * process restart. Same `TopicFileStore` port; the row id is the synthetic
 * `${tenantId}:${topic}` so the upsert dedupes per (tenant, topic).
 */

import { eq } from 'drizzle-orm';
import {
  memoryV2TopicFiles,
  type DatabaseClient,
  type MemoryV2TopicFileRow,
} from '@borjie/database';
import { z } from 'zod';

import type {
  EpisodeFact,
  TenantId,
  TopicFile,
  TopicFileStore,
} from '../types.js';
import {
  errMessage,
  toIso,
  NOOP_STORE_LOGGER,
  type DrizzleStoreLogger,
} from '../drizzle-logger.js';

const topicSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  topic: z.string().min(1),
});

function rowToTopic(row: MemoryV2TopicFileRow): TopicFile {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    topic: row.topic,
    summary: row.summary,
    facts: Object.freeze(
      Array.isArray(row.facts)
        ? (row.facts as ReadonlyArray<EpisodeFact>)
        : [],
    ),
    episodeIds: Object.freeze([...row.episodeIds]),
    updatedAt: toIso(row.updatedAt),
    createdAt: toIso(row.createdAt),
  });
}

export function createDrizzleTopicFileStore(
  db: DatabaseClient,
  logger: DrizzleStoreLogger = NOOP_STORE_LOGGER,
): TopicFileStore {
  return {
    async upsertTopic(file: TopicFile): Promise<TopicFile> {
      const parsed = topicSchema.safeParse(file);
      if (!parsed.success) {
        throw new Error(
          `memory-v2 drizzle topic: invalid topic file (${JSON.stringify(parsed.error.issues)})`,
        );
      }
      const id = `${file.tenantId}:${file.topic}`;
      try {
        await db
          .insert(memoryV2TopicFiles)
          .values({
            id,
            tenantId: file.tenantId,
            topic: file.topic,
            summary: file.summary,
            facts: [...file.facts],
            episodeIds: [...file.episodeIds],
            updatedAt: new Date(file.updatedAt),
            createdAt: new Date(file.createdAt),
          })
          .onConflictDoUpdate({
            target: memoryV2TopicFiles.id,
            set: {
              summary: file.summary,
              facts: [...file.facts],
              episodeIds: [...file.episodeIds],
              updatedAt: new Date(file.updatedAt),
            },
          });
        return Object.freeze({ ...file });
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle topic: upsertTopic failed for ${id}: ${errMessage(err)}`,
        );
      }
    },

    async getByTopic(
      tenantId: TenantId,
      topic: string,
    ): Promise<TopicFile | null> {
      try {
        const rows = (await db
          .select()
          .from(memoryV2TopicFiles)
          .where(eq(memoryV2TopicFiles.id, `${tenantId}:${topic}`))
          .limit(1)) as ReadonlyArray<MemoryV2TopicFileRow>;
        const row = rows[0];
        return row === undefined ? null : rowToTopic(row);
      } catch (err) {
        logger.warn('memory-v2 drizzle topic: getByTopic failed', {
          error: errMessage(err),
        });
        return null;
      }
    },
  };
}
