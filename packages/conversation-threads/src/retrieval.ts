/**
 * Cross-thread retrieval.
 *
 * Behaviour:
 *   - Scope is ALWAYS limited to the (tenant, persona, project) memory
 *     namespace key. No cross-project leak. No cross-persona leak. No
 *     cross-tenant leak.
 *   - Returns candidates ready for MMR rerank (the central-intelligence
 *     `mmrRerank` is called by the consumer with the candidate list).
 *   - Pure function except for the repository fetch. The fetch is
 *     namespace-scoped — we never see other tenants' rows.
 */

import type { Message } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Repository port
// ─────────────────────────────────────────────────────────────────────

export interface RetrievalRepository {
  /**
   * Fetch candidate messages for cross-thread retrieval scoped to a
   * namespace. The adapter is expected to filter by (tenant, persona,
   * project) — the test double in this module enforces that.
   */
  fetchCandidates(args: {
    readonly tenantId: string;
    readonly ownerPersonaId: string;
    readonly projectId: string | null;
    readonly query: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<RetrievalCandidate>>;
}

export interface RetrievalCandidate {
  readonly messageId: string;
  readonly threadId: string;
  readonly content: string;
  /** Optional dense embedding, returned by the upstream vector store. */
  readonly embedding?: ReadonlyArray<number>;
  /** Optional BM25-ish lexical score from upstream, 0..1. */
  readonly lexicalScore?: number;
  /** Optional cosine similarity to the query, -1..1. */
  readonly vectorScore?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Public retrieval API
// ─────────────────────────────────────────────────────────────────────

export interface RetrievalArgs {
  readonly tenantId: string;
  readonly ownerPersonaId: string;
  readonly projectId: string | null;
  readonly query: string;
  readonly limit?: number;
  readonly repository: RetrievalRepository;
}

export const DEFAULT_RETRIEVAL_LIMIT = 20;

export async function retrieveCrossThread(
  args: RetrievalArgs,
): Promise<ReadonlyArray<RetrievalCandidate>> {
  const out = await args.repository.fetchCandidates({
    tenantId: args.tenantId,
    ownerPersonaId: args.ownerPersonaId,
    projectId: args.projectId,
    query: args.query,
    limit: args.limit ?? DEFAULT_RETRIEVAL_LIMIT,
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Reciprocal-rank fusion fallback — when the repository returns both
// lexicalScore and vectorScore, fuse with the canonical k=60 formula.
// (Mirrors central-intelligence/kernel/memory/hybrid-retrieval but
// computed here so this package doesn't depend on the brain.)
// ─────────────────────────────────────────────────────────────────────

export const RRF_K = 60;

export function fuseRrf(
  candidates: ReadonlyArray<RetrievalCandidate>,
): ReadonlyArray<RetrievalCandidate & { readonly fusedScore: number }> {
  const lex = [...candidates].sort(
    (a, b) => (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0),
  );
  const vec = [...candidates].sort(
    (a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0),
  );
  const score = new Map<string, number>();
  for (let i = 0; i < lex.length; i += 1) {
    const c = lex[i];
    if (!c) continue;
    score.set(c.messageId, (score.get(c.messageId) ?? 0) + 1 / (RRF_K + i + 1));
  }
  for (let i = 0; i < vec.length; i += 1) {
    const c = vec[i];
    if (!c) continue;
    score.set(c.messageId, (score.get(c.messageId) ?? 0) + 1 / (RRF_K + i + 1));
  }
  const out = candidates
    .map((c) => ({ ...c, fusedScore: score.get(c.messageId) ?? 0 }))
    .sort((a, b) => b.fusedScore - a.fusedScore);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory repository (test/dev). Strictly filters by
// (tenant, persona, project) and lexically matches on `query` against
// each message's text content. Coverage for the cross-thread retrieval
// tests goes through this implementation.
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryRetrievalIndexEntry {
  readonly tenantId: string;
  readonly ownerPersonaId: string;
  readonly projectId: string | null;
  readonly message: Message;
}

export function createInMemoryRetrievalRepository(args: {
  readonly entries: ReadonlyArray<InMemoryRetrievalIndexEntry>;
}): RetrievalRepository {
  const entries = [...args.entries];
  return {
    async fetchCandidates({ tenantId, ownerPersonaId, projectId, query, limit }) {
      const q = query.trim().toLowerCase();
      const candidates: RetrievalCandidate[] = [];
      for (const e of entries) {
        if (e.tenantId !== tenantId) continue;
        if (e.ownerPersonaId !== ownerPersonaId) continue;
        if (projectId === null) {
          if (e.projectId !== null) continue;
        } else if (e.projectId !== projectId) {
          continue;
        }
        const text = extractText(e.message);
        if (!text) continue;
        const lower = text.toLowerCase();
        const hits = q.length > 0 ? countSubstring(lower, q) : 0;
        if (hits === 0 && q.length > 0) continue;
        candidates.push({
          messageId: e.message.id,
          threadId: e.message.threadId,
          content: text,
          lexicalScore: hits / (text.length + 1),
        });
      }
      candidates.sort(
        (a, b) => (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0),
      );
      return candidates.slice(0, limit);
    },
  };
}

function extractText(m: Message): string | null {
  const c = m.contentJsonb;
  if (
    c &&
    typeof c === 'object' &&
    'text' in c &&
    typeof (c as { text: unknown }).text === 'string'
  ) {
    return (c as { text: string }).text;
  }
  return null;
}

function countSubstring(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = 0;
  while (true) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) break;
    n += 1;
    i = idx + needle.length;
  }
  return n;
}
