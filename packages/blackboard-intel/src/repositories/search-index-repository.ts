/**
 * Search-index repository — in-memory + SQL adapters.
 *
 * Wave BLACKBOARD-INTEL. The in-memory adapter materialises a
 * simple inverted-index over lowercase tokens; production wires the
 * SQL adapter against `blackboard_search_index` (migration 0074),
 * which uses Postgres `tsvector` + GIN.
 *
 * @module @borjie/blackboard-intel/repositories/search-index-repository
 */

import type { SearchIndexRepository } from '../types.js';

interface IndexRow {
  readonly postId: string;
  readonly tenantId: string;
  readonly content: string;
  readonly tokens: ReadonlySet<string>;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Tokenisation helpers — mimics to_tsvector('simple', content) at a high level
// ---------------------------------------------------------------------------

const NON_WORD = /[^a-z0-9]+/i;

export function tokenise(text: string): ReadonlySet<string> {
  const lowered = text.toLowerCase();
  const parts = lowered.split(NON_WORD);
  const out: Set<string> = new Set();
  for (const p of parts) {
    if (p.length === 0) continue;
    out.add(p);
  }
  return out;
}

/**
 * Approximation of `ts_rank_cd` for the in-memory adapter: the rank
 * is the count of query tokens that appear in the row's token-set,
 * divided by the row's token-count (so a tighter match in a shorter
 * post outranks a hit-in-many in a long post).
 */
export function rankCoverage(
  queryTokens: ReadonlySet<string>,
  rowTokens: ReadonlySet<string>,
): number {
  if (rowTokens.size === 0) return 0;
  let hits = 0;
  for (const q of queryTokens) {
    if (rowTokens.has(q)) hits += 1;
  }
  return hits / Math.max(1, rowTokens.size);
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemorySearchIndexRepository(): SearchIndexRepository {
  const byPostId: Map<string, IndexRow> = new Map();
  return {
    async upsert({ postId, tenantId, content, auditHash }) {
      const tokens = tokenise(content);
      byPostId.set(postId, {
        postId,
        tenantId,
        content,
        tokens,
        auditHash,
      });
    },
    async ftsSearch(tenantId, text, k) {
      const queryTokens = tokenise(text);
      if (queryTokens.size === 0) return Object.freeze([]);
      const scored: Array<{ postId: string; rank: number }> = [];
      for (const row of byPostId.values()) {
        if (row.tenantId !== tenantId) continue;
        const rank = rankCoverage(queryTokens, row.tokens);
        if (rank > 0) scored.push({ postId: row.postId, rank });
      }
      scored.sort((a, b) => b.rank - a.rank);
      return Object.freeze(scored.slice(0, k).map((r) => Object.freeze(r)));
    },
    async getContent(tenantId, postId) {
      const row = byPostId.get(postId);
      if (row === undefined || row.tenantId !== tenantId) return null;
      return row.content;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — Drizzle-compatible driver port
// ---------------------------------------------------------------------------

export interface SearchIndexSqlDriver {
  /** Upsert into `blackboard_search_index`. */
  readonly upsertRow: (
    row: Readonly<{
      postId: string;
      tenantId: string;
      content: string;
      auditHash: string;
    }>,
  ) => Promise<void>;
  /** Run a plain-text tsquery against `content_tsvector`. */
  readonly selectFts: (
    tenantId: string,
    text: string,
    k: number,
  ) => Promise<ReadonlyArray<{ postId: string; rank: number }>>;
  /** Read content for a single post. */
  readonly selectContent: (
    tenantId: string,
    postId: string,
  ) => Promise<string | null>;
}

export function createSqlSearchIndexRepository(
  driver: SearchIndexSqlDriver,
): SearchIndexRepository {
  return {
    async upsert(row) {
      await driver.upsertRow(row);
    },
    async ftsSearch(tenantId, text, k) {
      const rows = await driver.selectFts(tenantId, text, k);
      return Object.freeze(rows.map((r) => Object.freeze({ ...r })));
    },
    async getContent(tenantId, postId) {
      return driver.selectContent(tenantId, postId);
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory dense-search adapter (for tests)
// ---------------------------------------------------------------------------

import type {
  DenseSearchIndexPort,
  EmbeddingPort,
} from '../types.js';

interface DenseRow {
  readonly postId: string;
  readonly tenantId: string;
  readonly embedding: ReadonlyArray<number>;
}

export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function createInMemoryDenseSearchIndex(): DenseSearchIndexPort {
  const byPostId: Map<string, DenseRow> = new Map();
  return {
    async upsert(row) {
      byPostId.set(row.postId, row);
    },
    async search(tenantId, queryEmbedding, k) {
      const out: Array<{ postId: string; similarity: number }> = [];
      for (const row of byPostId.values()) {
        if (row.tenantId !== tenantId) continue;
        const sim = cosineSimilarity(queryEmbedding, row.embedding);
        out.push({ postId: row.postId, similarity: sim });
      }
      out.sort((a, b) => b.similarity - a.similarity);
      return Object.freeze(out.slice(0, k).map((r) => Object.freeze(r)));
    },
  };
}

/**
 * Deterministic in-memory embedding port useful for tests. Hashes
 * lowercase tokens into the requested dimension, then L2-normalises.
 */
export function createDeterministicEmbeddingPort(
  dim: number,
): EmbeddingPort {
  return {
    async embed(text) {
      const v = new Array<number>(dim).fill(0);
      const tokens = tokenise(text);
      for (const t of tokens) {
        const h = fnv1a32(t);
        v[h % dim] = (v[h % dim] ?? 0) + 1;
      }
      // L2 normalise (so cosine works without an extra factor).
      let mag = 0;
      for (const x of v) mag += x * x;
      const norm = mag > 0 ? Math.sqrt(mag) : 1;
      for (let i = 0; i < dim; i += 1) {
        v[i] = (v[i] ?? 0) / norm;
      }
      return Object.freeze([...v]);
    },
  };
}

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
