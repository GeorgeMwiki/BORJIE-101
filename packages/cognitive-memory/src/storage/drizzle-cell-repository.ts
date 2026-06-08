/**
 * Cell repository — Drizzle/Postgres implementation (Wave 18AA follow-up).
 *
 * Durable counterpart to `createInMemoryCellRepository`. Persists every
 * cognitive memory cell to the `cognitive_memory_cells` table
 * (migration 0029) so the "MD that remembers" promise survives a
 * process restart — the in-memory variant loses every cell on reboot.
 *
 * Design
 * ------
 *   - Same `CellRepository` port as the in-memory reference impl. The
 *     composition root swaps one for the other without any other change.
 *   - `searchByEmbedding` uses pgvector's `<=>` cosine-distance operator
 *     (similarity = 1 - distance), mirroring the idiom in
 *     `kernel-memory-semantic.service.ts`. Scope visibility (`tenant_root`
 *     sees all; a child scope sees own + `tenant_root`) is enforced in
 *     SQL so RLS + the scope rule both hold.
 *   - Immutability: rows are mapped to NEW frozen domain objects; no
 *     caller-supplied object is mutated, and `update` issues a single
 *     SQL UPDATE rather than read-modify-write.
 *   - Validation: every public write/read input is zod-validated before
 *     touching the DB so malformed wire data never reaches Postgres.
 *   - No `console.*`. A narrow structural logger is injected; failures
 *     surface as typed `CognitiveMemoryError`s for the caller to log via
 *     its own Pino instance.
 *
 * Dependency direction: `@borjie/cognitive-memory` → `@borjie/database`
 * (one-way; `@borjie/database` never imports this package, so no cycle).
 */

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  cognitiveMemoryCells,
  type DatabaseClient,
  type CognitiveMemoryCellRow,
} from '@borjie/database';

import {
  CognitiveMemoryError,
  EMBEDDING_DIM,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type CellRepository,
  type CognitiveMemoryCell,
  type MemoryContent,
  type MemoryKind,
  type MemoryScope,
  type MemoryStatus,
  type SpanCitation,
} from '../types.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Narrow logger contract — keeps this module free of any logging library.
// The host injects a Pino-backed adapter; failures are otherwise raised as
// typed CognitiveMemoryError so the caller logs them with redaction.
// ---------------------------------------------------------------------------

export interface DrizzleCellRepositoryLogger {
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

const NOOP_LOGGER: DrizzleCellRepositoryLogger = Object.freeze({
  warn: (): void => {
    // intentional no-op default logger
  },
});

// ---------------------------------------------------------------------------
// Zod validation — guard the boundary before any SQL is issued.
// ---------------------------------------------------------------------------

const tenantIdSchema = z.string().min(1);
const scopeIdSchema = z.string().min(1);
const cellIdSchema = z.string().min(1);

const embeddingSchema = z
  .array(z.number())
  .length(EMBEDDING_DIM, `embedding must be ${String(EMBEDDING_DIM)}-dim`);

const searchOptsSchema = z.object({
  limit: z.number().int().positive(),
  kinds: z.array(z.enum(MEMORY_KINDS)).optional(),
  statuses: z.array(z.enum(MEMORY_STATUSES)).optional(),
});

// ---------------------------------------------------------------------------
// Row <-> domain mapping. Postgres returns numeric as a string, timestamps
// as Date, jsonb as unknown, and the pgvector column as number[] | null.
// We normalise to the immutable `CognitiveMemoryCell` domain shape.
// ---------------------------------------------------------------------------

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toIsoRequired(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toNumber(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toStructured(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

function toCitations(value: unknown): ReadonlyArray<SpanCitation> {
  return Array.isArray(value) ? (value as ReadonlyArray<SpanCitation>) : [];
}

function rowToCell(row: CognitiveMemoryCellRow): CognitiveMemoryCell {
  const content: MemoryContent = Object.freeze({
    text: row.contentText,
    embedding: Object.freeze([...(row.embedding ?? [])]),
    structured: toStructured(row.contentStructured),
  });
  return Object.freeze({
    id: row.id,
    tenant_id: row.tenantId,
    scope_id: row.scopeId,
    content,
    kind: row.kind as MemoryKind,
    contributed_by_specialisation: row.contributedBySpecialisation,
    reinforced_by_specialisations: Object.freeze([
      ...row.reinforcedBySpecialisations,
    ]),
    contributed_in_turn_id: row.contributedInTurnId ?? '',
    reinforced_in_turn_ids: Object.freeze([...row.reinforcedInTurnIds]),
    evidence_citations: Object.freeze(toCitations(row.evidenceCitations)),
    confidence_score: toNumber(row.confidenceScore),
    access_count: row.accessCount,
    last_accessed_at: toIso(row.lastAccessedAt),
    created_at: toIsoRequired(row.createdAt),
    promoted_at: toIso(row.promotedAt),
    decayed_at: toIso(row.decayedAt),
    promotion_status: row.promotionStatus as MemoryStatus,
    contradicting_cell_id: row.contradictingCellId,
    audit_hash: row.auditHash,
  });
}

// ---------------------------------------------------------------------------
// Scope visibility predicate, expressed in SQL.
//   - `tenant_root` query scope → every cell in the tenant.
//   - any other scope → cells in that scope OR in `tenant_root`.
// Mirrors `isMatchingScope` in the in-memory repo.
// ---------------------------------------------------------------------------

function scopeCondition(scopeId: MemoryScope): SQL<unknown> | undefined {
  if (scopeId === 'tenant_root') {
    return undefined; // tenant filter alone suffices
  }
  return inArray(cognitiveMemoryCells.scopeId, [scopeId, 'tenant_root']);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a Drizzle-backed {@link CellRepository}. Every method maps
 * Postgres rows into immutable domain cells. Validation failures and DB
 * faults surface as {@link CognitiveMemoryError} so the caller logs them
 * via its own redacting logger.
 *
 * @param db     A Drizzle client (postgres-js backed). RLS pins the
 *               tenant via the `app.tenant_id` GUC at the request layer;
 *               this repo additionally filters by `tenant_id` for defence
 *               in depth.
 * @param logger Optional structural logger for non-fatal diagnostics.
 */
export function createDrizzleCellRepository(
  db: DatabaseClient,
  logger: DrizzleCellRepositoryLogger = NOOP_LOGGER,
): CellRepository {
  return {
    async insert(cell: CognitiveMemoryCell): Promise<CognitiveMemoryCell> {
      const id = cellIdSchema.safeParse(cell.id);
      const tenant = tenantIdSchema.safeParse(cell.tenant_id);
      if (!id.success || !tenant.success) {
        throw new CognitiveMemoryError(
          'cell_repo.invalid_insert',
          'drizzle cell repo: cell id and tenant_id are required',
        );
      }
      try {
        const inserted = await db
          .insert(cognitiveMemoryCells)
          .values({
            id: cell.id,
            tenantId: cell.tenant_id,
            scopeId: cell.scope_id,
            kind: cell.kind,
            contentText: cell.content.text,
            contentStructured: cell.content.structured,
            embedding: [...cell.content.embedding],
            contributedBySpecialisation: cell.contributed_by_specialisation,
            reinforcedBySpecialisations: [...cell.reinforced_by_specialisations],
            contributedInTurnId:
              cell.contributed_in_turn_id.length > 0
                ? cell.contributed_in_turn_id
                : null,
            reinforcedInTurnIds: [...cell.reinforced_in_turn_ids],
            evidenceCitations: cell.evidence_citations,
            confidenceScore: cell.confidence_score.toFixed(2),
            accessCount: cell.access_count,
            lastAccessedAt:
              cell.last_accessed_at === null
                ? null
                : new Date(cell.last_accessed_at),
            promotionStatus: cell.promotion_status,
            contradictingCellId: cell.contradicting_cell_id,
            createdAt: new Date(cell.created_at),
            promotedAt:
              cell.promoted_at === null ? null : new Date(cell.promoted_at),
            decayedAt:
              cell.decayed_at === null ? null : new Date(cell.decayed_at),
            auditHash: cell.audit_hash,
          })
          .returning();
        const row = inserted[0];
        if (row === undefined) {
          throw new CognitiveMemoryError(
            'cell_repo.insert_no_row',
            `drizzle cell repo: insert returned no row for ${cell.id}`,
          );
        }
        return rowToCell(row);
      } catch (err) {
        if (err instanceof CognitiveMemoryError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        // Unique-violation on the primary key → mirror the in-memory
        // repo's `duplicate_id` contract so callers branch identically.
        if (/duplicate key|unique constraint/i.test(message)) {
          throw new CognitiveMemoryError(
            'cell_repo.duplicate_id',
            `cell ${cell.id} already exists`,
          );
        }
        throw new CognitiveMemoryError(
          'cell_repo.insert_failed',
          `drizzle cell repo: insert failed for ${cell.id}`,
          { error: message },
        );
      }
    },

    async read(
      id: string,
      tenantId: string,
    ): Promise<CognitiveMemoryCell | null> {
      const idParse = cellIdSchema.safeParse(id);
      const tenantParse = tenantIdSchema.safeParse(tenantId);
      if (!idParse.success || !tenantParse.success) {
        return null;
      }
      try {
        const rows = await db
          .select()
          .from(cognitiveMemoryCells)
          .where(
            and(
              eq(cognitiveMemoryCells.id, id),
              eq(cognitiveMemoryCells.tenantId, tenantId),
            ),
          )
          .limit(1);
        const row = rows[0];
        return row === undefined ? null : rowToCell(row);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CognitiveMemoryError(
          'cell_repo.read_failed',
          `drizzle cell repo: read failed for ${id}`,
          { error: message },
        );
      }
    },

    async update(
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
    ): Promise<CognitiveMemoryCell | null> {
      const idParse = cellIdSchema.safeParse(id);
      const tenantParse = tenantIdSchema.safeParse(tenantId);
      if (!idParse.success || !tenantParse.success) {
        return null;
      }
      // Build a new, typed set object — only forward the fields actually
      // present so we never overwrite a column with undefined.
      const set: Partial<typeof cognitiveMemoryCells.$inferInsert> = {};
      if (patch.reinforced_by_specialisations !== undefined) {
        set.reinforcedBySpecialisations = [
          ...patch.reinforced_by_specialisations,
        ];
      }
      if (patch.reinforced_in_turn_ids !== undefined) {
        set.reinforcedInTurnIds = [...patch.reinforced_in_turn_ids];
      }
      if (patch.evidence_citations !== undefined) {
        set.evidenceCitations = patch.evidence_citations;
      }
      if (patch.confidence_score !== undefined) {
        set.confidenceScore = patch.confidence_score.toFixed(2);
      }
      if (patch.access_count !== undefined) {
        set.accessCount = patch.access_count;
      }
      if (patch.last_accessed_at !== undefined) {
        set.lastAccessedAt =
          patch.last_accessed_at === null
            ? null
            : new Date(patch.last_accessed_at);
      }
      if (patch.promoted_at !== undefined) {
        set.promotedAt =
          patch.promoted_at === null ? null : new Date(patch.promoted_at);
      }
      if (patch.decayed_at !== undefined) {
        set.decayedAt =
          patch.decayed_at === null ? null : new Date(patch.decayed_at);
      }
      if (patch.promotion_status !== undefined) {
        set.promotionStatus = patch.promotion_status;
      }
      if (patch.contradicting_cell_id !== undefined) {
        set.contradictingCellId = patch.contradicting_cell_id;
      }
      if (patch.audit_hash !== undefined) {
        set.auditHash = patch.audit_hash;
      }

      // No-op patch → return the current row unchanged (matches the
      // in-memory repo, which spreads an empty patch into the same cell).
      if (Object.keys(set).length === 0) {
        return this.read(id, tenantId);
      }

      try {
        const updated = await db
          .update(cognitiveMemoryCells)
          .set(set)
          .where(
            and(
              eq(cognitiveMemoryCells.id, id),
              eq(cognitiveMemoryCells.tenantId, tenantId),
            ),
          )
          .returning();
        const row = updated[0];
        return row === undefined ? null : rowToCell(row);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CognitiveMemoryError(
          'cell_repo.update_failed',
          `drizzle cell repo: update failed for ${id}`,
          { error: message },
        );
      }
    },

    async searchByEmbedding(
      tenantId: string,
      scopeId: MemoryScope,
      embedding: ReadonlyArray<number>,
      opts: {
        readonly limit: number;
        readonly kinds?: ReadonlyArray<MemoryKind>;
        readonly statuses?: ReadonlyArray<MemoryStatus>;
      },
    ): Promise<
      ReadonlyArray<{
        readonly cell: CognitiveMemoryCell;
        readonly similarity: number;
      }>
    > {
      const tenantParse = tenantIdSchema.safeParse(tenantId);
      const scopeParse = scopeIdSchema.safeParse(scopeId);
      const embeddingParse = embeddingSchema.safeParse([...embedding]);
      const optsParse = searchOptsSchema.safeParse(opts);
      if (
        !tenantParse.success ||
        !scopeParse.success ||
        !embeddingParse.success ||
        !optsParse.success
      ) {
        throw new CognitiveMemoryError(
          'cell_repo.invalid_search',
          'drizzle cell repo: invalid searchByEmbedding arguments',
          {
            issues: [
              ...(tenantParse.success ? [] : tenantParse.error.issues),
              ...(scopeParse.success ? [] : scopeParse.error.issues),
              ...(embeddingParse.success ? [] : embeddingParse.error.issues),
              ...(optsParse.success ? [] : optsParse.error.issues),
            ],
          },
        );
      }

      try {
        const queryLiteral = `[${embeddingParse.data.join(',')}]`;
        // Cosine distance in [0,2]; similarity = 1 - distance in [-1,1].
        const distanceExpr = sql<number>`${cognitiveMemoryCells.embedding} <=> ${queryLiteral}::vector`;

        const conds: SQL<unknown>[] = [
          eq(cognitiveMemoryCells.tenantId, tenantId),
        ];
        const scopeCond = scopeCondition(scopeId);
        if (scopeCond !== undefined) conds.push(scopeCond);
        if (opts.kinds !== undefined && opts.kinds.length > 0) {
          conds.push(inArray(cognitiveMemoryCells.kind, [...opts.kinds]));
        }
        if (opts.statuses !== undefined && opts.statuses.length > 0) {
          conds.push(
            inArray(cognitiveMemoryCells.promotionStatus, [...opts.statuses]),
          );
        }
        // Exclude NULL embeddings — pgvector distance against NULL is
        // undefined and would surface as NaN.
        conds.push(sql`${cognitiveMemoryCells.embedding} IS NOT NULL`);

        const rows = (await db
          .select({
            row: cognitiveMemoryCells,
            distance: distanceExpr,
          })
          .from(cognitiveMemoryCells)
          .where(and(...conds))
          .orderBy(distanceExpr)
          .limit(opts.limit)) as ReadonlyArray<{
          row: CognitiveMemoryCellRow;
          distance: number;
        }>;

        return rows
          .filter((r) => Number.isFinite(Number(r.distance)))
          .map((r) =>
            Object.freeze({
              cell: rowToCell(r.row),
              similarity: 1 - Number(r.distance),
            }),
          );
      } catch (err) {
        logger.warn('drizzle cell repo: searchByEmbedding failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new CognitiveMemoryError(
          'cell_repo.search_failed',
          'drizzle cell repo: searchByEmbedding failed',
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
  };
}
