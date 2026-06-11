/**
 * Drizzle/Postgres episodic store (MEM-01).
 *
 * Durable counterpart to `createInMemoryEpisodicStore`. Persists episodes +
 * bi-temporal facts to `memory_v2_episodes` / `memory_v2_episode_facts`
 * (migration 0312) so the episodic layer SURVIVES a process restart — the
 * in-memory variant loses every episode on reboot.
 *
 * Design (mirrors `@borjie/cognitive-memory`'s drizzle-cell-repository):
 *   - Same `EpisodicStore` port as the in-memory reference impl; the
 *     composition root swaps one for the other with no other change.
 *   - `retrieveByRelevance` blends pgvector cosine similarity (`<=>`) with a
 *     30-day recency half-life, matching the in-memory scorer. Hard filters
 *     (tenant / user / surface / subject / validAt window) run in SQL.
 *   - Immutability: rows map to NEW frozen domain objects; writes are a single
 *     INSERT ... ON CONFLICT DO UPDATE (upsert) rather than read-modify-write.
 *   - Validation: every public write input is zod-validated before any SQL.
 *   - No `console.*`. A narrow structural logger is injected; on a DB fault a
 *     write throws (so the caller learns) and a read degrades to empty (so the
 *     turn is never blocked by a memory miss).
 *
 * Dependency direction: `@borjie/memory-v2` → `@borjie/database` (one-way; the
 * database package never imports this one, so no cycle).
 */

import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  memoryV2Episodes,
  memoryV2EpisodeFacts,
  type DatabaseClient,
  type MemoryV2EpisodeRow,
  type MemoryV2EpisodeFactRow,
} from '@borjie/database';
import { z } from 'zod';

import type {
  Episode,
  EpisodeFact,
  EpisodeRetrievalQuery,
  EpisodeWithScore,
  EpisodicStore,
  Id,
  MemorySurface,
} from '../types.js';
import {
  errMessage,
  toIso,
  toIsoOrNull,
  toNumber,
  NOOP_STORE_LOGGER,
  type DrizzleStoreLogger,
} from '../drizzle-logger.js';

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 10;

const episodeSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  surface: z.string().min(1),
});

const factSchema = z.object({
  id: z.string().min(1),
  episodeId: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string(),
});

function rowToEpisode(row: MemoryV2EpisodeRow): Episode {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    surface: row.surface as MemorySurface,
    subject: row.subject,
    title: row.title,
    summary: row.summary,
    validFrom: toIso(row.validFrom),
    validTo: toIsoOrNull(row.validTo),
    recordedAt: toIso(row.recordedAt),
    embedding: Object.freeze([...(row.embedding ?? [])]),
    tags: Object.freeze([...row.tags]),
  });
}

function rowToFact(row: MemoryV2EpisodeFactRow): EpisodeFact {
  return Object.freeze({
    id: row.id,
    episodeId: row.episodeId,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    confidence: toNumber(row.confidence),
    validFrom: toIso(row.validFrom),
    validTo: toIsoOrNull(row.validTo),
    recordedAt: toIso(row.recordedAt),
  });
}

function computeRecencyDecay(recordedAtMs: number, nowMs: number): number {
  if (Number.isNaN(recordedAtMs)) return 0;
  const ageMs = Math.max(0, nowMs - recordedAtMs);
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
}

export function createDrizzleEpisodicStore(
  db: DatabaseClient,
  logger: DrizzleStoreLogger = NOOP_STORE_LOGGER,
): EpisodicStore {
  return {
    async upsertEpisode(ep: Episode): Promise<Episode> {
      const parsed = episodeSchema.safeParse(ep);
      if (!parsed.success) {
        throw new Error(
          `memory-v2 drizzle episodic: invalid episode (${JSON.stringify(parsed.error.issues)})`,
        );
      }
      const values = {
        id: ep.id,
        tenantId: ep.tenantId,
        userId: ep.userId,
        surface: ep.surface,
        subject: ep.subject,
        title: ep.title,
        summary: ep.summary,
        validFrom: new Date(ep.validFrom),
        validTo: ep.validTo === null ? null : new Date(ep.validTo),
        recordedAt: new Date(ep.recordedAt),
        embedding: ep.embedding.length > 0 ? [...ep.embedding] : null,
        tags: [...ep.tags],
      };
      try {
        await db
          .insert(memoryV2Episodes)
          .values(values)
          .onConflictDoUpdate({
            target: memoryV2Episodes.id,
            set: {
              userId: values.userId,
              surface: values.surface,
              subject: values.subject,
              title: values.title,
              summary: values.summary,
              validFrom: values.validFrom,
              validTo: values.validTo,
              recordedAt: values.recordedAt,
              embedding: values.embedding,
              tags: values.tags,
            },
          });
        return Object.freeze({ ...ep });
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle episodic: upsertEpisode failed for ${ep.id}: ${errMessage(err)}`,
        );
      }
    },

    async recordFact(fact: EpisodeFact): Promise<EpisodeFact> {
      const parsed = factSchema.safeParse(fact);
      if (!parsed.success) {
        throw new Error(
          `memory-v2 drizzle episodic: invalid fact (${JSON.stringify(parsed.error.issues)})`,
        );
      }
      // The fact carries no tenant_id in the domain type; resolve it from the
      // parent episode so the RLS-scoped row is written correctly.
      let tenantId: string | null = null;
      try {
        const parent = await db
          .select({ tenantId: memoryV2Episodes.tenantId })
          .from(memoryV2Episodes)
          .where(eq(memoryV2Episodes.id, fact.episodeId))
          .limit(1);
        tenantId = parent[0]?.tenantId ?? null;
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle episodic: recordFact parent lookup failed for ${fact.episodeId}: ${errMessage(err)}`,
        );
      }
      if (tenantId === null) {
        throw new Error(
          `memory-v2 drizzle episodic: recordFact has no parent episode ${fact.episodeId}`,
        );
      }
      try {
        await db
          .insert(memoryV2EpisodeFacts)
          .values({
            id: fact.id,
            tenantId,
            episodeId: fact.episodeId,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            confidence: fact.confidence.toFixed(3),
            validFrom: new Date(fact.validFrom),
            validTo: fact.validTo === null ? null : new Date(fact.validTo),
            recordedAt: new Date(fact.recordedAt),
          })
          .onConflictDoNothing({ target: memoryV2EpisodeFacts.id });
        return Object.freeze({ ...fact });
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle episodic: recordFact failed for ${fact.id}: ${errMessage(err)}`,
        );
      }
    },

    async listFactsForEpisode(
      episodeId: Id,
    ): Promise<ReadonlyArray<EpisodeFact>> {
      try {
        const rows = (await db
          .select()
          .from(memoryV2EpisodeFacts)
          .where(
            eq(memoryV2EpisodeFacts.episodeId, episodeId),
          )) as ReadonlyArray<MemoryV2EpisodeFactRow>;
        return rows.map(rowToFact);
      } catch (err) {
        logger.warn('memory-v2 drizzle episodic: listFactsForEpisode failed', {
          error: errMessage(err),
        });
        return [];
      }
    },

    async retrieveByRelevance(
      query: EpisodeRetrievalQuery,
    ): Promise<ReadonlyArray<EpisodeWithScore>> {
      const limit = query.limit ?? DEFAULT_LIMIT;
      const conds: SQL<unknown>[] = [
        eq(memoryV2Episodes.tenantId, query.tenantId),
      ];
      if (query.userId) {
        conds.push(eq(memoryV2Episodes.userId, query.userId));
      }
      if (query.surface) {
        conds.push(eq(memoryV2Episodes.surface, query.surface));
      }
      if (query.subject) {
        conds.push(eq(memoryV2Episodes.subject, query.subject));
      }
      if (query.validAt) {
        const at = new Date(query.validAt);
        if (!Number.isNaN(at.getTime())) {
          conds.push(sql`${memoryV2Episodes.validFrom} <= ${at}`);
          conds.push(
            sql`(${memoryV2Episodes.validTo} IS NULL OR ${memoryV2Episodes.validTo} >= ${at})`,
          );
        }
      }

      try {
        // When a query embedding is supplied, order by pgvector cosine
        // distance (candidates only; the final blended score is computed in
        // app code to match the in-memory scorer exactly). Otherwise fetch the
        // most-recent candidates and rank by recency.
        const hasEmbedding =
          Array.isArray(query.queryEmbedding) &&
          query.queryEmbedding.length > 0;
        // Pull a candidate window larger than `limit` so the blended re-rank
        // has room to reorder; bounded to keep the prompt cheap.
        const candidateLimit = Math.min(Math.max(limit * 4, limit), 200);

        let rows: ReadonlyArray<MemoryV2EpisodeRow>;
        if (hasEmbedding) {
          const literal = `[${(query.queryEmbedding as ReadonlyArray<number>).join(',')}]`;
          const distanceExpr = sql<number>`${memoryV2Episodes.embedding} <=> ${literal}::vector`;
          rows = (await db
            .select()
            .from(memoryV2Episodes)
            .where(and(...conds, sql`${memoryV2Episodes.embedding} IS NOT NULL`))
            .orderBy(distanceExpr)
            .limit(candidateLimit)) as ReadonlyArray<MemoryV2EpisodeRow>;
        } else {
          rows = (await db
            .select()
            .from(memoryV2Episodes)
            .where(and(...conds))
            .orderBy(sql`${memoryV2Episodes.recordedAt} DESC`)
            .limit(candidateLimit)) as ReadonlyArray<MemoryV2EpisodeRow>;
        }

        const now = Date.now();
        const queryEmbedding = query.queryEmbedding ?? null;
        const queryText = query.queryText?.toLowerCase() ?? null;
        const scored: EpisodeWithScore[] = rows.map((row) => {
          const episode = rowToEpisode(row);
          const sim =
            queryEmbedding !== null
              ? cosineSimilarity(episode.embedding, queryEmbedding)
              : 0.5;
          const recency = computeRecencyDecay(
            Date.parse(episode.recordedAt),
            now,
          );
          const textBoost =
            queryText !== null &&
            (episode.title?.toLowerCase().includes(queryText) ||
              episode.summary?.toLowerCase().includes(queryText))
              ? 0.1
              : 0;
          const score = Math.min(1, 0.6 * sim + 0.3 * recency + textBoost);
          return { episode, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit);
      } catch (err) {
        logger.warn('memory-v2 drizzle episodic: retrieveByRelevance failed', {
          error: errMessage(err),
        });
        return [];
      }
    },
  };
}

/** Cosine similarity in [0,1]. Returns 0 on a dimension/length mismatch. */
function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const aiVal = a[i] ?? 0;
    const biVal = b[i] ?? 0;
    dot += aiVal * biVal;
    normA += aiVal * aiVal;
    normB += biVal * biVal;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}
