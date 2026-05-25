/**
 * IEntityStoreService — J1 integration contract.
 *
 * This is the SOLE coupling point between J2 (this package, the conversational
 * ingest pipeline) and J1 (the entity-store substrate, branch
 * claude/j1-entity-store-substrate). J1 will ship an implementation; J2 ships
 * against this interface with a mock so the two phases stay decoupled.
 *
 * Naming and shape are deliberately conservative and entity-type-agnostic —
 * any entity (property, employee, lead, tenant, vendor, kra-filing, payment,
 * lease, performance-review) flows through the same surface.
 *
 * IMPORTANT: All writes are scoped by tenant_id (multi-tenant SaaS) and
 * accompanied by a Provenance record. The store MUST honour the provenance
 * hash for idempotency — re-issuing a write with the same (entity_id,
 * attribute_key, provenance.hash) is a no-op.
 */

import type { Provenance } from '../provenance/types.js';

/**
 * Lightweight description of a registered entity type. The entity-store
 * exposes a registry so the ingest pipeline can ask "what entity types
 * exist?" before mapping columns.
 */
export interface EntityTypeDescriptor {
  /** Stable identifier, e.g. "employee", "lead", "property", "kra_filing". */
  readonly entity_type: string;
  /** Human-readable label for chat display. */
  readonly label: string;
  /** Allowed attribute keys for this entity type. */
  readonly attribute_keys: ReadonlyArray<string>;
  /** Optional list of attribute keys that are required for a row to be a "valid" entity. */
  readonly required_attribute_keys?: ReadonlyArray<string>;
}

/**
 * A single attribute write. Note the value is unknown — the store layer is
 * responsible for type-coercing against its own attribute schema.
 */
export interface AttributeWrite {
  readonly entity_type: string;
  readonly entity_id: string;
  readonly attribute_key: string;
  readonly value: unknown;
  readonly provenance: Provenance;
}

export interface CreateEntityInput {
  readonly entity_type: string;
  /**
   * Deterministic identifier derived from the dedup-key columns + tenant_id.
   * The pipeline computes this client-side so the same row always maps to the
   * same entity_id (idempotency).
   */
  readonly entity_id: string;
  readonly attributes: ReadonlyArray<Omit<AttributeWrite, 'entity_type' | 'entity_id'>>;
}

export interface CreateEntityResult {
  readonly entity_id: string;
  readonly created: boolean;
  /** Number of attribute writes that were actually applied (others were idempotent no-ops). */
  readonly attributes_written: number;
  /** Number of attribute writes skipped because the provenance hash already existed. */
  readonly attributes_skipped: number;
}

/**
 * The J1 contract. J2 depends only on this interface — never on J1's concrete
 * classes. Tests use {@link InMemoryEntityStoreService} (in this package) as
 * the canonical mock.
 */
export interface IEntityStoreService {
  /** List all entity-type descriptors visible to the tenant. */
  listEntityTypes(tenantId: string): Promise<ReadonlyArray<EntityTypeDescriptor>>;

  /** Look up a single entity-type descriptor by key. Returns null if unknown. */
  getEntityType(tenantId: string, entityType: string): Promise<EntityTypeDescriptor | null>;

  /**
   * Idempotent entity create-or-merge. If an entity with the supplied
   * entity_id already exists in this tenant, additional attributes are
   * appended (subject to provenance-hash dedup). Returns counts so the
   * ingest executor can produce a useful chat report.
   */
  upsertEntity(tenantId: string, input: CreateEntityInput): Promise<CreateEntityResult>;

  /**
   * Bulk variant. Implementations MAY parallelize internally but MUST be
   * atomic per-entity (a partial failure on one entity must not leave other
   * entities half-written).
   */
  upsertEntitiesBatch(
    tenantId: string,
    inputs: ReadonlyArray<CreateEntityInput>
  ): Promise<ReadonlyArray<CreateEntityResult>>;

  /** Returns true iff a provenance hash has already been recorded against any attribute write. */
  hasProvenanceHash(tenantId: string, provenanceHash: string): Promise<boolean>;
}
