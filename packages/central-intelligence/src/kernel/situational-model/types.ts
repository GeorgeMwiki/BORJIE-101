/**
 * Situational-model types — the standing, decaying, per-tenant situational
 * state the resident `EstateMind` loop WRITES every tick and the per-request
 * `think(req)` Fast Loop can READ (Wave 1, organ #2 of
 * `Docs/research/MD_COGNITIVE_KERNEL_ARCHITECTURE.md` §2.3).
 *
 * This is the #1 missing organ named by INV-D: a LIDA "Current Situational
 * Model" — a small library of the estate entities the MD currently cares
 * about (licences, counterparties, pits/sites, arrears, equipment, cash),
 * each carrying an ACT-R-style ACTIVATION (salience) field so "what is
 * salient right now" is a COMPUTED quantity, not a hand-maintained flag.
 *
 * DESIGN INVARIANTS (CLAUDE.md hard rails + coding-style):
 *   - Immutable. Every field is `readonly`; updates build NEW frozen objects,
 *     never mutate. The decay/activation maths are pure functions of
 *     (entity, now).
 *   - Tenant-scoped. One model per tenant; an entity key is unique within a
 *     tenant. The store NEVER mixes tenants.
 *   - Additive + read-only for the Fast Loop. The Slow Loop is the only
 *     writer; `think(req)` only ever READS the snapshot (no recompute-cold).
 *   - No money/licence ACTION lives here. This organ PERCEIVES + holds state;
 *     proposing/acting is the EstateMind loop's job, gated downstream.
 *
 * The maths follow ACT-R's declarative-memory activation equation
 * (Anderson & Lebiere), reduced to the two terms that matter for an estate
 * situational buffer:
 *
 *   activation(i) = base_level(i) + spreading(i)
 *
 *   base_level(i) = ln( Σ_k t_k^(-d) )      (recency × frequency, d = decay)
 *   spreading(i)  = Σ_j w_j · S_ji          (salience flowing from related
 *                                            entities the MD is attending to)
 *
 * We keep an exact, durable summary of the base-level series via the
 * standard ACT-R "optimized learning" approximation so we never have to
 * store every individual reference timestamp — only (referenceCount,
 * firstReferencedAt, lastReferencedAt). That keeps a row small + bounded
 * while preserving the recency×frequency shape.
 */

/**
 * The kinds of estate entity the situational model tracks. Domain-agnostic
 * by intent: BossNyumba would load the same organ with a real-estate entity
 * pack (the kernel never changes — only the loaded rows). The mining set:
 *   - licence       — a mining/operating licence (currency, renewal horizon)
 *   - counterparty  — a buyer / off-taker / vendor relationship
 *   - site          — a pit / processing site / camp
 *   - arrears       — an outstanding-royalty / receivable position
 *   - equipment     — a machine / fleet asset (health, maintenance)
 *   - cash          — a treasury / cash-runway position
 */
export const SITUATION_ENTITY_KINDS = [
  'licence',
  'counterparty',
  'site',
  'arrears',
  'equipment',
  'cash',
] as const;

export type SituationEntityKind = (typeof SITUATION_ENTITY_KINDS)[number];

/**
 * One estate entity as the MD currently holds it in working/situational
 * memory. The `attributes` bag carries the domain measurements the
 * motivation drives read (e.g. `{ runwayDays: 41 }`, `{ renewalInDays: 9 }`).
 * Kept as an opaque JSON record so the organ stays domain-free — the drives
 * own the vocabulary, not the model.
 */
export interface SituationEntity {
  readonly tenantId: string;
  /** Unique within (tenantId, kind). e.g. licence id, counterparty id. */
  readonly entityId: string;
  readonly kind: SituationEntityKind;
  /** Short human label for proposals / logs (never load-bearing). */
  readonly label: string;
  /**
   * Domain measurements the drives evaluate. Opaque to the organ; values are
   * JSON scalars/objects. NEVER mutated — a new entity is built on update.
   */
  readonly attributes: Readonly<Record<string, unknown>>;
  /**
   * ACT-R base-level "optimized learning" summary. We store the compressed
   * series, not every timestamp, so a row stays bounded.
   */
  readonly referenceCount: number;
  /** ms epoch of the first time this entity entered the buffer. */
  readonly firstReferencedAtMs: number;
  /** ms epoch of the most recent reference (drives the recency term). */
  readonly lastReferencedAtMs: number;
  /**
   * Optional explicit spreading-source weights: other entityKeys this entity
   * is associated with and the strength S_ji of the link. Used by the
   * spreading-activation term. Empty by default.
   */
  readonly associations: Readonly<Record<string, number>>;
  /** When this row was last written by the loop (audit / freshness). */
  readonly updatedAtMs: number;
}

/** A stable composite key for an entity within a tenant model. */
export type SituationEntityKey = string; // `${kind}:${entityId}`

export function entityKeyOf(kind: SituationEntityKind, entityId: string): SituationEntityKey {
  return `${kind}:${entityId}`;
}

/**
 * An entity decorated with its computed activation at a reference instant.
 * The activation is NEVER persisted (it is a pure function of the row + now);
 * it is computed on read so a stale snapshot can't carry a stale salience.
 */
export interface ActivatedEntity {
  readonly entity: SituationEntity;
  /** activation = baseLevel + spreading, computed at the read instant. */
  readonly activation: number;
  readonly baseLevel: number;
  readonly spreading: number;
}

/**
 * The whole per-tenant situational model snapshot the Fast Loop reads. The
 * `broadcast` is the Global-Workspace single broadcast: "the one thing I'd
 * worry about right now" — the highest-activation entity (or null when the
 * model is empty). Computed, never stored.
 */
export interface SituationalSnapshot {
  readonly tenantId: string;
  /** All tracked entities, decorated with activation, highest-first. */
  readonly entities: ReadonlyArray<ActivatedEntity>;
  /** The single most-salient entity (GWT broadcast), or null if empty. */
  readonly broadcast: ActivatedEntity | null;
  /** ms epoch the snapshot was computed at. */
  readonly computedAtMs: number;
}

/**
 * Input to record/refresh one entity in the model (an observation from a
 * sensor / memory). Recording an existing entity bumps its reference series
 * (recency + frequency) and merges attributes — it never silently drops the
 * prior measurement history.
 */
export interface RecordEntityInput {
  readonly tenantId: string;
  readonly entityId: string;
  readonly kind: SituationEntityKind;
  readonly label: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  /** Optional association weights to other entity keys. */
  readonly associations?: Readonly<Record<string, number>>;
  /** Observation time; defaults to the store clock. */
  readonly observedAtMs?: number;
}

/**
 * Activation tuning. Defaults follow the ACT-R canon (decay d ≈ 0.5) with a
 * modest spreading source activation. Exposed so a tenant could tune the
 * estate's "attention temperament" later — never hard-coded at a call site.
 */
export interface ActivationParams {
  /** ACT-R base-level decay exponent `d`. Canonical default 0.5. */
  readonly decay: number;
  /** Source activation `W` shared across spreading links. Default 1.0. */
  readonly sourceActivation: number;
  /**
   * Floor below which an entity is considered "out of attention" and may be
   * pruned by the loop. Default −Infinity (never prune on activation alone).
   */
  readonly retrievalThreshold: number;
}

export const DEFAULT_ACTIVATION_PARAMS: ActivationParams = Object.freeze({
  decay: 0.5,
  sourceActivation: 1.0,
  retrievalThreshold: Number.NEGATIVE_INFINITY,
});

/**
 * Storage seam for the situational model. The in-memory adapter ships with
 * the kernel (Fast-Loop fallback when no db); a blackboard-slot adapter and a
 * Drizzle adapter persist it on the shared-state spine / Postgres. `merge` is
 * the load-bearing op — it must fold an observation into the existing row's
 * reference series, never blind-overwrite (that would erase recency history).
 */
export interface SituationalModelStore {
  /** Read one entity row (raw, pre-activation), or null. */
  get(
    tenantId: string,
    key: SituationEntityKey,
  ): Promise<SituationEntity | null>;
  /** Fold an observation into the model; returns the converged row. */
  record(input: RecordEntityInput): Promise<SituationEntity>;
  /** List every entity row for a tenant (raw, pre-activation). */
  list(tenantId: string): Promise<ReadonlyArray<SituationEntity>>;
  /** Remove an entity row (e.g. closed licence). Idempotent. */
  remove(tenantId: string, key: SituationEntityKey): Promise<void>;
}
