/**
 * Consolidation emissions service (D8 follow-up).
 *
 * Idempotent record + paginated list. Stage 08 (publish) UPSERTs on
 * (tenant_id, emission_date) so a re-run on the same day updates rather
 * than inserts.
 */

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { consolidationEmissions } from '../schemas/consolidation-emissions.schema.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

type DrizzleClient =
  | NodePgDatabase<Record<string, never>>
  | PostgresJsDatabase<Record<string, never>>;

export interface ConsolidationEmission {
  readonly id: string;
  readonly tenantId: string;
  readonly emissionDate: string; // ISO YYYY-MM-DD
  readonly tickId: string;
  readonly factsDistilled: number;
  readonly factsPromoted: number;
  readonly reflexionLessonsWritten: number;
  readonly entitiesConsolidated: number;
  readonly communitiesDetected: number;
  readonly rowsReEmbedded: number;
  readonly digestMarkdown: string | null;
  readonly highlights: ReadonlyArray<Record<string, unknown>>;
  readonly emittedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecordConsolidationEmissionArgs {
  readonly tenantId: string;
  readonly emissionDate: string; // YYYY-MM-DD
  readonly tickId: string;
  readonly factsDistilled?: number;
  readonly factsPromoted?: number;
  readonly reflexionLessonsWritten?: number;
  readonly entitiesConsolidated?: number;
  readonly communitiesDetected?: number;
  readonly rowsReEmbedded?: number;
  readonly digestMarkdown?: string | null;
  readonly highlights?: ReadonlyArray<Record<string, unknown>>;
}

export interface ListConsolidationEmissionsArgs {
  readonly tenantId: string;
  readonly since?: string; // YYYY-MM-DD
  readonly until?: string; // YYYY-MM-DD
  readonly limit?: number;
  readonly offset?: number;
}

export interface ConsolidationEmissionsService {
  record(args: RecordConsolidationEmissionArgs): Promise<ConsolidationEmission>;
  list(args: ListConsolidationEmissionsArgs): Promise<ReadonlyArray<ConsolidationEmission>>;
  latestForTenant(tenantId: string): Promise<ConsolidationEmission | null>;
}

function toModel(row: typeof consolidationEmissions.$inferSelect): ConsolidationEmission {
  return {
    id: row.id,
    tenantId: row.tenantId,
    emissionDate: row.emissionDate,
    tickId: row.tickId,
    factsDistilled: row.factsDistilled,
    factsPromoted: row.factsPromoted,
    reflexionLessonsWritten: row.reflexionLessonsWritten,
    entitiesConsolidated: row.entitiesConsolidated,
    communitiesDetected: row.communitiesDetected,
    rowsReEmbedded: row.rowsReEmbedded,
    digestMarkdown: row.digestMarkdown ?? null,
    highlights: Array.isArray(row.highlights)
      ? (row.highlights as ReadonlyArray<Record<string, unknown>>)
      : [],
    emittedAt: row.emittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createConsolidationEmissionsService(
  db: DrizzleClient,
): ConsolidationEmissionsService {
  return {
    async record(args) {
      const id = randomUUID();
      const highlights = args.highlights ?? [];
      const inserted = await db
        .insert(consolidationEmissions)
        .values({
          id,
          tenantId: args.tenantId,
          emissionDate: args.emissionDate,
          tickId: args.tickId,
          factsDistilled: args.factsDistilled ?? 0,
          factsPromoted: args.factsPromoted ?? 0,
          reflexionLessonsWritten: args.reflexionLessonsWritten ?? 0,
          entitiesConsolidated: args.entitiesConsolidated ?? 0,
          communitiesDetected: args.communitiesDetected ?? 0,
          rowsReEmbedded: args.rowsReEmbedded ?? 0,
          digestMarkdown: args.digestMarkdown ?? null,
          highlights: highlights as never,
        })
        .onConflictDoUpdate({
          target: [consolidationEmissions.tenantId, consolidationEmissions.emissionDate],
          set: {
            tickId: args.tickId,
            factsDistilled: args.factsDistilled ?? 0,
            factsPromoted: args.factsPromoted ?? 0,
            reflexionLessonsWritten: args.reflexionLessonsWritten ?? 0,
            entitiesConsolidated: args.entitiesConsolidated ?? 0,
            communitiesDetected: args.communitiesDetected ?? 0,
            rowsReEmbedded: args.rowsReEmbedded ?? 0,
            digestMarkdown: args.digestMarkdown ?? null,
            highlights: highlights as never,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error('consolidation-emissions.record: insert returned no row');
      }
      return toModel(row);
    },

    async list(args) {
      const conditions = [eq(consolidationEmissions.tenantId, args.tenantId)];
      if (args.since) {
        conditions.push(gte(consolidationEmissions.emissionDate, args.since));
      }
      if (args.until) {
        conditions.push(lte(consolidationEmissions.emissionDate, args.until));
      }
      const rows = await db
        .select()
        .from(consolidationEmissions)
        .where(and(...conditions))
        .orderBy(desc(consolidationEmissions.emissionDate))
        .limit(args.limit ?? 50)
        .offset(args.offset ?? 0);
      return rows.map(toModel);
    },

    async latestForTenant(tenantId) {
      const rows = await db
        .select()
        .from(consolidationEmissions)
        .where(eq(consolidationEmissions.tenantId, tenantId))
        .orderBy(desc(consolidationEmissions.emissionDate))
        .limit(1);
      const row = rows[0];
      return row ? toModel(row) : null;
    },
  };
}
