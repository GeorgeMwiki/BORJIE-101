/**
 * In-memory episodic store with bi-temporal facts + relevance retrieval.
 *
 * Production adapters (Postgres/pgvector, Drizzle, Redis) implement the
 * same `EpisodicStore` port — this implementation is the reference for
 * tests + local development.
 *
 * Relevance score blends:
 *   - Vector similarity (cosine) on query embedding × episode embedding
 *   - Recency decay (half-life ≈ 30 days)
 *   - Subject / surface / user filter matches as hard gates
 */

import type {
  Episode,
  EpisodeFact,
  EpisodeRetrievalQuery,
  EpisodeWithScore,
  EpisodicStore,
  Id,
} from '../types.js';

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 10;

export function createInMemoryEpisodicStore(): EpisodicStore {
  const episodes = new Map<Id, Episode>();
  const facts = new Map<Id, EpisodeFact[]>();

  return {
    async upsertEpisode(ep: Episode): Promise<Episode> {
      episodes.set(ep.id, ep);
      return ep;
    },

    async recordFact(fact: EpisodeFact): Promise<EpisodeFact> {
      const existing = facts.get(fact.episodeId) ?? [];
      facts.set(fact.episodeId, [...existing, fact]);
      return fact;
    },

    async listFactsForEpisode(
      episodeId: Id,
    ): Promise<ReadonlyArray<EpisodeFact>> {
      return facts.get(episodeId) ?? [];
    },

    async retrieveByRelevance(
      query: EpisodeRetrievalQuery,
    ): Promise<ReadonlyArray<EpisodeWithScore>> {
      const all = Array.from(episodes.values()).filter((ep) => {
        if (ep.tenantId !== query.tenantId) return false;
        if (query.userId && ep.userId !== query.userId) return false;
        if (query.surface && ep.surface !== query.surface) return false;
        if (query.subject && ep.subject !== query.subject) return false;
        if (query.validAt) {
          const t = Date.parse(query.validAt);
          const from = Date.parse(ep.validFrom);
          const to = ep.validTo ? Date.parse(ep.validTo) : Infinity;
          if (Number.isNaN(t) || Number.isNaN(from)) return false;
          if (t < from || t > to) return false;
        }
        return true;
      });

      const now = Date.now();
      const scored: EpisodeWithScore[] = all.map((ep) => {
        const sim = query.queryEmbedding
          ? cosineSimilarity(ep.embedding, query.queryEmbedding)
          : 0.5;
        const recency = computeRecencyDecay(
          Date.parse(ep.recordedAt),
          now,
        );
        const textBoost =
          query.queryText &&
          (ep.title?.toLowerCase().includes(query.queryText.toLowerCase()) ||
            ep.summary
              ?.toLowerCase()
              .includes(query.queryText.toLowerCase()))
            ? 0.1
            : 0;
        const score = Math.min(1, 0.6 * sim + 0.3 * recency + textBoost);
        return { episode: ep, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, query.limit ?? DEFAULT_LIMIT);
    },
  };
}

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

function computeRecencyDecay(recordedAtMs: number, nowMs: number): number {
  if (Number.isNaN(recordedAtMs)) return 0;
  const ageMs = Math.max(0, nowMs - recordedAtMs);
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
}
