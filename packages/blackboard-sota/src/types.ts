/**
 * `@borjie/blackboard-sota` — public type surface.
 *
 * Wave BLACKBOARD-CORE. Mirrors the 5-table schema introduced by
 * migration `0073_blackboard_sota.sql`:
 *
 *   - Region              — a row in `blackboard_regions`.
 *   - KnowledgeSource     — a row in `blackboard_knowledge_sources`.
 *   - Post                — a row in `blackboard_posts_v2`.
 *   - CrossReference      — a row in `blackboard_cross_references`.
 *   - Summary             — a row in `blackboard_summaries`.
 *
 * Plus the value enumerations the storage layer enforces and the
 * `ControlActivation` envelope the control shell emits.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md.
 */

// ---------------------------------------------------------------------------
// Value enumerations — match the SQL CHECK constraints in 0073_*.sql
// ---------------------------------------------------------------------------

/** Region kinds — concrete enumeration for the mining vertical. */
export const REGION_KINDS = [
  'incident-investigation',
  'royalty-filing-prep',
  'buyer-deal-room',
  'shift-planning',
  'regulator-correspondence',
  'deep-research-session',
  'dashboard-composition',
] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

/** Region status lifecycle. */
export const REGION_STATUSES = ['open', 'active', 'closed'] as const;
export type RegionStatus = (typeof REGION_STATUSES)[number];

/** Kind of knowledge source. */
export const KS_KINDS = [
  'junior',
  'connector',
  'tool',
  'user',
  'external-feed',
] as const;
export type KnowledgeSourceKind = (typeof KS_KINDS)[number];

/** Kinds of detected cross-reference. */
export const CROSSREF_KINDS = [
  'cites',
  'contradicts',
  'answers',
  'supersedes',
  'elaborates',
] as const;
export type CrossReferenceKind = (typeof CROSSREF_KINDS)[number];

/** Summary cadence. */
export const SUMMARY_KINDS = ['rolling', 'final', 'digest'] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];

// ---------------------------------------------------------------------------
// Domain records — one type per row, immutable readonly shapes
// ---------------------------------------------------------------------------

export interface Region {
  /** Stable text identifier, e.g. 'incident-investigation:KAH-088'. */
  readonly id: string;
  readonly tenantId: string;
  readonly scopeId: string | null;
  readonly regionKind: RegionKind;
  readonly status: RegionStatus;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly prevHash: string;
  readonly auditHash: string;
}

export interface KnowledgeSource {
  readonly id: string;
  readonly tenantId: string;
  readonly ksKind: KnowledgeSourceKind;
  readonly ksName: string;
  /** Empty array means "applies to all regions". */
  readonly regionFilter: ReadonlyArray<RegionKind>;
  readonly priority: number;
  readonly auditHash: string;
}

export interface Post {
  readonly id: string;
  readonly tenantId: string;
  readonly regionId: string;
  readonly ksId: string;
  readonly parentPostId: string | null;
  readonly content: string;
  /** OpenAI text-embedding-3-large, 1536-dim. Optional for content-only posts. */
  readonly contentEmbedding: ReadonlyArray<number> | null;
  readonly structured: Readonly<Record<string, unknown>>;
  readonly postedAt: Date;
  readonly editCount: number;
  readonly prevHash: string;
  readonly auditHash: string;
}

export interface CrossReference {
  readonly id: string;
  readonly tenantId: string;
  readonly srcPostId: string;
  readonly dstPostId: string;
  readonly refKind: CrossReferenceKind;
  readonly confidence: number;
  readonly detectedAt: Date;
  readonly auditHash: string;
}

export interface Summary {
  readonly id: string;
  readonly tenantId: string;
  readonly regionId: string;
  readonly summaryKind: SummaryKind;
  readonly summaryText: string;
  readonly tokenCount: number;
  readonly coversFrom: Date;
  readonly coversTo: Date;
  readonly generatedAt: Date;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Control shell envelope
// ---------------------------------------------------------------------------

/**
 * The output of one control-shell tick. Carries the chosen KS, the
 * score, and the breakdown so the runtime can log why this KS was
 * picked.
 */
export interface ControlActivation {
  readonly tenantId: string;
  readonly regionId: string;
  readonly ksId: string;
  readonly ksName: string;
  readonly score: number;
  readonly breakdown: {
    readonly priority: number;
    readonly freshness: number;
    readonly competence: number;
  };
  readonly decidedAt: Date;
}

// ---------------------------------------------------------------------------
// Input shapes — what the application passes when creating rows
// ---------------------------------------------------------------------------

export interface OpenRegionInput {
  readonly id: string;
  readonly tenantId: string;
  readonly regionKind: RegionKind;
  readonly scopeId?: string;
}

export interface RegisterKnowledgeSourceInput {
  readonly tenantId: string;
  readonly ksKind: KnowledgeSourceKind;
  readonly ksName: string;
  readonly regionFilter?: ReadonlyArray<RegionKind>;
  readonly priority?: number;
}

export interface AppendPostInput {
  readonly tenantId: string;
  readonly regionId: string;
  readonly ksId: string;
  readonly content: string;
  readonly contentEmbedding?: ReadonlyArray<number>;
  readonly structured?: Readonly<Record<string, unknown>>;
  readonly parentPostId?: string;
}

export interface RecordCrossReferenceInput {
  readonly tenantId: string;
  readonly srcPostId: string;
  readonly dstPostId: string;
  readonly refKind: CrossReferenceKind;
  readonly confidence: number;
}

export interface AppendSummaryInput {
  readonly tenantId: string;
  readonly regionId: string;
  readonly summaryKind: SummaryKind;
  readonly summaryText: string;
  readonly tokenCount: number;
  readonly coversFrom: Date;
  readonly coversTo: Date;
}

// ---------------------------------------------------------------------------
// Repository contracts — the storage seams. In-memory adapter ships
// with the package; production wires Drizzle on the database package.
// ---------------------------------------------------------------------------

export interface RegionsRepository {
  open(input: OpenRegionInput): Promise<Region>;
  transition(
    tenantId: string,
    id: string,
    next: RegionStatus,
  ): Promise<Region>;
  get(tenantId: string, id: string): Promise<Region | null>;
  listByTenant(
    tenantId: string,
    filter?: { readonly status?: RegionStatus; readonly regionKind?: RegionKind },
  ): Promise<ReadonlyArray<Region>>;
}

export interface KnowledgeSourcesRepository {
  register(
    input: RegisterKnowledgeSourceInput,
  ): Promise<KnowledgeSource>;
  listForRegion(
    tenantId: string,
    regionKind: RegionKind,
  ): Promise<ReadonlyArray<KnowledgeSource>>;
  getById(tenantId: string, id: string): Promise<KnowledgeSource | null>;
}

export interface PostsRepository {
  append(input: AppendPostInput): Promise<Post>;
  listByRegion(
    tenantId: string,
    regionId: string,
    options?: { readonly limit?: number; readonly ascending?: boolean },
  ): Promise<ReadonlyArray<Post>>;
  getById(tenantId: string, id: string): Promise<Post | null>;
}

export interface CrossReferencesRepository {
  record(input: RecordCrossReferenceInput): Promise<CrossReference>;
  listForPost(
    tenantId: string,
    postId: string,
  ): Promise<ReadonlyArray<CrossReference>>;
}

export interface SummariesRepository {
  append(input: AppendSummaryInput): Promise<Summary>;
  listByRegion(
    tenantId: string,
    regionId: string,
  ): Promise<ReadonlyArray<Summary>>;
  latestForRegion(
    tenantId: string,
    regionId: string,
    kind: SummaryKind,
  ): Promise<Summary | null>;
}

// ---------------------------------------------------------------------------
// Cross-surface state bus — CRDT-backed named slots + handoff
//
// MD-as-Body capstone (Docs/research/MD_AS_BODY_ARCHITECTURE.md, lane:
// "cross-surface state bus"). Promotes the blackboard from progress-only
// to the ONE place a decision/doc/task lives: a named slot the MD posts
// to in chat, and which the owner-web tab, workforce-mobile, and
// buyer-mobile all SUBSCRIBE to and project — not copied, lives once.
// The merge is a CRDT so concurrent edits across surfaces/devices never
// stomp each other. Additive: existing region/post/summary consumers are
// untouched.
// ---------------------------------------------------------------------------

/**
 * What kind of object a slot holds. Drives how a subscribing surface
 * chooses to render it (a tab, a card, a banner, a checklist). The bus
 * stays render-agnostic — this is only a hint for the projector.
 */
export const SLOT_KINDS = [
  'decision',
  'document',
  'task',
  'draft',
  'dataset',
  'note',
] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/**
 * The surfaces a slot can live on / be handed off to. Maps onto the
 * four Borjie product surfaces plus the chat front door.
 */
export const SLOT_SURFACES = [
  'chat',
  'owner-web',
  'workforce-mobile',
  'buyer-mobile',
  'admin-web',
] as const;
export type SlotSurface = (typeof SLOT_SURFACES)[number];

/**
 * A Lamport-style logical actor id. Every surface/device that can
 * mutate a slot carries a stable `actorId` (e.g. `owner-web:sess-42`,
 * `brain:md`, `workforce-mobile:device-7`). Used both as the
 * version-vector key and as the deterministic LWW tie-breaker.
 */
export type ActorId = string;

/**
 * A version vector: per-actor monotonic counters. The CRDT merge takes
 * the element-wise max — this is what makes the merge commutative,
 * associative, and idempotent (a join over the lattice of vectors).
 */
export type VersionVector = Readonly<Record<ActorId, number>>;

/**
 * A single CRDT named slot. The state is a Last-Writer-Wins register
 * (Shapiro et al. LWW-Register) carrying an arbitrary JSON value, with
 * a version vector tracking causal history so a stale write can be
 * detected and so merge is order-independent.
 *
 * Ordering of two competing writes (the `dominates` relation):
 *   1. higher Lamport `clock` wins;
 *   2. on a clock tie, higher `wallClockMs` wins;
 *   3. on a wall-clock tie, lexicographically greater `actorId` wins.
 * (3) guarantees a TOTAL order so the merge is deterministic across
 * every replica — never a coin-flip.
 */
export interface Slot {
  readonly tenantId: string;
  /** Stable name, e.g. 'incident:KAH-088:decision'. */
  readonly slotId: string;
  readonly slotKind: SlotKind;
  /** The winning value. `null` means the slot was tombstoned (deleted). */
  readonly value: Readonly<Record<string, unknown>> | null;
  /** The actor whose write currently holds the register. */
  readonly writerId: ActorId;
  /** Lamport clock of the winning write. */
  readonly clock: number;
  /** Wall-clock ms of the winning write (LWW tie-break #2). */
  readonly wallClockMs: number;
  /** True iff the slot is tombstoned. */
  readonly deleted: boolean;
  /** Causal history across all actors that have written this slot. */
  readonly version: VersionVector;
}

/** Input to write (set) a slot value from a given surface/device. */
export interface SlotWriteInput {
  readonly tenantId: string;
  readonly slotId: string;
  readonly slotKind: SlotKind;
  readonly value: Readonly<Record<string, unknown>>;
  /** The surface/device performing the write. */
  readonly actorId: ActorId;
  /** Which surface the writer is on (provenance + handoff source). */
  readonly surface: SlotSurface;
}

/** Input to tombstone (delete) a slot. */
export interface SlotDeleteInput {
  readonly tenantId: string;
  readonly slotId: string;
  readonly actorId: ActorId;
  readonly surface: SlotSurface;
}

/**
 * The wire shape broadcast on the state-bus channel for a slot delta.
 * Subscribers feed it straight into the CRDT merge — the merge is the
 * conflict resolver, so out-of-order / duplicate deliveries are safe
 * (the realtime layer is at-least-once).
 */
export interface SlotDelta {
  readonly tenantId: string;
  readonly slot: Slot;
  /** The surface that originated this delta (for loop-suppression). */
  readonly originSurface: SlotSurface;
}

/**
 * A surface/device handoff request — "move this live object from where
 * it is now onto the surface the human is looking at". The Apple
 * Handoff / Google Continue-On primitive: it does NOT copy the slot, it
 * RE-PROJECTS the same single CRDT slot onto another surface, recording
 * a provenance breadcrumb so the audit trail shows the continuity.
 */
export interface HandoffRequest {
  readonly tenantId: string;
  readonly slotId: string;
  readonly fromSurface: SlotSurface;
  readonly toSurface: SlotSurface;
  /** The actor initiating the handoff (usually the MD or the user). */
  readonly actorId: ActorId;
  /** Optional target device hint within the surface (e.g. 'device-7'). */
  readonly toDevice?: string;
}

/**
 * The result of a handoff: the live slot re-projected onto the target
 * surface. The slot value is unchanged (same object, lives once); only
 * the projection's `surface`/`device` framing differs.
 */
export interface HandoffProjection {
  readonly tenantId: string;
  readonly slotId: string;
  readonly toSurface: SlotSurface;
  readonly toDevice: string | null;
  /** The live slot as it stands at handoff time. */
  readonly slot: Slot;
  /** Chain of surfaces this slot has been projected onto, oldest first. */
  readonly provenance: ReadonlyArray<SlotSurface>;
  readonly handedOffAt: Date;
}

/**
 * Storage seam for slots. The in-memory adapter ships with the package;
 * production wires Drizzle. `merge` is the load-bearing op — it MUST be
 * the CRDT join, never a blind overwrite, so concurrent cross-surface
 * writes converge.
 */
export interface SlotsRepository {
  /** Read the current slot, or null if it has never been written. */
  get(tenantId: string, slotId: string): Promise<Slot | null>;
  /**
   * Merge an incoming slot into storage via the CRDT join and return
   * the converged result. Idempotent: merging the same delta twice is
   * a no-op.
   */
  merge(incoming: Slot): Promise<Slot>;
  /** List every slot for a tenant (optionally filtered by kind). */
  list(
    tenantId: string,
    filter?: { readonly slotKind?: SlotKind },
  ): Promise<ReadonlyArray<Slot>>;
  /** Per-slot projection provenance (surfaces it has been handed to). */
  recordProjection(
    tenantId: string,
    slotId: string,
    surface: SlotSurface,
  ): Promise<ReadonlyArray<SlotSurface>>;
  /** Read the projection provenance for a slot. */
  projectionsOf(
    tenantId: string,
    slotId: string,
  ): Promise<ReadonlyArray<SlotSurface>>;
}

// ---------------------------------------------------------------------------
// Spec constants
// ---------------------------------------------------------------------------

/**
 * Public surface for the blackboard-sota constants. Read by control,
 * crossref, and summary modules.
 */
export const BLACKBOARD_CONSTANTS = {
  /** Embedding dimensionality (OpenAI text-embedding-3-large). */
  EMBEDDING_DIM: 1536,
  /** Default freshness time-constant (seconds). Spec §3.2. */
  FRESHNESS_TAU_SECONDS: 600,
  /** Dormant-region floor on the control-shell score. Spec §6. */
  CONTROL_SHELL_FLOOR: 0.05,
  /** Semantic cross-reference cosine-similarity threshold. Spec §7. */
  SEMANTIC_XREF_THRESHOLD: 0.85,
  /** Rolling summary cron cadence — fire every 30 minutes. */
  ROLLING_SUMMARY_INTERVAL_MS: 30 * 60 * 1000,
  /** Region age before rolling summaries kick in (2 hours). */
  ROLLING_SUMMARY_REGION_AGE_MS: 2 * 60 * 60 * 1000,
  /** Token budget for rolling summaries. Spec §8. */
  ROLLING_SUMMARY_TOKEN_BUDGET: 500,
  /** Token budget for final summaries. */
  FINAL_SUMMARY_TOKEN_BUDGET: 1500,
  /** Token budget for digest summaries. */
  DIGEST_SUMMARY_TOKEN_BUDGET: 3000,
  /** Default chunk size for multi-pass summarisation (tokens). */
  SUMMARY_CHUNK_TOKEN_BUDGET: 2000,
  /** SSE rate limit per tenant (posts/min). Spec §9. */
  SSE_RATE_LIMIT_POSTS_PER_MIN: 100,
  /** SSE heartbeat cadence (ms). */
  SSE_HEARTBEAT_INTERVAL_MS: 15_000,
  /** Default KS priority by kind. Spec §3.2. */
  DEFAULT_KS_PRIORITY: {
    user: 1.0,
    connector: 0.8,
    junior: 0.6,
    tool: 0.5,
    'external-feed': 0.4,
  } satisfies Record<KnowledgeSourceKind, number>,
} as const;
