/**
 * `memory.recall` operation (Wave 18AA).
 *
 * Semantic search over the shared store. The intent is embedded
 * once, then sent through both the tenant-scoped store and (when
 * `include_platform: true`) the federated platform store. Results
 * are merged + ranked. Spec §3.
 *
 * Default behaviour:
 *   - status filter: ['observed','reinforced','consolidated'] (decayed
 *     excluded unless `include_decayed`);
 *   - limit: 8;
 *   - rank: similarity × confidence × recency_weight.
 *
 * This module does NOT mutate any cell. The `access_count` /
 * `last_accessed_at` bump is left to the caller via a separate
 * `markAccessed` step — keeping recall idempotent + cheap, and
 * letting the caller decide whether the recall was "real" (turn-
 * driven) or a passive index probe.
 */

import {
  CognitiveMemoryError,
  EMBEDDING_DIM,
  memoryQuerySchema,
  type CellRepository,
  type EmbeddingService,
  type MemoryKind,
  type MemoryQuery,
  type MemoryStatus,
  type PlatformCellRepository,
  type RecallResult,
} from '../types.js';

const DEFAULT_LIMIT = 8 as const;
const DEFAULT_STATUSES: ReadonlyArray<MemoryStatus> = [
  'observed',
  'reinforced',
  'consolidated',
] as const;

export interface RecallDeps {
  readonly cells: CellRepository;
  readonly platform?: PlatformCellRepository;
  readonly embedder: EmbeddingService;
  readonly now?: () => string;
}

/**
 * Recency weight — newer cells slightly favoured to break ties.
 * Decays linearly over ~365 days down to 0.85; never below.
 */
function recencyWeight(created_at: string, now_iso: string): number {
  const ms = Date.parse(now_iso) - Date.parse(created_at);
  if (Number.isNaN(ms) || ms < 0) {
    return 1;
  }
  const days = ms / (1000 * 60 * 60 * 24);
  const decay = Math.min(0.15, days / 365 * 0.15);
  return 1 - decay;
}

export function createRecall(deps: RecallDeps) {
  const now: () => string = deps.now ?? ((): string => new Date().toISOString());
  return async function recall(query: MemoryQuery): Promise<ReadonlyArray<RecallResult>> {
    const parsed = memoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new CognitiveMemoryError(
        'recall.invalid_query',
        'memory.recall: invalid query',
        { issues: parsed.error.issues },
      );
    }
    const limit = query.limit ?? DEFAULT_LIMIT;
    if (query.intent.trim().length === 0) {
      throw new CognitiveMemoryError(
        'recall.empty_intent',
        'memory.recall: intent is empty',
      );
    }
    const embedding = await deps.embedder.embed(query.intent);
    if (embedding.length !== EMBEDDING_DIM) {
      throw new CognitiveMemoryError(
        'recall.dim_mismatch',
        `memory.recall: embedding dimension mismatch — got ${embedding.length.toString()}`,
      );
    }
    const statuses: ReadonlyArray<MemoryStatus> = query.statuses ?? DEFAULT_STATUSES;
    const final_statuses: ReadonlyArray<MemoryStatus> = query.include_decayed
      ? Array.from(new Set<MemoryStatus>([...statuses, 'decayed']))
      : statuses;
    const kinds_opt: ReadonlyArray<MemoryKind> | undefined = query.kinds;
    const tenant_hits = await deps.cells.searchByEmbedding(
      query.tenant_id,
      query.scope_id,
      embedding,
      kinds_opt === undefined
        ? { limit, statuses: final_statuses }
        : { limit, statuses: final_statuses, kinds: kinds_opt },
    );
    const now_iso = now();
    const ranked: RecallResult[] = tenant_hits.map((hit) => {
      const w = recencyWeight(hit.cell.created_at, now_iso);
      return {
        cell: hit.cell,
        similarity: hit.similarity,
        rank_score: hit.similarity * Math.max(0.1, hit.cell.confidence_score) * w,
      };
    });
    if (query.include_platform === true && deps.platform !== undefined) {
      const platform_hits = await deps.platform.searchByEmbedding(
        embedding,
        kinds_opt === undefined ? { limit } : { limit, kinds: kinds_opt },
      );
      // Platform cells participate in ranking but never override tenant
      // cells of equal score (tenant knowledge wins ties). We achieve
      // this by docking the platform rank by a small ε.
      const epsilon = 1e-6;
      // We map platform cells back into RecallResult by promoting the
      // platform cell into a synthetic CognitiveMemoryCell view. Since
      // the RecallResult is typed against CognitiveMemoryCell, callers
      // who need to distinguish should inspect the recall result; the
      // platform-cell-aware shape is added in a follow-up wave.
      for (const ph of platform_hits) {
        ranked.push({
          cell: {
            id: ph.cell.id,
            tenant_id: '__platform__',
            scope_id: 'platform',
            content: {
              text: ph.cell.content_text,
              embedding: ph.cell.embedding,
              structured: { source_tenant_count: ph.cell.source_tenant_count },
            },
            kind: ph.cell.kind,
            contributed_by_specialisation: 'federation-promoter',
            reinforced_by_specialisations: [],
            contributed_in_turn_id: '',
            reinforced_in_turn_ids: [],
            evidence_citations: [],
            confidence_score: 0.5,
            access_count: 0,
            last_accessed_at: null,
            created_at: ph.cell.created_at,
            promoted_at: ph.cell.promoted_at,
            decayed_at: null,
            promotion_status: ph.cell.promotion_status,
            contradicting_cell_id: null,
            audit_hash: ph.cell.audit_hash,
          },
          similarity: ph.similarity,
          rank_score: ph.similarity * 0.5 - epsilon,
        });
      }
    }
    ranked.sort((a, b) => b.rank_score - a.rank_score);
    return ranked.slice(0, limit);
  };
}

export type RecallFn = ReturnType<typeof createRecall>;
