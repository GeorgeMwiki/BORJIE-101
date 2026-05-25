/**
 * Temporal entity graph — Drizzle-backed service.
 *
 * B4 Phase B — Progressive Intelligence.
 *
 * Backed by migration 0140. The service owns:
 *
 *   - `upsertEntity({...})`       Insert a new (tenant, type, key,
 *                                  valid_from) row. Idempotent on the
 *                                  unique index; ON CONFLICT DO UPDATE
 *                                  refreshes attributes.
 *   - `upsertRelationship({...})` Insert a new edge between two
 *                                  entities.
 *   - `invalidateEntity({...})`   Soft-invalidate: set invalidated_at +
 *                                  valid_to so retroactive queries can
 *                                  still see history.
 *   - `listEntities({...})`       Read entities for one tenant; filters
 *                                  on `entity_type` + `validAt` ts.
 *   - `listRelationships({...})`  Read edges for one tenant.
 *   - `consolidateForTenant({...})`
 *                                  RUN Louvain modularity-maximisation
 *                                  community detection over the
 *                                  currently-valid subgraph for the
 *                                  tenant; persist community_id back on
 *                                  every entity + relationship; insert
 *                                  one `temporal_communities` row per
 *                                  detected community. Implements the
 *                                  port shape consumed by
 *                                  `services/consolidation-worker`
 *                                  stage 06.
 *
 * Louvain reference: V.D. Blondel, J.-L. Guillaume, R. Lambiotte, and
 * E. Lefebvre. "Fast unfolding of communities in large networks." J.
 * Stat. Mech. (2008) — https://arxiv.org/abs/0803.0476.
 *
 * Hard DB failures degrade to no-ops / empty reports — the consolidation
 * worker NEVER crashes because the temporal graph is unreachable.
 */

import { randomUUID } from 'crypto';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {

  temporalEntities,
  temporalRelationships,
  temporalCommunities,
} from '../schemas/temporal-entity-graph.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';
import {
  detectCommunitiesLouvain,
  type LouvainEdge,
  type LouvainNode,
  type LouvainPartition,
} from './temporal-entity-graph.louvain.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface TemporalEntityRow {
  readonly id: string;
  readonly tenantId: string;
  readonly entityType: string;
  readonly entityKey: string;
  readonly attributes: Record<string, unknown>;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly recordedAt: string;
  readonly invalidatedAt: string | null;
  readonly communityId: string | null;
}

export interface TemporalRelationshipRow {
  readonly id: string;
  readonly tenantId: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly relationship: string;
  readonly attributes: Record<string, unknown>;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly recordedAt: string;
  readonly invalidatedAt: string | null;
  readonly communityId: string | null;
}

export interface UpsertEntityArgs {
  readonly tenantId: string;
  readonly entityType: string;
  readonly entityKey: string;
  readonly attributes?: Record<string, unknown>;
  readonly validFrom: Date | string;
  readonly validTo?: Date | string | null;
}

export interface UpsertRelationshipArgs {
  readonly tenantId: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly relationship: string;
  readonly attributes?: Record<string, unknown>;
  readonly validFrom: Date | string;
  readonly validTo?: Date | string | null;
}

export interface InvalidateEntityArgs {
  readonly entityId: string;
  readonly invalidatedAt?: Date | string;
  readonly validTo?: Date | string;
}

export interface ListEntitiesArgs {
  readonly tenantId: string;
  readonly entityType?: string;
  /** ISO ts — return entities whose validity window covers this moment. */
  readonly validAt?: string;
  readonly includeInvalidated?: boolean;
  readonly limit?: number;
}

export interface ListRelationshipsArgs {
  readonly tenantId: string;
  readonly relationship?: string;
  readonly fromEntityId?: string;
  readonly includeInvalidated?: boolean;
  readonly limit?: number;
}

export interface ConsolidateMergeReport {
  readonly tenantId: string | null;
  readonly mergedEntities: number;
  readonly inspectedEntities: number;
}

export interface ConsolidateForTenantArgs {
  readonly tenantId: string | null;
  /**
   * Louvain resolution parameter (γ). >1 favours smaller communities,
   * <1 larger. Default 1.0 (standard modularity).
   */
  readonly resolution?: number;
  /** Max Louvain iterations before bailing. Default 50. */
  readonly maxIterations?: number;
}

export interface TemporalEntityGraphService {
  upsertEntity(args: UpsertEntityArgs): Promise<{ id: string; created: boolean }>;
  upsertRelationship(
    args: UpsertRelationshipArgs,
  ): Promise<{ id: string; created: boolean }>;
  invalidateEntity(args: InvalidateEntityArgs): Promise<void>;
  listEntities(
    args: ListEntitiesArgs,
  ): Promise<ReadonlyArray<TemporalEntityRow>>;
  listRelationships(
    args: ListRelationshipsArgs,
  ): Promise<ReadonlyArray<TemporalRelationshipRow>>;
  consolidateForTenant(
    args: ConsolidateForTenantArgs,
  ): Promise<ConsolidateMergeReport>;
}

// ─────────────────────────────────────────────────────────────────────
// Constants + helpers
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 500;
const MAX_LIST_LIMIT = 10_000;
const DEFAULT_RESOLUTION = 1.0;
const DEFAULT_MAX_ITERATIONS = 50;

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_LIST_LIMIT);
}

// ─────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────

export function createTemporalEntityGraphService(
  db: DatabaseClient,
): TemporalEntityGraphService {
  return {
    async upsertEntity(args) {
      const id = randomUUID();
      try {
        const tenantId = (args.tenantId ?? '').trim();
        const entityType = (args.entityType ?? '').trim();
        const entityKey = (args.entityKey ?? '').trim();
        if (!tenantId || !entityType || !entityKey) {
          throw new Error('tenantId / entityType / entityKey required');
        }
        const validFrom = toIso(args.validFrom);
        if (!validFrom) {
          throw new Error('validFrom required');
        }
        const insertValues: Record<string, unknown> = {
          id,
          tenantId,
          entityType,
          entityKey,
          attributes: (args.attributes ?? {}) as never,
          validFrom: new Date(validFrom),
          validTo: args.validTo ? new Date(String(toIso(args.validTo))) : null,
        };
        const updateSet: Record<string, unknown> = {
          attributes: (args.attributes ?? {}) as never,
          validTo: args.validTo ? new Date(String(toIso(args.validTo))) : null,
        };
        const out = (await db
          .insert(temporalEntities)
          .values(insertValues as never)
          .onConflictDoUpdate({
            target: [
              temporalEntities.tenantId,
              temporalEntities.entityType,
              temporalEntities.entityKey,
              temporalEntities.validFrom,
            ],
            set: updateSet as never,
          })
          .returning({ id: temporalEntities.id })) as ReadonlyArray<{
          id: string;
        }>;
        const returnedId = out?.[0]?.id ?? id;
        return { id: returnedId, created: returnedId === id };
      } catch (error) {
        logger.error('temporal-entity-graph.upsertEntity failed', { error: error });
        return { id, created: false };
      }
    },

    async upsertRelationship(args) {
      const id = randomUUID();
      try {
        const tenantId = (args.tenantId ?? '').trim();
        const fromEntityId = (args.fromEntityId ?? '').trim();
        const toEntityId = (args.toEntityId ?? '').trim();
        const relationship = (args.relationship ?? '').trim();
        if (!tenantId || !fromEntityId || !toEntityId || !relationship) {
          throw new Error(
            'tenantId / fromEntityId / toEntityId / relationship required',
          );
        }
        const validFrom = toIso(args.validFrom);
        if (!validFrom) throw new Error('validFrom required');
        const insertValues: Record<string, unknown> = {
          id,
          tenantId,
          fromEntityId,
          toEntityId,
          relationship,
          attributes: (args.attributes ?? {}) as never,
          validFrom: new Date(validFrom),
          validTo: args.validTo ? new Date(String(toIso(args.validTo))) : null,
        };
        await db
          .insert(temporalRelationships)
          .values(insertValues as never);
        return { id, created: true };
      } catch (error) {
        logger.error('temporal-entity-graph.upsertRelationship failed', { error: error });
        return { id, created: false };
      }
    },

    async invalidateEntity(args) {
      try {
        if (!args.entityId) return;
        const invalidatedAt = args.invalidatedAt
          ? new Date(String(toIso(args.invalidatedAt)))
          : new Date();
        const validTo = args.validTo
          ? new Date(String(toIso(args.validTo)))
          : invalidatedAt;
        await db
          .update(temporalEntities)
          .set({ invalidatedAt, validTo } as never)
          .where(eq(temporalEntities.id, args.entityId));
      } catch (error) {
        logger.error('temporal-entity-graph.invalidateEntity failed', { error: error });
      }
    },

    async listEntities(args) {
      try {
        const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT);
        const conds: SQL<unknown>[] = [];
        conds.push(eq(temporalEntities.tenantId, args.tenantId));
        if (args.entityType) {
          conds.push(eq(temporalEntities.entityType, args.entityType));
        }
        if (!args.includeInvalidated) {
          conds.push(isNull(temporalEntities.invalidatedAt));
        }
        if (args.validAt) {
          // valid_from ≤ validAt AND (valid_to IS NULL OR valid_to > validAt)
          conds.push(sql`${temporalEntities.validFrom} <= ${args.validAt}`);
          conds.push(
            sql`(${temporalEntities.validTo} IS NULL OR ${temporalEntities.validTo} > ${args.validAt})`,
          );
        }
        const rows = (await db
          .select()
          .from(temporalEntities)
          .where(and(...conds))
          .limit(limit)) as ReadonlyArray<EntityRowShape>;
        return (rows ?? []).map(toEntityRow);
      } catch (error) {
        logger.error('temporal-entity-graph.listEntities failed', { error: error });
        return [];
      }
    },

    async listRelationships(args) {
      try {
        const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT);
        const conds: SQL<unknown>[] = [];
        conds.push(eq(temporalRelationships.tenantId, args.tenantId));
        if (args.relationship) {
          conds.push(
            eq(temporalRelationships.relationship, args.relationship),
          );
        }
        if (args.fromEntityId) {
          conds.push(
            eq(temporalRelationships.fromEntityId, args.fromEntityId),
          );
        }
        if (!args.includeInvalidated) {
          conds.push(isNull(temporalRelationships.invalidatedAt));
        }
        const rows = (await db
          .select()
          .from(temporalRelationships)
          .where(and(...conds))
          .limit(limit)) as ReadonlyArray<RelationshipRowShape>;
        return (rows ?? []).map(toRelationshipRow);
      } catch (error) {
        logger.error('temporal-entity-graph.listRelationships failed', { error: error });
        return [];
      }
    },

    async consolidateForTenant(args) {
      const tenantId = args.tenantId;
      const report: ConsolidateMergeReport = {
        tenantId,
        mergedEntities: 0,
        inspectedEntities: 0,
      };
      if (tenantId === null) {
        // Cross-tenant consolidation is not supported (privacy boundary).
        return report;
      }
      try {
        // 1. Load currently-valid entities + relationships for this tenant.
        const entityRows = (await db
          .select()
          .from(temporalEntities)
          .where(
            and(
              eq(temporalEntities.tenantId, tenantId),
              isNull(temporalEntities.invalidatedAt),
            ),
          )
          .limit(MAX_LIST_LIMIT)) as ReadonlyArray<EntityRowShape>;

        const relRows = (await db
          .select()
          .from(temporalRelationships)
          .where(
            and(
              eq(temporalRelationships.tenantId, tenantId),
              isNull(temporalRelationships.invalidatedAt),
            ),
          )
          .limit(MAX_LIST_LIMIT)) as ReadonlyArray<RelationshipRowShape>;

        const nodes: LouvainNode[] = entityRows.map((r) => ({ id: r.id }));
        const edges: LouvainEdge[] = relRows.map((r) => ({
          from: r.fromEntityId,
          to: r.toEntityId,
          weight: 1,
        }));

        if (nodes.length === 0) {
          return { ...report, inspectedEntities: 0 };
        }

        // 2. Run Louvain.
        const partition: LouvainPartition = detectCommunitiesLouvain({
          nodes,
          edges,
          resolution: args.resolution ?? DEFAULT_RESOLUTION,
          maxIterations: args.maxIterations ?? DEFAULT_MAX_ITERATIONS,
        });

        // 3. Sort communities by size (desc) and assign stable ids so a
        // repeat-run on the same partition produces identical community_ids
        // (idempotent at the OUTPUT level — actual UUIDs differ but the
        // ranking is stable).
        const ranked = rankCommunities(partition);

        // 4. Persist a temporal_communities row per detected community.
        const communityIdByOriginal = new Map<number, string>();
        for (const entry of ranked) {
          const communityId = randomUUID();
          communityIdByOriginal.set(entry.original, communityId);
          try {
            await db.insert(temporalCommunities).values({
              id: communityId,
              tenantId,
              label: `cluster-${entry.rank.toString().padStart(3, '0')}`,
              size: entry.size,
              algorithm: 'louvain',
              metadata: {
                resolution: args.resolution ?? DEFAULT_RESOLUTION,
                modularity: partition.modularity,
              } as never,
            } as never);
          } catch (error) {
            logger.warn('temporal-entity-graph.consolidate: community insert failed (continuing)', { error });
          }
        }

        // 5. Back-reference community_id on entities + relationships.
        let mergedEntities = 0;
        for (const node of nodes) {
          const original = partition.communityOf.get(node.id);
          if (original === undefined) continue;
          const communityId = communityIdByOriginal.get(original);
          if (!communityId) continue;
          try {
            await db
              .update(temporalEntities)
              .set({ communityId } as never)
              .where(eq(temporalEntities.id, node.id));
            mergedEntities += 1;
          } catch (error) {
            logger.warn('temporal-entity-graph.consolidate: entity update failed (continuing)', { error });
          }
        }

        for (const rel of relRows) {
          const original = partition.communityOf.get(rel.fromEntityId);
          if (original === undefined) continue;
          const communityId = communityIdByOriginal.get(original);
          if (!communityId) continue;
          try {
            await db
              .update(temporalRelationships)
              .set({ communityId } as never)
              .where(eq(temporalRelationships.id, rel.id));
          } catch (error) {
            logger.warn('temporal-entity-graph.consolidate: relationship update failed (continuing)', { error });
          }
        }

        return {
          tenantId,
          inspectedEntities: nodes.length,
          mergedEntities,
        };
      } catch (error) {
        logger.error('temporal-entity-graph.consolidateForTenant failed', { error: error });
        return report;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Row coercion helpers
// ─────────────────────────────────────────────────────────────────────

interface EntityRowShape {
  id: string;
  tenantId: string;
  entityType: string;
  entityKey: string;
  attributes: unknown;
  validFrom: Date | string;
  validTo: Date | string | null;
  recordedAt: Date | string;
  invalidatedAt: Date | string | null;
  communityId: string | null;
}

interface RelationshipRowShape {
  id: string;
  tenantId: string;
  fromEntityId: string;
  toEntityId: string;
  relationship: string;
  attributes: unknown;
  validFrom: Date | string;
  validTo: Date | string | null;
  recordedAt: Date | string;
  invalidatedAt: Date | string | null;
  communityId: string | null;
}

function dateToIso(v: Date | string | null): string | null {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toEntityRow(row: EntityRowShape): TemporalEntityRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityKey: row.entityKey,
    attributes:
      row.attributes && typeof row.attributes === 'object'
        ? (row.attributes as Record<string, unknown>)
        : {},
    validFrom: dateToIso(row.validFrom) ?? '',
    validTo: dateToIso(row.validTo),
    recordedAt: dateToIso(row.recordedAt) ?? '',
    invalidatedAt: dateToIso(row.invalidatedAt),
    communityId: row.communityId,
  };
}

function toRelationshipRow(
  row: RelationshipRowShape,
): TemporalRelationshipRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    fromEntityId: row.fromEntityId,
    toEntityId: row.toEntityId,
    relationship: row.relationship,
    attributes:
      row.attributes && typeof row.attributes === 'object'
        ? (row.attributes as Record<string, unknown>)
        : {},
    validFrom: dateToIso(row.validFrom) ?? '',
    validTo: dateToIso(row.validTo),
    recordedAt: dateToIso(row.recordedAt) ?? '',
    invalidatedAt: dateToIso(row.invalidatedAt),
    communityId: row.communityId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Stable community ranking — communities are output in descending size;
// the index in that ranked list becomes the cluster label number so a
// repeat-run on the same partition produces the same labels.
// ─────────────────────────────────────────────────────────────────────

interface RankedCommunity {
  readonly original: number;
  readonly rank: number;
  readonly size: number;
}

function rankCommunities(
  partition: LouvainPartition,
): ReadonlyArray<RankedCommunity> {
  const sizeByOriginal = new Map<number, number>();
  for (const community of partition.communityOf.values()) {
    sizeByOriginal.set(community, (sizeByOriginal.get(community) ?? 0) + 1);
  }
  const sorted = Array.from(sizeByOriginal.entries())
    .sort((a, b) => {
      // size DESC, then community-id ASC for deterministic tie-break.
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] - b[0];
    })
    .map(([original, size], idx) => ({ original, rank: idx, size }));
  return sorted;
}
