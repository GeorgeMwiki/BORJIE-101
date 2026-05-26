/**
 * Unified Cognitive Memory — public type surface (Wave 18W).
 *
 * Companion to `docs/DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md`.
 *
 * Every type here is immutable. Cells are never mutated in place —
 * lifecycle transitions (observed → reinforced → consolidated →
 * decayed | contradicted) produce NEW projections via the dedicated
 * promotion/contradiction handlers. This mirrors the immutability
 * discipline used across the Borjie codebase (see coding-style.md).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Memory cell — the atom of learning
// ---------------------------------------------------------------------------

/**
 * The eight kinds of memory cell. Aligned with §2 of the spec.
 */
export const MEMORY_KINDS = [
  'pattern',
  'fact',
  'rule',
  'preference',
  'template',
  'citation',
  'failure',
  'terminology',
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * Promotion lifecycle states. Aligned with §4 of the spec.
 */
export const MEMORY_STATUSES = [
  'observed',
  'reinforced',
  'consolidated',
  'decayed',
  'contradicted',
] as const;

export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/**
 * Scope discriminator. `'tenant_root'` is visible to every
 * specialisation in the tenant. Any other string is treated as an
 * org_unit_id (visible to that org_unit's specialisations + root MD).
 */
export type MemoryScope = 'tenant_root' | string;

/**
 * One free-text + structured citation, as carried in `evidence_citations`.
 * A subset of the SpanCitation contract used by Cognitive Engine D2.
 */
export interface SpanCitation {
  readonly source_kind: 'corpus' | 'research' | 'memory' | 'attachment' | 'cell';
  readonly source_id: string;
  readonly span: string;
  readonly confidence?: number;
}

/**
 * The content payload. `embedding` is the OpenAI text-embedding-3-large
 * vector (1536 dim). `structured` carries kind-specific typed fields
 * (e.g. `{ subject: 'ore_grade', depth_m: 180 }` for a `fact`).
 */
export interface MemoryContent {
  readonly text: string;
  readonly embedding: ReadonlyArray<number>;
  readonly structured: Readonly<Record<string, unknown>>;
}

/**
 * A cognitive memory cell — the unit of shared knowledge.
 */
export interface CognitiveMemoryCell {
  readonly id: string;
  readonly tenant_id: string;
  readonly scope_id: MemoryScope;
  readonly content: MemoryContent;
  readonly kind: MemoryKind;
  readonly contributed_by_specialisation: string;
  readonly reinforced_by_specialisations: ReadonlyArray<string>;
  readonly contributed_in_turn_id: string;
  readonly reinforced_in_turn_ids: ReadonlyArray<string>;
  readonly evidence_citations: ReadonlyArray<SpanCitation>;
  readonly confidence_score: number;
  readonly access_count: number;
  readonly last_accessed_at: string | null;
  readonly created_at: string;
  readonly promoted_at: string | null;
  readonly decayed_at: string | null;
  readonly promotion_status: MemoryStatus;
  readonly contradicting_cell_id: string | null;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Recall query + result
// ---------------------------------------------------------------------------

/**
 * Recall query. `intent` is the natural-language description of what the
 * caller wants. The recall pipeline embeds it, filters by scope + status,
 * and returns the top-N matches by cosine similarity (re-ranked by
 * recency + access_count + confidence).
 */
export interface MemoryQuery {
  readonly tenant_id: string;
  readonly scope_id: MemoryScope;
  readonly intent: string;
  readonly limit?: number;
  readonly kinds?: ReadonlyArray<MemoryKind>;
  readonly statuses?: ReadonlyArray<MemoryStatus>;
  readonly include_decayed?: boolean;
  readonly include_platform?: boolean;
}

export interface RecallResult {
  readonly cell: CognitiveMemoryCell;
  readonly similarity: number;
  readonly rank_score: number;
}

// ---------------------------------------------------------------------------
// Operation contexts — keep specialisation + turn provenance explicit
// ---------------------------------------------------------------------------

/**
 * Every memory write requires (a) the specialisation that performed
 * it, (b) the cognitive_turns id that triggered it, and (c) the
 * tenant + scope. No anonymous writes — provenance is the whole
 * point of unified memory.
 */
export interface MemoryWriteContext {
  readonly tenant_id: string;
  readonly scope_id: MemoryScope;
  readonly specialisation: string;
  readonly turn_id: string;
  readonly now?: string;
}

/**
 * Observe input — the cell's content (the embedding will be filled in
 * by the embedding service) + the kind + optional pre-existing
 * confidence + citations.
 */
export interface ObserveInput {
  readonly content_text: string;
  readonly content_structured?: Readonly<Record<string, unknown>>;
  readonly kind: MemoryKind;
  readonly initial_confidence?: number;
  readonly evidence_citations?: ReadonlyArray<SpanCitation>;
}

/**
 * Reinforce input — points at the cell that was used + confirmed.
 */
export interface ReinforceInput {
  readonly cell_id: string;
  readonly additional_evidence?: ReadonlyArray<SpanCitation>;
  readonly confidence_delta?: number;
}

/**
 * Cite input — link a cell into an artifact the system is composing.
 */
export interface CiteInput {
  readonly cell_id: string;
  readonly artifact_id: string;
  readonly artifact_kind: 'doc' | 'ui' | 'media' | 'campaign' | 'turn' | 'mutation';
  readonly span?: string;
}

/**
 * Contradict input — a later observation that breaks an existing cell.
 * `new_evidence_text` must carry evidence; the contradiction-handler
 * gates the call by evidence confidence.
 */
export interface ContradictInput {
  readonly cell_id: string;
  readonly new_evidence_text: string;
  readonly new_evidence_confidence: number;
  readonly new_evidence_citations?: ReadonlyArray<SpanCitation>;
}

// ---------------------------------------------------------------------------
// Platform memory — federated cross-tenant cells (no PII, no RLS)
// ---------------------------------------------------------------------------

export interface PlatformMemoryCell {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly content_text: string;
  readonly embedding: ReadonlyArray<number>;
  readonly source_tenant_count: number;
  readonly promotion_status: MemoryStatus;
  readonly created_at: string;
  readonly promoted_at: string | null;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Repository ports — narrow, swappable persistence
// ---------------------------------------------------------------------------

export interface CellRepository {
  insert(cell: CognitiveMemoryCell): Promise<CognitiveMemoryCell>;
  read(id: string, tenantId: string): Promise<CognitiveMemoryCell | null>;
  update(
    id: string,
    tenantId: string,
    patch: Partial<
      Pick<
        CognitiveMemoryCell,
        | 'reinforced_by_specialisations'
        | 'reinforced_in_turn_ids'
        | 'evidence_citations'
        | 'confidence_score'
        | 'access_count'
        | 'last_accessed_at'
        | 'promoted_at'
        | 'decayed_at'
        | 'promotion_status'
        | 'contradicting_cell_id'
        | 'audit_hash'
      >
    >,
  ): Promise<CognitiveMemoryCell | null>;
  searchByEmbedding(
    tenantId: string,
    scopeId: MemoryScope,
    embedding: ReadonlyArray<number>,
    opts: {
      readonly limit: number;
      readonly kinds?: ReadonlyArray<MemoryKind>;
      readonly statuses?: ReadonlyArray<MemoryStatus>;
    },
  ): Promise<ReadonlyArray<{ readonly cell: CognitiveMemoryCell; readonly similarity: number }>>;
}

export interface ReinforcementRepository {
  insert(record: {
    readonly id: string;
    readonly cell_id: string;
    readonly tenant_id: string;
    readonly specialisation: string;
    readonly turn_id: string;
    readonly reinforced_at: string;
    readonly audit_hash: string;
  }): Promise<void>;
  listForCell(cellId: string): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly specialisation: string;
      readonly turn_id: string;
      readonly reinforced_at: string;
    }>
  >;
}

export interface PlatformCellRepository {
  searchByEmbedding(
    embedding: ReadonlyArray<number>,
    opts: { readonly limit: number; readonly kinds?: ReadonlyArray<MemoryKind> },
  ): Promise<ReadonlyArray<{ readonly cell: PlatformMemoryCell; readonly similarity: number }>>;
  insert(cell: PlatformMemoryCell): Promise<PlatformMemoryCell>;
}

// ---------------------------------------------------------------------------
// Embedding service port
// ---------------------------------------------------------------------------

export interface EmbeddingService {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

// ---------------------------------------------------------------------------
// Audit chain port — the cognitive-memory package writes one chain
// row per mutation. The host wires the persistence + the secret ring.
// ---------------------------------------------------------------------------

export interface AuditChainPort {
  append(payload: {
    readonly tenant_id: string;
    readonly event_kind:
      | 'memory.observe'
      | 'memory.reinforce'
      | 'memory.cite'
      | 'memory.contradict'
      | 'memory.promote'
      | 'memory.decay';
    readonly cell_id: string;
    readonly specialisation: string;
    readonly turn_id: string;
    readonly occurred_at: string;
    readonly extra?: Readonly<Record<string, unknown>>;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Promotion threshold constants — §4 of the spec
// ---------------------------------------------------------------------------

/** Reinforcement count required for `observed → reinforced`. */
export const REINFORCE_PROMOTION_THRESHOLD = 2 as const;

/** Recall count required for `reinforced → consolidated`. */
export const CONSOLIDATE_RECALL_THRESHOLD = 10 as const;

/** Minimum elapsed days required for `reinforced → consolidated`. */
export const CONSOLIDATE_ELAPSED_DAYS = 14 as const;

/** Idle days that trigger `consolidated → decayed`. */
export const DECAY_IDLE_DAYS = 180 as const;

/** Minimum confidence on `new_evidence` for `contradict` to apply. */
export const CONTRADICT_EVIDENCE_THRESHOLD = 0.7 as const;

/** Tenant count required to federate a pattern to `platform_memory_cells`. */
export const FEDERATION_TENANT_THRESHOLD = 10 as const;

/** Minimum cosine similarity to treat two cells as the same federation cluster. */
export const FEDERATION_SIMILARITY_THRESHOLD = 0.92 as const;

/** Embedding dimensionality — OpenAI text-embedding-3-large. */
export const EMBEDDING_DIM = 1536 as const;

// ---------------------------------------------------------------------------
// Zod schemas — used at the API boundary to validate untyped inputs
// ---------------------------------------------------------------------------

const memoryKindSchema = z.enum(MEMORY_KINDS);
const memoryStatusSchema = z.enum(MEMORY_STATUSES);

const spanCitationSchema = z.object({
  source_kind: z.enum(['corpus', 'research', 'memory', 'attachment', 'cell']),
  source_id: z.string().min(1),
  span: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export const observeInputSchema = z.object({
  content_text: z.string().min(1),
  content_structured: z.record(z.string(), z.unknown()).optional(),
  kind: memoryKindSchema,
  initial_confidence: z.number().min(0).max(1).optional(),
  evidence_citations: z.array(spanCitationSchema).optional(),
});

export const reinforceInputSchema = z.object({
  cell_id: z.string().min(1),
  additional_evidence: z.array(spanCitationSchema).optional(),
  confidence_delta: z.number().min(-1).max(1).optional(),
});

export const citeInputSchema = z.object({
  cell_id: z.string().min(1),
  artifact_id: z.string().min(1),
  artifact_kind: z.enum(['doc', 'ui', 'media', 'campaign', 'turn', 'mutation']),
  span: z.string().optional(),
});

export const contradictInputSchema = z.object({
  cell_id: z.string().min(1),
  new_evidence_text: z.string().min(1),
  new_evidence_confidence: z.number().min(0).max(1),
  new_evidence_citations: z.array(spanCitationSchema).optional(),
});

export const memoryQuerySchema = z.object({
  tenant_id: z.string().min(1),
  scope_id: z.string().min(1),
  intent: z.string().min(1),
  limit: z.number().int().positive().optional(),
  kinds: z.array(memoryKindSchema).optional(),
  statuses: z.array(memoryStatusSchema).optional(),
  include_decayed: z.boolean().optional(),
  include_platform: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Error type — every operation throws or returns a typed error
// ---------------------------------------------------------------------------

export class CognitiveMemoryError extends Error {
  public override readonly name: string = 'CognitiveMemoryError';
  public readonly code: string;
  public readonly cause_detail?: Readonly<Record<string, unknown>>;
  public constructor(
    code: string,
    message: string,
    cause_detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.code = code;
    if (cause_detail !== undefined) {
      this.cause_detail = cause_detail;
    }
  }
}
