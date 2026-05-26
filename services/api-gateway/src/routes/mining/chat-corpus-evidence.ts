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
import { intelligenceCorpusChunks } from '@borjie/database';

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

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
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
      // eslint-disable-next-line no-console
      console.warn(
        'chat-corpus-evidence: semantic search disabled — set OPENAI_API_KEY',
      );
      warnedNoKey = true;
    }
    return null;
  }
  try {
    const response = await fetch(OPENAI_EMBED_URL, {
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
      // eslint-disable-next-line no-console
      console.warn(
        `chat-corpus-evidence: OpenAI embed failed ${response.status} — falling back to ILIKE`,
      );
      return null;
    }
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = body.data?.[0]?.embedding;
    if (!vec || vec.length !== TARGET_DIMENSIONS) {
      // eslint-disable-next-line no-console
      console.warn('chat-corpus-evidence: malformed OpenAI embedding payload');
      return null;
    }
    return vec;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
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
  const db = args.db as DrizzleSelector | null;
  if (!db) return null;

  // Path 1: pgvector ANN via OpenAI embedding.
  const embedding = await embedQueryViaOpenAI(args.message);
  if (embedding && typeof db.execute === 'function') {
    const annHit = await annSearch(db, args.tenantId, embedding);
    if (annHit) return annHit;
  }

  // Path 2: ILIKE keyword fallback.
  return ilikeSearch(db, args.tenantId, args.message);
}

async function annSearch(
  db: DrizzleSelector,
  tenantId: string | null,
  embedding: ReadonlyArray<number>,
): Promise<CorpusEvidence | null> {
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
       LIMIT 5
    `;
    const raw: unknown = await db.execute!(queryText);
    const rows: ReadonlyArray<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as ReadonlyArray<Record<string, unknown>>)
      : (((raw as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows) ?? []);
    const top = rows[0];
    if (!top) return null;
    return {
      id: String(top.id ?? ''),
      text: String(top.chunk_text ?? top.text ?? ''),
      sourceFile: String(top.source_file ?? ''),
      url: typeof top.url === 'string' ? top.url : null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `chat-corpus-evidence: ANN query failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function ilikeSearch(
  db: DrizzleSelector,
  tenantId: string | null,
  message: string,
): Promise<CorpusEvidence | null> {
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
      .limit(1)) as ReadonlyArray<CorpusRow>;
    const top = rows[0];
    if (!top) return null;
    return {
      id: top.id,
      text: top.text,
      sourceFile: top.sourceFile,
      url: top.url,
    };
  } catch {
    return null;
  }
}
