/**
 * Corpus evidence lookup for the chat orchestrator's graceful-
 * degradation path.
 *
 * Strategy ladder:
 *   1. pgvector ANN — when OPENAI_API_KEY is set, embed the user query
 *      via `embedQueryViaOpenAI` (text-embedding-3-large truncated to
 *      1024-d to match the chunk column) and ORDER BY embedding <-> $1
 *      LIMIT 5. Issue #18.
 *   2. ILIKE fallback — when OPENAI_API_KEY is unset (or the
 *      embedding call fails) we degrade to the previous keyword-OR
 *      ILIKE path with a clear log warning so the deployment realises
 *      semantic search is disabled.
 *
 * Tenant-scoping: `tenant_id IS NULL` (global Borjie corpus) is always
 * visible, plus the caller's `tenant_id` for tenant-private uploads.
 */

import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import pino from 'pino';
import { intelligenceCorpusChunks } from '@borjie/database';

const logger = pino({ name: 'chat-corpus-evidence' });

// ─────────────────────────────────────────────────────────────────────
// Keyword extraction (ILIKE fallback only)
// ─────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'what', 'which', 'when', 'where', 'how', 'why',
  'this', 'that', 'from', 'into', 'about', 'have', 'has', 'are', 'was', 'were',
  'our', 'your', 'their', 'his', 'her', 'its', 'who', 'whom', 'whose', 'will',
]);

/**
 * Pick keyword tokens from the user message for the ILIKE fallback.
 * Strips short / stop words and keeps the top 5 surviving tokens.
 */
export function pickKeywords(message: string): ReadonlyArray<string> {
  const tokens = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OpenAI embedding (1024-d to match chunk column)
// ─────────────────────────────────────────────────────────────────────

/**
 * Embedding endpoint — defaults to the public OpenAI inference URL but
 * accepts `OPENAI_BASE_URL` so deployers can route through Azure
 * OpenAI / a regional proxy / a self-hosted compatible gateway without
 * a code change. We append `/embeddings` if the override does not
 * already terminate at a route.
 */
function resolveOpenAiEmbedUrl(): string {
  const override = process.env.OPENAI_BASE_URL?.trim();
  if (override && override.length > 0) {
    const stripped = override.replace(/\/$/, '');
    return stripped.endsWith('/embeddings') ? stripped : `${stripped}/embeddings`;
  }
  return 'https://api.openai.com/v1/embeddings';
}

const OPENAI_EMBED_MODEL = 'text-embedding-3-large';
const TARGET_DIMENSIONS = 1024;

let warnedNoKey = false;

/**
 * Embed `query` via OpenAI `text-embedding-3-large` truncated to
 * `TARGET_DIMENSIONS` to match the `intelligence_corpus_chunks.embedding`
 * Cohere-shaped column. Returns `null` (with a clear log) when
 * `OPENAI_API_KEY` is missing or the API call fails — callers must
 * fall back to the ILIKE path.
 */
export async function embedQueryViaOpenAI(
  query: string,
): Promise<ReadonlyArray<number> | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (!warnedNoKey) {
      logger.warn('chat-corpus-evidence: semantic search disabled — set OPENAI_API_KEY');
      warnedNoKey = true;
    }
    return null;
  }
  try {
    const response = await fetch(resolveOpenAiEmbedUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_EMBED_MODEL,
        input: query,
        dimensions: TARGET_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.warn(
        `chat-corpus-evidence: OpenAI embed failed ${response.status} — falling back to ILIKE`,
      );
      return null;
    }
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = body.data?.[0]?.embedding;
    if (!vec || vec.length !== TARGET_DIMENSIONS) {
      logger.warn('chat-corpus-evidence: malformed OpenAI embedding payload');
      return null;
    }
    return vec;
  } catch (err) {
    logger.warn(
      { err },
      `chat-corpus-evidence: OpenAI embed threw — ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lookup
// ─────────────────────────────────────────────────────────────────────

export interface CorpusEvidence {
  readonly id: string;
  readonly text: string;
  readonly sourceFile: string;
  readonly url: string | null;
}

/** Max chunks injected into the generation context (top-K cap). */
export const CORPUS_TOPK_DEFAULT = 5;

interface DrizzleSelector {
  select: (cols: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (predicate: unknown) => {
        orderBy: (col: unknown) => {
          limit: (n: number) => Promise<
            ReadonlyArray<{
              id: string;
              text: string;
              sourceFile: string;
              url: string | null;
            }>
          >;
        };
      };
    };
  };
  execute?: (q: unknown) => Promise<unknown>;
}

type CorpusRow = {
  readonly id: string;
  readonly text: string;
  readonly sourceFile: string;
  readonly url: string | null;
};

function tenantPredicate(tenantId: string | null) {
  return tenantId
    ? or(
        isNull(intelligenceCorpusChunks.tenantId),
        eq(intelligenceCorpusChunks.tenantId, tenantId),
      )
    : isNull(intelligenceCorpusChunks.tenantId);
}

/**
 * Find the corpus chunk most-relevant to the message. Returns `null` if
 * the DB is unavailable or no rows match. Tenant-scoped: searches
 * global (`tenant_id IS NULL`) chunks AND tenant-private chunks when
 * `tenantId` is non-null.
 */
export async function findCorpusEvidence(args: {
  readonly db: unknown;
  readonly tenantId: string | null;
  readonly message: string;
}): Promise<CorpusEvidence | null> {
  const top = await findCorpusEvidenceTopK({ ...args, k: 1 });
  return top[0] ?? null;
}

/**
 * Retrieve the top-K corpus chunks most-relevant to the message, in
 * relevance order (best first). Used to GROUND generation — the chunk
 * TEXT (not just the id) is injected into the Master Brain + junior
 * synthesizer prompts. Returns `[]` when the DB is unavailable / no rows
 * match, so callers degrade to the un-grounded path. Tenant-scoped:
 * global (`tenant_id IS NULL`) chunks AND the caller's private chunks.
 */
export async function findCorpusEvidenceTopK(args: {
  readonly db: unknown;
  readonly tenantId: string | null;
  readonly message: string;
  readonly k?: number;
}): Promise<ReadonlyArray<CorpusEvidence>> {
  const db = args.db as DrizzleSelector | null;
  if (!db) return [];
  const k = clampTopK(args.k);

  // Path 1: pgvector ANN via OpenAI embedding.
  const embedding = await embedQueryViaOpenAI(args.message);
  if (embedding && typeof db.execute === 'function') {
    const annHits = await annSearch(db, args.tenantId, embedding, k);
    if (annHits.length > 0) return annHits;
  }

  // Path 2: ILIKE keyword fallback.
  return ilikeSearch(db, args.tenantId, args.message, k);
}

function clampTopK(k: number | undefined): number {
  if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) return CORPUS_TOPK_DEFAULT;
  return Math.min(Math.floor(k), 20);
}

async function annSearch(
  db: DrizzleSelector,
  tenantId: string | null,
  embedding: ReadonlyArray<number>,
  limit: number,
): Promise<ReadonlyArray<CorpusEvidence>> {
  try {
    const vecLiteral = `[${embedding.join(',')}]`;
    const tenantSql = tenantId
      ? sql`(tenant_id IS NULL OR tenant_id = ${tenantId})`
      : sql`tenant_id IS NULL`;
    const queryText = sql`
      SELECT id, source_file, section, chunk_text, url
        FROM intelligence_corpus_chunks
       WHERE ${tenantSql}
         AND embedding IS NOT NULL
       ORDER BY embedding <-> ${vecLiteral}::vector
       LIMIT ${limit}
    `;
    const raw: unknown = await db.execute!(queryText);
    const rows: ReadonlyArray<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as ReadonlyArray<Record<string, unknown>>)
      : (((raw as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows) ?? []);
    return rows.map((row) => ({
      id: String(row.id ?? ''),
      text: String(row.chunk_text ?? row.text ?? ''),
      sourceFile: String(row.source_file ?? ''),
      url: typeof row.url === 'string' ? row.url : null,
    }));
  } catch (err) {
    logger.warn(
      { err },
      `chat-corpus-evidence: ANN query failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function ilikeSearch(
  db: DrizzleSelector,
  tenantId: string | null,
  message: string,
  limit: number,
): Promise<ReadonlyArray<CorpusEvidence>> {
  const keywords = pickKeywords(message);
  const keywordPredicates = keywords.map((k) =>
    ilike(intelligenceCorpusChunks.text, `%${k}%`),
  );
  const wherePred =
    keywordPredicates.length > 0
      ? and(tenantPredicate(tenantId), or(...keywordPredicates))
      : tenantPredicate(tenantId);

  try {
    const rows = (await db
      .select({
        id: intelligenceCorpusChunks.id,
        text: intelligenceCorpusChunks.text,
        sourceFile: intelligenceCorpusChunks.sourceFile,
        url: intelligenceCorpusChunks.url,
      })
      .from(intelligenceCorpusChunks)
      .where(wherePred)
      .orderBy(desc(intelligenceCorpusChunks.ingestedAt))
      .limit(limit)) as ReadonlyArray<CorpusRow>;
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      sourceFile: row.sourceFile,
      url: row.url,
    }));
  } catch {
    return [];
  }
}
