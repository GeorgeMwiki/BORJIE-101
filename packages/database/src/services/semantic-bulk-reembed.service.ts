/**
 * Bulk re-embedder for `kernel_memory_semantic`.
 *
 * B4 Phase B — Progressive Intelligence. Stage 07 of the nightly
 * consolidation cycle.
 *
 * What it does:
 *
 *   1. Iterates `kernel_memory_semantic` in chunks of 500 rows
 *      (configurable). Selection priority is `last_embedded_at NULLS
 *      FIRST` so rows that have NEVER been embedded surface first;
 *      then ascending `last_embedded_at` so the oldest re-embed
 *      target is next.
 *   2. For each row whose `last_embedded_at` is BEFORE the
 *      `modelCutoff` timestamp (i.e. the embedding it currently
 *      carries was produced before the active model version went
 *      live), feeds `key || ' = ' || JSON.stringify(value)` through
 *      the supplied embedder.
 *   3. Writes the resulting vector back via `embedding = ?` and
 *      stamps `last_embedded_at = NOW()`.
 *   4. Reports `{ reEmbeddedCount, inspectedCount }` per tenant.
 *
 * Resumability:
 *   - Each chunk is independent. A crash mid-chunk loses at most
 *     `chunkSize - 1` writes; the next tick picks them up because
 *     the index orders NULLs first.
 *   - Embedder failures degrade gracefully — the row is skipped (NOT
 *     stamped) so a transient OpenAI 429 doesn't lock the row out
 *     of future re-embedding.
 *
 * Hard DB failures degrade to a zero-impact report — never throws to
 * the caller. The consolidation worker's safe-stage wrapper will log
 * + continue.
 */

import { and, asc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { kernelMemorySemantic } from '../schemas/kernel-memory-semantic.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export interface BulkReEmbedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

export interface ReEmbedForTenantArgs {
  readonly tenantId: string | null;
  /** Hard cap on rows processed per call. Default 500. */
  readonly limit?: number;
  /** Rows in chunks. Default 100. */
  readonly chunkSize?: number;
  /**
   * The point in time the active embedding-model version went live.
   * Rows whose `last_embedded_at >= modelCutoff` are SKIPPED — they
   * already carry an up-to-date embedding. Default: never (epoch),
   * i.e. consider every row.
   */
  readonly modelCutoff?: Date | string;
}

export interface ReEmbedReport {
  readonly tenantId: string | null;
  readonly reEmbeddedCount: number;
  readonly inspectedCount: number;
}

export interface SemanticBulkReEmbedService {
  reEmbedForTenant(args: ReEmbedForTenantArgs): Promise<ReEmbedReport>;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_CHUNK = 100;
const MAX_LIMIT = 5_000;
const EMBEDDING_DIMS = 1536;

export function createSemanticBulkReEmbedService(
  db: DatabaseClient,
  embedder: BulkReEmbedder,
): SemanticBulkReEmbedService {
  return {
    async reEmbedForTenant(args) {
      const tenantId = args.tenantId;
      const limit = clampLimit(args.limit, DEFAULT_LIMIT);
      const chunkSize = Math.min(
        Math.max(1, args.chunkSize ?? DEFAULT_CHUNK),
        limit,
      );
      const modelCutoff = toDate(args.modelCutoff) ?? new Date(0);
      const baseReport: ReEmbedReport = {
        tenantId,
        reEmbeddedCount: 0,
        inspectedCount: 0,
      };

      let inspected = 0;
      let written = 0;

      try {
        while (inspected < limit) {
          const remaining = limit - inspected;
          const fetchN = Math.min(chunkSize, remaining);

          const conds: SQL<unknown>[] = [];
          if (tenantId === null) {
            conds.push(isNull(kernelMemorySemantic.tenantId));
          } else {
            conds.push(eq(kernelMemorySemantic.tenantId, tenantId));
          }
          // Eligibility: last_embedded_at IS NULL OR last_embedded_at < modelCutoff
          conds.push(
            or(
              isNull(kernelMemorySemantic.lastEmbeddedAt),
              lt(kernelMemorySemantic.lastEmbeddedAt, modelCutoff),
            ) as SQL<unknown>,
          );

          // NULLS FIRST ordering — never-embedded rows come first.
          const rows = (await db
            .select({
              id: kernelMemorySemantic.id,
              key: kernelMemorySemantic.key,
              value: kernelMemorySemantic.value,
              lastEmbeddedAt: kernelMemorySemantic.lastEmbeddedAt,
            })
            .from(kernelMemorySemantic)
            .where(and(...conds))
            .orderBy(
              sql`${kernelMemorySemantic.lastEmbeddedAt} ASC NULLS FIRST`,
              asc(kernelMemorySemantic.id),
            )
            .limit(fetchN)) as ReadonlyArray<{
            id: string;
            key: string;
            value: unknown;
            lastEmbeddedAt: Date | string | null;
          }>;

          if (!rows || rows.length === 0) break;
          inspected += rows.length;

          for (const row of rows) {
            const composed = composeEmbeddingInput(row.key, row.value);
            let embedding: ReadonlyArray<number> | null = null;
            try {
              embedding = await embedder.embed(composed);
            } catch (error) {
              logger.warn('semantic-bulk-reembed: embedder failed (skipping row)', { error });
              continue;
            }
            const sanitised = sanitizeEmbedding(embedding);
            if (!sanitised) continue;

            try {
              await db
                .update(kernelMemorySemantic)
                .set({
                  embedding: sanitised as never,
                  lastEmbeddedAt: new Date(),
                } as never)
                .where(eq(kernelMemorySemantic.id, row.id));
              written += 1;
            } catch (error) {
              logger.warn('semantic-bulk-reembed: update failed (skipping row)', { error });
            }
          }

          // If this chunk returned fewer rows than requested we've
          // exhausted eligible rows for this tenant.
          if (rows.length < fetchN) break;
        }
      } catch (error) {
        logger.error('semantic-bulk-reembed.reEmbedForTenant failed', { error: error });
        return baseReport;
      }

      return {
        tenantId,
        inspectedCount: inspected,
        reEmbeddedCount: written,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_LIMIT);
}

function toDate(v: Date | string | undefined): Date | null {
  if (v === undefined) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compose the embedding input for a semantic fact. Mirrors the format
 * the kernel uses when it embeds a query for retrieval (`key = value`)
 * so the same vector geometry round-trips.
 */
function composeEmbeddingInput(key: string, value: unknown): string {
  let valueText: string;
  try {
    valueText =
      typeof value === 'string'
        ? value
        : JSON.stringify(value ?? '');
  } catch {
    valueText = '';
  }
  // Keep the input bounded — OpenAI text-embedding-3-small accepts up
  // to 8191 tokens, but for facts we expect << 200 tokens.
  return `${key} = ${valueText}`.slice(0, 8_000);
}

function sanitizeEmbedding(
  raw: ReadonlyArray<number> | null | undefined,
): number[] | null {
  if (!raw || !Array.isArray(raw)) return null;
  if (raw.length !== EMBEDDING_DIMS) {
    logger.warn(`semantic-bulk-reembed: dropping embedding — expected ${EMBEDDING_DIMS} dims, got ${raw.length}`);
    return null;
  }
  const out: number[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const n = Number(raw[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}
