/**
 * In-memory implementation of IEntityStoreService.
 *
 * This is a TEST + DEVELOPMENT mock that lives in J2 only because J1 has not
 * yet shipped. Once J1 lands, J2 production code will resolve
 * IEntityStoreService from DI; this in-memory class stays alive as the
 * canonical test double.
 *
 * Immutability rules (per house style):
 *  - State maps are kept as readonly references on `this` and replaced via
 *    `new Map(...)` on every mutation. Returned objects are frozen.
 */

import type {
  CreateEntityInput,
  CreateEntityResult,
  EntityTypeDescriptor,
  IEntityStoreService,
} from './IEntityStoreService.js';

type TenantKey = string;
type EntityKey = string; // `${entity_type}::${entity_id}`

interface StoredAttribute {
  readonly value: unknown;
  readonly provenanceHash: string;
}

interface StoredEntity {
  readonly entityId: string;
  readonly entityType: string;
  readonly attributes: ReadonlyMap<string, StoredAttribute>;
}

export interface InMemoryEntityStoreOptions {
  readonly entityTypes?: ReadonlyArray<EntityTypeDescriptor>;
}

const DEFAULT_ENTITY_TYPES: ReadonlyArray<EntityTypeDescriptor> = Object.freeze([
  Object.freeze({
    entity_type: 'employee',
    label: 'Employee',
    attribute_keys: Object.freeze([
      'full_name',
      'email',
      'phone',
      'role',
      'department',
      'start_date',
      'salary',
      'national_id',
    ]),
    required_attribute_keys: Object.freeze(['full_name', 'email']),
  }),
  Object.freeze({
    entity_type: 'lead',
    label: 'Lead',
    attribute_keys: Object.freeze([
      'full_name',
      'email',
      'phone',
      'source',
      'stage',
      'budget',
      'notes',
    ]),
    required_attribute_keys: Object.freeze(['full_name']),
  }),
  Object.freeze({
    entity_type: 'property',
    label: 'Property',
    attribute_keys: Object.freeze([
      'reference',
      'address',
      'city',
      'unit_count',
      'monthly_rent',
      'valuation',
      'manager',
    ]),
    required_attribute_keys: Object.freeze(['reference', 'address']),
  }),
  Object.freeze({
    entity_type: 'vendor',
    label: 'Vendor',
    attribute_keys: Object.freeze([
      'name',
      'category',
      'contact_email',
      'contact_phone',
      'tin',
      'rating',
    ]),
    required_attribute_keys: Object.freeze(['name']),
  }),
  Object.freeze({
    entity_type: 'tenant_payment',
    label: 'Tenant payment',
    attribute_keys: Object.freeze([
      'tenant_ref',
      'amount',
      'currency',
      'paid_at',
      'method',
      'notes',
    ]),
    required_attribute_keys: Object.freeze(['tenant_ref', 'amount', 'paid_at']),
  }),
  Object.freeze({
    entity_type: 'kra_filing',
    label: 'KRA filing',
    attribute_keys: Object.freeze([
      'pin',
      'period',
      'filing_type',
      'amount',
      'filed_at',
      'status',
    ]),
    required_attribute_keys: Object.freeze(['pin', 'period', 'filing_type']),
  }),
  Object.freeze({
    entity_type: 'lease_contract',
    label: 'Lease contract',
    attribute_keys: Object.freeze([
      'lease_ref',
      'tenant_name',
      'property_ref',
      'start_date',
      'end_date',
      'monthly_rent',
    ]),
    required_attribute_keys: Object.freeze(['lease_ref', 'tenant_name', 'property_ref']),
  }),
  Object.freeze({
    entity_type: 'employee_performance',
    label: 'Employee performance',
    attribute_keys: Object.freeze([
      'employee_ref',
      'period',
      'score',
      'reviewer',
      'comments',
    ]),
    required_attribute_keys: Object.freeze(['employee_ref', 'period', 'score']),
  }),
]);

export class InMemoryEntityStoreService implements IEntityStoreService {
  private readonly entityTypes: ReadonlyMap<string, EntityTypeDescriptor>;
  // Tenant -> entity-key -> stored entity
  private tenants: ReadonlyMap<TenantKey, ReadonlyMap<EntityKey, StoredEntity>>;
  // Tenant -> set of provenance hashes already seen
  private provenance: ReadonlyMap<TenantKey, ReadonlySet<string>>;

  constructor(options?: InMemoryEntityStoreOptions) {
    const types = options?.entityTypes ?? DEFAULT_ENTITY_TYPES;
    this.entityTypes = new Map(types.map((t) => [t.entity_type, t]));
    this.tenants = new Map();
    this.provenance = new Map();
  }

  async listEntityTypes(_tenantId: string): Promise<ReadonlyArray<EntityTypeDescriptor>> {
    return Array.from(this.entityTypes.values());
  }

  async getEntityType(
    _tenantId: string,
    entityType: string
  ): Promise<EntityTypeDescriptor | null> {
    return this.entityTypes.get(entityType) ?? null;
  }

  async upsertEntity(
    tenantId: string,
    input: CreateEntityInput
  ): Promise<CreateEntityResult> {
    if (!this.entityTypes.has(input.entity_type)) {
      throw new Error(`Unknown entity_type: ${input.entity_type}`);
    }

    const existingTenantMap =
      this.tenants.get(tenantId) ?? new Map<EntityKey, StoredEntity>();
    const seenHashes = this.provenance.get(tenantId) ?? new Set<string>();

    const entityKey = `${input.entity_type}::${input.entity_id}`;
    const existing = existingTenantMap.get(entityKey);
    const created = existing === undefined;

    const startAttrs = existing?.attributes ?? new Map<string, StoredAttribute>();
    const nextAttrs = new Map<string, StoredAttribute>(startAttrs);
    const nextHashes = new Set<string>(seenHashes);

    let written = 0;
    let skipped = 0;
    for (const attr of input.attributes) {
      const provHash = attr.provenance.hash;
      if (nextHashes.has(provHash)) {
        skipped += 1;
        continue;
      }
      nextAttrs.set(attr.attribute_key, {
        value: attr.value,
        provenanceHash: provHash,
      });
      nextHashes.add(provHash);
      written += 1;
    }

    const nextEntity: StoredEntity = Object.freeze({
      entityId: input.entity_id,
      entityType: input.entity_type,
      attributes: nextAttrs,
    });

    const nextTenantMap = new Map(existingTenantMap);
    nextTenantMap.set(entityKey, nextEntity);

    const nextTenants = new Map(this.tenants);
    nextTenants.set(tenantId, nextTenantMap);

    const nextProvenance = new Map(this.provenance);
    nextProvenance.set(tenantId, nextHashes);

    this.tenants = nextTenants;
    this.provenance = nextProvenance;

    return Object.freeze({
      entity_id: input.entity_id,
      created,
      attributes_written: written,
      attributes_skipped: skipped,
    });
  }

  async upsertEntitiesBatch(
    tenantId: string,
    inputs: ReadonlyArray<CreateEntityInput>
  ): Promise<ReadonlyArray<CreateEntityResult>> {
    const results: CreateEntityResult[] = [];
    for (const input of inputs) {
      // Sequential keeps the in-memory implementation deterministic; real
      // J1 implementation MAY parallelize, but the contract only requires
      // per-entity atomicity.
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.upsertEntity(tenantId, input));
    }
    return results;
  }

  async hasProvenanceHash(tenantId: string, provenanceHash: string): Promise<boolean> {
    const set = this.provenance.get(tenantId);
    return set !== undefined && set.has(provenanceHash);
  }

  /** Test helper: read the canonical stored value (NOT part of IEntityStoreService). */
  inspect(
    tenantId: string,
    entityType: string,
    entityId: string
  ): { readonly attributes: ReadonlyMap<string, StoredAttribute> } | null {
    const tenantMap = this.tenants.get(tenantId);
    if (!tenantMap) return null;
    const entity = tenantMap.get(`${entityType}::${entityId}`);
    if (!entity) return null;
    return { attributes: entity.attributes };
  }

  /** Test helper: count entities for a tenant + type. */
  count(tenantId: string, entityType: string): number {
    const tenantMap = this.tenants.get(tenantId);
    if (!tenantMap) return 0;
    let n = 0;
    for (const key of tenantMap.keys()) {
      if (key.startsWith(`${entityType}::`)) n += 1;
    }
    return n;
  }
}
