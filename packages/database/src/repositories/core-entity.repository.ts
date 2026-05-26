/**
 * CoreEntityRepository — Piece A universal asset & entity model.
 *
 * Single repository covering the polymorphic root (`core_entity`) plus
 * the per-type extension tables (`entity_ext_*`). Treats subdivisions
 * as a recursive parent/child tree via `parent_entity_id`.
 *
 * Public surface:
 *   - `insertEntity(entity, tenantId)` — single-shot polymorphic insert
 *   - `findById(id, tenantId)`
 *   - `findChildren(parentId, tenantId)`
 *   - `findAllDescendants(rootId, tenantId)` — recursive CTE
 *   - `searchHybrid({ tenantId, query, entityTypes, geoNear, topK })`
 *   - `addCustomField(tenantId, moduleId, entityType, field)` — register
 *     a tenant_schema_extension row
 *   - `validateCustomFields(tenantId, entityType, customFields)` — runtime
 *     Zod-style enforcement against the registry
 *
 * Tenant scoping: every call accepts `tenantId` explicitly. RLS at the
 * DB layer is the safety net (the GUC is bound by the api-gateway
 * middleware); the repository layer reads from the same tenant for
 * defence in depth.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '../client.js';
import {
  zodToPersistedMeta,
  rehydrateZod,
} from '../helpers/custom-field-zod.js';
import {
  coreEntity,
  entityExtBuilding,
  entityExtItAsset,
  entityExtLand,
  entityExtMachinery,
  entityExtPerson,
  entityExtVehicle,
  entityTypeDefinition,
  tenantSchemaExtensions,
  type CoreEntityRow,
  type EntityExtBuildingInsert,
  type EntityExtItAssetInsert,
  type EntityExtLandInsert,
  type EntityExtMachineryInsert,
  type EntityExtPersonInsert,
  type EntityExtVehicleInsert,
  type TenantSchemaFieldKind,
} from '../schemas/core-entity/index.js';

// ---------------------------------------------------------------------
// Input shapes — discriminated union over `entityType`.
// ---------------------------------------------------------------------

export interface CoreEntityCommon {
  readonly id: string;
  readonly moduleId?: string | null;
  readonly parentEntityId?: string | null;
  readonly discriminator?: string | null;
  readonly displayName: string;
  readonly lifecycleState?: string;
  readonly geoGeog?: string | null;
  readonly customFields?: Record<string, unknown>;
  readonly embedding?: ReadonlyArray<number> | null;
  readonly auditChainRootHash?: string | null;
  readonly createdBy?: string | null;
}

export type LandEntityInput = CoreEntityCommon & {
  readonly entityType:
    | 'LAND_PARCEL'
    | 'PLOT'
    | 'BARELAND'
    | 'WAREHOUSE'
    | 'GODOWN';
  readonly land: Omit<EntityExtLandInsert, 'entityId' | 'tenantId'>;
};

export type BuildingEntityInput = CoreEntityCommon & {
  readonly entityType: 'BUILDING' | 'HOTEL';
  readonly building: Omit<EntityExtBuildingInsert, 'entityId' | 'tenantId'>;
};

export type SubUnitEntityInput = CoreEntityCommon & {
  readonly entityType: 'SUB_UNIT';
};

export type VehicleEntityInput = CoreEntityCommon & {
  readonly entityType: 'VEHICLE' | 'LOCOMOTIVE';
  readonly vehicle: Omit<EntityExtVehicleInsert, 'entityId' | 'tenantId'>;
};

export type MachineryEntityInput = CoreEntityCommon & {
  readonly entityType: 'MACHINERY';
  readonly machinery: Omit<EntityExtMachineryInsert, 'entityId' | 'tenantId'>;
};

export type ItAssetEntityInput = CoreEntityCommon & {
  readonly entityType: 'IT_ASSET';
  readonly itAsset: Omit<EntityExtItAssetInsert, 'entityId' | 'tenantId'>;
};

export type PersonEntityInput = CoreEntityCommon & {
  readonly entityType: 'PERSON';
  readonly person: Omit<EntityExtPersonInsert, 'entityId' | 'tenantId'>;
};

export type IntangibleEntityInput = CoreEntityCommon & {
  readonly entityType: 'INTANGIBLE' | 'ORG_UNIT' | 'VENDOR' | 'CONTRACT';
};

export type CoreEntityInput =
  | LandEntityInput
  | BuildingEntityInput
  | SubUnitEntityInput
  | VehicleEntityInput
  | MachineryEntityInput
  | ItAssetEntityInput
  | PersonEntityInput
  | IntangibleEntityInput;

export interface SearchHybridParams {
  readonly tenantId: string;
  readonly query?: string | null;
  readonly entityTypes?: ReadonlyArray<string> | null;
  readonly geoNear?: {
    readonly latitude: number;
    readonly longitude: number;
    readonly radiusMeters: number;
  } | null;
  readonly customFieldsContains?: Record<string, unknown> | null;
  readonly topK?: number;
  readonly embedding?: ReadonlyArray<number> | null;
  /** MMR diversity parameter — 0 = pure relevance, 1 = pure diversity. */
  readonly mmrLambda?: number;
}

export interface SearchHit {
  readonly id: string;
  readonly entityType: string;
  readonly displayName: string;
  readonly score: number;
  readonly bm25Score: number;
  readonly denseScore: number;
  readonly geoScore: number;
  readonly entity: CoreEntityRow;
}

export interface AddCustomFieldParams {
  readonly tenantId: string;
  readonly moduleId?: string | null;
  readonly entityType: string;
  readonly fieldName: string;
  readonly fieldKind: TenantSchemaFieldKind;
  readonly zodSchema: z.ZodTypeAny;
  readonly required?: boolean;
  readonly indexStrategy?: 'gin_path' | 'btree_path' | null;
  readonly displayLabelEn?: string | null;
  readonly displayLabelSw?: string | null;
  readonly helpText?: string | null;
  readonly placeholder?: string | null;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const DEFAULT_TOP_K = 20;
const DEFAULT_MMR_LAMBDA = 0.3;

// ---------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------

export class CoreEntityRepository {
  constructor(private readonly db: DatabaseClient) {}

  // -------------------------------------------------------------------
  // Insert
  // -------------------------------------------------------------------

  /**
   * Polymorphic insert: writes the root `core_entity` row plus the
   * matching `entity_ext_*` row in a single transaction. Validates
   * `customFields` against `tenant_schema_extensions` first.
   */
  async insertEntity(
    input: CoreEntityInput,
    tenantId: string,
  ): Promise<CoreEntityRow> {
    // 1) Custom-field validation — fail fast before any write.
    await this.validateCustomFields(
      tenantId,
      input.entityType,
      input.customFields ?? {},
    );

    // 2) Single transaction across the two tables.
    return this.db.transaction(async (tx) => {
      const rootInsert = {
        id: input.id,
        tenantId,
        moduleId: input.moduleId ?? null,
        entityType: input.entityType,
        parentEntityId: input.parentEntityId ?? null,
        discriminator: input.discriminator ?? null,
        displayName: input.displayName,
        lifecycleState: input.lifecycleState ?? 'active',
        geoGeog: input.geoGeog ?? null,
        customFields: input.customFields ?? {},
        embedding: input.embedding ? [...input.embedding] : null,
        auditChainRootHash: input.auditChainRootHash ?? null,
        createdBy: input.createdBy ?? null,
      };

      const rootInserted = await tx
        .insert(coreEntity)
        .values(rootInsert)
        .returning();
      const root = rootInserted[0];
      if (!root) {
        throw new Error('core_entity insert returned no row');
      }

      // 3) Extension row keyed off entityType.
      switch (input.entityType) {
        case 'LAND_PARCEL':
        case 'PLOT':
        case 'BARELAND':
        case 'WAREHOUSE':
        case 'GODOWN':
          await tx.insert(entityExtLand).values({
            entityId: input.id,
            tenantId,
            ...input.land,
          });
          break;
        case 'BUILDING':
        case 'HOTEL':
          await tx.insert(entityExtBuilding).values({
            entityId: input.id,
            tenantId,
            ...input.building,
          });
          break;
        case 'VEHICLE':
        case 'LOCOMOTIVE':
          await tx.insert(entityExtVehicle).values({
            entityId: input.id,
            tenantId,
            ...input.vehicle,
          });
          break;
        case 'MACHINERY':
          await tx.insert(entityExtMachinery).values({
            entityId: input.id,
            tenantId,
            ...input.machinery,
          });
          break;
        case 'IT_ASSET':
          await tx.insert(entityExtItAsset).values({
            entityId: input.id,
            tenantId,
            ...input.itAsset,
          });
          break;
        case 'PERSON':
          await tx.insert(entityExtPerson).values({
            entityId: input.id,
            tenantId,
            ...input.person,
          });
          break;
        // SUB_UNIT / INTANGIBLE / ORG_UNIT / VENDOR / CONTRACT have no
        // dedicated extension; their custom_fields blob carries the
        // per-type attributes.
        default:
          break;
      }

      return root;
    });
  }

  // -------------------------------------------------------------------
  // Find
  // -------------------------------------------------------------------

  async findById(
    id: string,
    tenantId: string,
  ): Promise<CoreEntityRow | null> {
    const result = await this.db
      .select()
      .from(coreEntity)
      .where(
        and(
          eq(coreEntity.id, id),
          eq(coreEntity.tenantId, tenantId),
          isNull(coreEntity.deletedAt),
        ),
      )
      .limit(1);
    return result[0] ?? null;
  }

  async findChildren(
    parentId: string,
    tenantId: string,
  ): Promise<ReadonlyArray<CoreEntityRow>> {
    return this.db
      .select()
      .from(coreEntity)
      .where(
        and(
          eq(coreEntity.parentEntityId, parentId),
          eq(coreEntity.tenantId, tenantId),
          isNull(coreEntity.deletedAt),
        ),
      );
  }

  /**
   * Recursive descent — returns the root plus every transitive child.
   * Uses a Postgres recursive CTE so the work happens server-side.
   */
  async findAllDescendants(
    rootId: string,
    tenantId: string,
  ): Promise<ReadonlyArray<CoreEntityRow>> {
    const result = (await this.db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT * FROM core_entity
         WHERE id = ${rootId}
           AND tenant_id = ${tenantId}
           AND deleted_at IS NULL
        UNION ALL
        SELECT ce.* FROM core_entity ce
          INNER JOIN descendants d ON ce.parent_entity_id = d.id
         WHERE ce.tenant_id = ${tenantId}
           AND ce.deleted_at IS NULL
      )
      SELECT * FROM descendants
    `)) as { rows?: ReadonlyArray<CoreEntityRow> } | ReadonlyArray<CoreEntityRow>;

    if (Array.isArray(result)) return result as ReadonlyArray<CoreEntityRow>;
    return (
      (result as { rows?: ReadonlyArray<CoreEntityRow> }).rows ?? []
    );
  }

  // -------------------------------------------------------------------
  // Custom-field registry
  // -------------------------------------------------------------------

  /**
   * Register a new custom field for (tenant, module, entity_type).
   * Persists the Zod schema as a JSONB hint and uses `fieldKind` as
   * the source of truth for runtime validation.
   */
  async addCustomField(params: AddCustomFieldParams): Promise<void> {
    const id = `${params.tenantId}:${params.moduleId ?? '__no_module__'}:${params.entityType}:${params.fieldName}`;
    await this.db.insert(tenantSchemaExtensions).values({
      id,
      tenantId: params.tenantId,
      moduleId: params.moduleId ?? null,
      entityType: params.entityType,
      fieldName: params.fieldName,
      fieldKind: params.fieldKind,
      zodJsonb: zodToPersistedMeta(params.zodSchema),
      required: params.required ?? false,
      indexStrategy: params.indexStrategy ?? null,
      validationsJsonb: [],
      displayLabelEn: params.displayLabelEn ?? null,
      displayLabelSw: params.displayLabelSw ?? null,
      helpText: params.helpText ?? null,
      placeholder: params.placeholder ?? null,
    });
  }

  /**
   * Validate a `customFields` blob against the registered extensions
   * for (tenant, entity_type). Throws a ZodError-compatible Error if
   * any field fails its parser.
   */
  async validateCustomFields(
    tenantId: string,
    entityType: string,
    customFields: Record<string, unknown>,
  ): Promise<void> {
    const registry = await this.db
      .select()
      .from(tenantSchemaExtensions)
      .where(
        and(
          eq(tenantSchemaExtensions.tenantId, tenantId),
          eq(tenantSchemaExtensions.entityType, entityType),
          isNull(tenantSchemaExtensions.deletedAt),
        ),
      );

    for (const row of registry) {
      const value = customFields[row.fieldName];
      const validator = rehydrateZod(row);
      const isMissing = value === undefined || value === null;

      if (row.required && isMissing) {
        throw new Error(
          `custom field "${row.fieldName}" is required for entity_type=${entityType} but was missing`,
        );
      }
      if (isMissing) continue;

      const parsed = validator.safeParse(value);
      if (!parsed.success) {
        throw new Error(
          `custom field "${row.fieldName}" failed validation: ${parsed.error.message}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------
  // Search — hybrid BM25 + dense + geo + JSONB contains.
  // -------------------------------------------------------------------

  /**
   * Hybrid retrieval — combines BM25 (`tsv`), dense (cosine on
   * `embedding`), geo (PostGIS ST_DWithin), and JSONB contains
   * filters. Reranks with a lightweight MMR pass.
   *
   * Returns the top-k hits with per-signal scores.
   */
  async searchHybrid(
    params: SearchHybridParams,
  ): Promise<ReadonlyArray<SearchHit>> {
    const topK = params.topK ?? DEFAULT_TOP_K;
    const lambda = params.mmrLambda ?? DEFAULT_MMR_LAMBDA;

    // Build the per-signal score expressions. Each is wrapped in
    // COALESCE so a missing signal contributes 0 instead of NULL.
    const queryText = params.query?.trim() ?? '';
    const useBm25 = queryText.length > 0;
    const useDense = (params.embedding?.length ?? 0) > 0;
    const useGeo = params.geoNear !== null && params.geoNear !== undefined;

    // We assemble a single SQL with parameterised inputs.
    const conditions: ReturnType<typeof sql>[] = [
      sql`ce.tenant_id = ${params.tenantId}`,
      sql`ce.deleted_at IS NULL`,
    ];
    if (params.entityTypes && params.entityTypes.length > 0) {
      conditions.push(
        sql`ce.entity_type = ANY(${[...params.entityTypes]}::text[])`,
      );
    }
    if (params.customFieldsContains) {
      conditions.push(
        sql`ce.custom_fields @> ${JSON.stringify(params.customFieldsContains)}::jsonb`,
      );
    }

    const whereClause = conditions.reduce(
      (acc, c) => sql`${acc} AND ${c}`,
      sql`TRUE`,
    );

    const bm25Score = useBm25
      ? sql`COALESCE(ts_rank_cd(ce.tsv, plainto_tsquery('simple', ${queryText})), 0.0)`
      : sql`0.0`;

    const denseScore = useDense
      ? sql`COALESCE(1.0 - (ce.embedding <=> ${`[${(params.embedding ?? []).join(',')}]`}::vector), 0.0)`
      : sql`0.0`;

    const geoScore =
      useGeo && params.geoNear
        ? sql`
            COALESCE(
              GREATEST(
                0.0,
                1.0 - (ST_Distance(
                  ce.geo_geog::geography,
                  ST_SetSRID(
                    ST_MakePoint(${params.geoNear.longitude}, ${params.geoNear.latitude}),
                    4326
                  )::geography
                ) / NULLIF(${params.geoNear.radiusMeters}::float, 0))
              ),
              0.0
            )
          `
        : sql`0.0`;

    // Combined score: equal weights by default. MMR rerank below.
    const combined = sql`(${bm25Score} + ${denseScore} + ${geoScore})`;

    let candidates: Array<{
      readonly id: string;
      readonly entity_type: string;
      readonly display_name: string;
      readonly bm25: number;
      readonly dense: number;
      readonly geo: number;
      readonly combined: number;
      readonly row: CoreEntityRow;
    }>;
    try {
      const result = (await this.db.execute(sql`
        SELECT
          ce.id              AS id,
          ce.entity_type     AS entity_type,
          ce.display_name    AS display_name,
          ce.*               AS row,
          ${bm25Score}       AS bm25,
          ${denseScore}      AS dense,
          ${geoScore}        AS geo,
          ${combined}        AS combined
        FROM core_entity ce
        WHERE ${whereClause}
        ORDER BY combined DESC NULLS LAST
        LIMIT ${topK * 3}
      `)) as
        | { rows?: ReadonlyArray<Record<string, unknown>> }
        | ReadonlyArray<Record<string, unknown>>;
      const rows: ReadonlyArray<Record<string, unknown>> = Array.isArray(result)
        ? (result as ReadonlyArray<Record<string, unknown>>)
        : ((result as { rows?: ReadonlyArray<Record<string, unknown>> })
            .rows ?? []);

      candidates = rows.map((r) => ({
        id: String(r.id),
        entity_type: String(r.entity_type),
        display_name: String(r.display_name),
        bm25: Number(r.bm25 ?? 0),
        dense: Number(r.dense ?? 0),
        geo: Number(r.geo ?? 0),
        combined: Number(r.combined ?? 0),
        row: r as unknown as CoreEntityRow,
      }));
    } catch (_e) {
      // Fall back to a pure-text + pure-tenant filter when extensions
      // (pgvector / postgis) are unavailable — search degrades but
      // never throws. This path is what dev environments hit.
      const fallback = await this.db
        .select()
        .from(coreEntity)
        .where(
          and(
            eq(coreEntity.tenantId, params.tenantId),
            isNull(coreEntity.deletedAt),
          ),
        )
        .limit(topK);
      candidates = fallback.map((r) => ({
        id: r.id,
        entity_type: r.entityType,
        display_name: r.displayName,
        bm25: 0,
        dense: 0,
        geo: 0,
        combined: 0,
        row: r,
      }));
    }

    // MMR rerank — diversify by display_name token overlap.
    const reranked = mmrRerank(candidates, lambda).slice(0, topK);

    return reranked.map((c) => ({
      id: c.id,
      entityType: c.entity_type,
      displayName: c.display_name,
      bm25Score: c.bm25,
      denseScore: c.dense,
      geoScore: c.geo,
      score: c.combined,
      entity: c.row,
    }));
  }

  // -------------------------------------------------------------------
  // Catalog helpers
  // -------------------------------------------------------------------

  /**
   * List the entity_type_definition rows visible to a tenant — both
   * platform built-ins and the tenant's own definitions.
   */
  async listEntityTypes(
    tenantId: string,
  ): Promise<ReadonlyArray<typeof entityTypeDefinition.$inferSelect>> {
    return this.db
      .select()
      .from(entityTypeDefinition)
      .where(
        sql`${entityTypeDefinition.tenantId} IS NULL OR ${entityTypeDefinition.tenantId} = ${tenantId}`,
      );
  }
}

// ---------------------------------------------------------------------
// MMR rerank — diversify on display_name token-overlap.
// ---------------------------------------------------------------------

interface MmrCandidate {
  readonly id: string;
  readonly display_name: string;
  readonly combined: number;
}

export function mmrRerank<T extends MmrCandidate>(
  candidates: ReadonlyArray<T>,
  lambda: number,
): ReadonlyArray<T> {
  if (candidates.length <= 1) return candidates;
  const selected: T[] = [];
  const pool = [...candidates];

  while (pool.length > 0 && selected.length < candidates.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const c = pool[i];
      if (!c) continue;
      const relevance = c.combined;
      let maxSim = 0;
      for (const s of selected) {
        const sim = tokenJaccard(c.display_name, s.display_name);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const picked = pool.splice(bestIdx, 1)[0];
    if (picked) selected.push(picked);
  }
  return selected;
}

function tokenJaccard(a: string, b: string): number {
  const tokA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tokB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (tokA.size === 0 && tokB.size === 0) return 0;
  let inter = 0;
  for (const t of tokA) if (tokB.has(t)) inter += 1;
  const union = tokA.size + tokB.size - inter;
  return union === 0 ? 0 : inter / union;
}
