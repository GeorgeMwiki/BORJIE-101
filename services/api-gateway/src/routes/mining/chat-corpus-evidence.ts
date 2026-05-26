/**
 * Corpus evidence lookup for the chat orchestrator's graceful-
 * degradation path.
 *
 * When ANTHROPIC_API_KEY is unset, the orchestrator still needs to
 * return a citation-grounded answer to keep the owner-web demo working.
 * This module queries `intelligence_corpus_chunks` for the chunk most-
 * keyword-relevant to the user message and returns it as evidence.
 *
 * Two paths land later:
 *   - pgvector ANN search via Cohere embeddings (cosine distance ORDER
 *     BY on the `embedding` column) — the embeddings column is in place
 *     but consolidation hasn't populated it yet.
 *   - tenant-private RAG (per-tenant uploaded docs) — same table,
 *     `tenant_id` set.
 *
 * Until those land, the lookup below is plain ILIKE over the chunk text,
 * which is good enough to demo "corpus-grounded" answers from the
 * global Borjie research bundle (regulation digests, mineral dossiers,
 * geology reference).
 */

import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { intelligenceCorpusChunks } from '@borjie/database';

// ─────────────────────────────────────────────────────────────────────
// Keyword extraction
// ─────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'what', 'which', 'when', 'where', 'how', 'why',
  'this', 'that', 'from', 'into', 'about', 'have', 'has', 'are', 'was', 'were',
  'our', 'your', 'their', 'his', 'her', 'its', 'who', 'whom', 'whose', 'will',
]);

/**
 * Pick keyword tokens from the user message for an ILIKE corpus search.
 * Trivial heuristic — strips short / stop words, keeps the top 5
 * surviving tokens. Good enough for demo grounding; pgvector ANN search
 * supersedes this once embeddings are populated.
 */
export function pickKeywords(message: string): ReadonlyArray<string> {
  const tokens = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
  // Deduplicate while preserving order.
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
// Lookup
// ─────────────────────────────────────────────────────────────────────

export interface CorpusEvidence {
  readonly id: string;
  readonly text: string;
  readonly sourceFile: string;
  readonly url: string | null;
}

/**
 * Drizzle surface we depend on. Typed inline rather than borrowing the
 * full `DatabaseClient` type from `@borjie/database` so this module
 * stays decoupled from the package barrel's namespace-vs-type drift
 * (see middleware/database.ts banner).
 */
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
}

/**
 * Find the corpus chunk most-keyword-relevant to the message. Returns
 * `null` if the DB is unavailable or no rows match. Tenant-scoped: looks
 * at global (`tenant_id IS NULL`) chunks AND tenant-private chunks if a
 * tenantId is given.
 */
export async function findCorpusEvidence(args: {
  readonly db: unknown;
  readonly tenantId: string | null;
  readonly message: string;
}): Promise<CorpusEvidence | null> {
  const db = args.db as DrizzleSelector | null;
  if (!db) return null;

  const keywords = pickKeywords(args.message);
  const tenantPredicate = args.tenantId
    ? or(
        isNull(intelligenceCorpusChunks.tenantId),
        eq(intelligenceCorpusChunks.tenantId, args.tenantId),
      )
    : isNull(intelligenceCorpusChunks.tenantId);

  // ILIKE on each keyword joined with OR. If no keywords survive the
  // filter (very short message), fall back to "any chunk" so the
  // evidence_ids array is never empty.
  const keywordPredicates = keywords.map((k) =>
    ilike(intelligenceCorpusChunks.text, `%${k}%`),
  );
  const wherePred =
    keywordPredicates.length > 0
      ? and(tenantPredicate, or(...keywordPredicates))
      : tenantPredicate;

  try {
    const rows = await db
      .select({
        id: intelligenceCorpusChunks.id,
        text: intelligenceCorpusChunks.text,
        sourceFile: intelligenceCorpusChunks.sourceFile,
        url: intelligenceCorpusChunks.url,
      })
      .from(intelligenceCorpusChunks)
      .where(wherePred)
      .orderBy(desc(intelligenceCorpusChunks.ingestedAt))
      .limit(1);
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
