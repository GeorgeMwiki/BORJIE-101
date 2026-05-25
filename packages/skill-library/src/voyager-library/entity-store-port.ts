/**
 * Port to the J1 IEntityStoreService contract.
 *
 * We DO NOT depend on @borjie/file-ingest directly — we redeclare the
 * narrow interface this package needs. This keeps the dependency graph
 * loose and lets us swap the entity-store implementation without
 * touching the skill library.
 *
 * The shape MUST match the J1 contract at
 * packages/file-ingest/src/entity-store/IEntityStoreService.ts. Any
 * divergence is a bug.
 */

/** Minimal Provenance type — narrowed copy of J1's. */
export interface Provenance {
  readonly source: string;
  readonly hash: string;
  readonly captured_at?: string;
}

export interface EntityTypeDescriptor {
  readonly entity_type: string;
  readonly label: string;
  readonly attribute_keys: ReadonlyArray<string>;
  readonly required_attribute_keys?: ReadonlyArray<string>;
}

export interface AttributeWrite {
  readonly entity_type: string;
  readonly entity_id: string;
  readonly attribute_key: string;
  readonly value: unknown;
  readonly provenance: Provenance;
}

export interface CreateEntityInput {
  readonly entity_type: string;
  readonly entity_id: string;
  readonly attributes: ReadonlyArray<Omit<AttributeWrite, 'entity_type' | 'entity_id'>>;
}

export interface CreateEntityResult {
  readonly entity_id: string;
  readonly created: boolean;
  readonly attributes_written: number;
  readonly attributes_skipped: number;
}

export interface IEntityStoreService {
  listEntityTypes(tenantId: string): Promise<ReadonlyArray<EntityTypeDescriptor>>;
  getEntityType(tenantId: string, entityType: string): Promise<EntityTypeDescriptor | null>;
  upsertEntity(tenantId: string, input: CreateEntityInput): Promise<CreateEntityResult>;
  upsertEntitiesBatch(
    tenantId: string,
    inputs: ReadonlyArray<CreateEntityInput>
  ): Promise<ReadonlyArray<CreateEntityResult>>;
  hasProvenanceHash(tenantId: string, provenanceHash: string): Promise<boolean>;
}

/**
 * Tiny in-memory implementation for code-skill unit tests. NOT for
 * production — use the J1 InMemoryEntityStoreService for that.
 */
export class StubEntityStore implements IEntityStoreService {
  private readonly types = new Map<string, EntityTypeDescriptor>();
  private readonly entities = new Map<
    string,
    Map<
      string,
      { entity_type: string; attributes: Array<AttributeWrite>; provenance_hashes: Set<string> }
    >
  >();
  private readonly provenanceByTenant = new Map<string, Set<string>>();

  registerType(t: EntityTypeDescriptor): void {
    this.types.set(t.entity_type, t);
  }

  async listEntityTypes(_tenantId: string): Promise<ReadonlyArray<EntityTypeDescriptor>> {
    return Array.from(this.types.values());
  }

  async getEntityType(
    _tenantId: string,
    entityType: string
  ): Promise<EntityTypeDescriptor | null> {
    return this.types.get(entityType) ?? null;
  }

  async upsertEntity(
    tenantId: string,
    input: CreateEntityInput
  ): Promise<CreateEntityResult> {
    let perTenant = this.entities.get(tenantId);
    if (!perTenant) {
      perTenant = new Map();
      this.entities.set(tenantId, perTenant);
    }
    let entity = perTenant.get(input.entity_id);
    let created = false;
    if (!entity) {
      entity = {
        entity_type: input.entity_type,
        attributes: [],
        provenance_hashes: new Set(),
      };
      perTenant.set(input.entity_id, entity);
      created = true;
    }

    let provTenant = this.provenanceByTenant.get(tenantId);
    if (!provTenant) {
      provTenant = new Set();
      this.provenanceByTenant.set(tenantId, provTenant);
    }

    let written = 0;
    let skipped = 0;
    for (const a of input.attributes) {
      const dedupKey = `${input.entity_id}::${a.attribute_key}::${a.provenance.hash}`;
      if (entity.provenance_hashes.has(dedupKey)) {
        skipped++;
        continue;
      }
      entity.provenance_hashes.add(dedupKey);
      provTenant.add(a.provenance.hash);
      entity.attributes.push({
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        attribute_key: a.attribute_key,
        value: a.value,
        provenance: a.provenance,
      });
      written++;
    }

    return {
      entity_id: input.entity_id,
      created,
      attributes_written: written,
      attributes_skipped: skipped,
    };
  }

  async upsertEntitiesBatch(
    tenantId: string,
    inputs: ReadonlyArray<CreateEntityInput>
  ): Promise<ReadonlyArray<CreateEntityResult>> {
    const out: Array<CreateEntityResult> = [];
    for (const input of inputs) {
      out.push(await this.upsertEntity(tenantId, input));
    }
    return out;
  }

  async hasProvenanceHash(tenantId: string, provenanceHash: string): Promise<boolean> {
    return this.provenanceByTenant.get(tenantId)?.has(provenanceHash) ?? false;
  }

  // Test introspection — NOT part of the contract.
  _attributesFor(tenantId: string, entityId: string): ReadonlyArray<AttributeWrite> {
    return this.entities.get(tenantId)?.get(entityId)?.attributes ?? [];
  }
}
