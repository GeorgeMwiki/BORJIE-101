/**
 * In-memory corpus index.
 *
 * Holds a small, pre-embedded set of corpus items and supports a scoped
 * k-NN cosine-similarity search. The "scope" filter enforces
 * tenant/user/role visibility before any similarity scoring runs — we
 * never leak across tenant boundaries.
 *
 * TODO: in production, swap for pgvector or a hosted vector DB. The
 * port shape is intentionally identical (`searchScoped`) so the
 * upgrade is drop-in.
 */
import type {
  CorpusItem,
  Embedder,
  Role,
  SearchHit,
} from '../types.js';

function dot(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function norm(a: ReadonlyArray<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export interface SearchScopedArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
  readonly query: string;
  readonly k?: number;
}

/**
 * In-memory, role+tenant-scoped vector index.
 *
 * Adding items: callers pre-compute the embedding and pass it on the
 * {@link CorpusItem}. The index does NOT re-embed on add — it stores
 * what it's given. This keeps `add()` synchronous and IO-free.
 */
export class InMemoryCorpusIndex {
  private readonly items: CorpusItem[] = [];
  private readonly embedder: Embedder;

  constructor(embedder: Embedder) {
    this.embedder = embedder;
  }

  /**
   * Add a corpus item. The caller MUST pre-supply `embedding` — the
   * index does no embedding at write time. Items added without
   * embeddings are silently skipped at search time.
   */
  add(item: CorpusItem): void {
    this.items.push(item);
  }

  /**
   * Bulk-add. Useful for the composition root warming a fresh index.
   */
  addAll(items: ReadonlyArray<CorpusItem>): void {
    for (const item of items) this.add(item);
  }

  /** Current item count — diagnostic. */
  size(): number {
    return this.items.length;
  }

  /**
   * Run a scoped semantic search. Filters first (cheap), then scores
   * (expensive). Returns top-k hits by cosine similarity desc.
   */
  async searchScoped(args: SearchScopedArgs): Promise<ReadonlyArray<SearchHit>> {
    const k = args.k ?? 5;
    if (k <= 0) return [];
    const candidates = this.items.filter((item) => {
      if (item.tenantId !== args.tenantId) return false;
      if (!item.visibleToRoles.includes(args.role)) return false;
      if (item.visibleToUserIds !== '*') {
        if (!item.visibleToUserIds.includes(args.userId)) return false;
      }
      return true;
    });
    if (candidates.length === 0) return [];

    const queryVector = await this.embedder.embed(args.query);
    const hits: SearchHit[] = [];
    for (const item of candidates) {
      if (!item.embedding) continue;
      hits.push({
        item,
        similarity: cosineSimilarity(queryVector, item.embedding),
      });
    }
    return hits.sort((a, b) => b.similarity - a.similarity).slice(0, k);
  }
}
