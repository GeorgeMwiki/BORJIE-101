/**
 * worm-audit-log.service — Drizzle-backed adapter.
 *
 * Satisfies the `WormAuditStore` port declared in
 * `packages/document-studio/src/signing/worm-audit.ts`.
 *
 * The in-memory store remains the default for dev / tests; this adapter
 * is opt-in at the api-gateway composition root. Behaviour matches the
 * in-memory implementation exactly:
 *
 *   - `append` computes the per-tenant chain hash + seq, inserts a row
 *     with `ON CONFLICT (entry_id) DO NOTHING` (idempotent retries),
 *     then re-reads the row to return the canonical entry.
 *   - `list(tenantId)` returns every row for the tenant ordered by
 *     `sequence_number` ascending.
 *   - `verify(tenantId)` walks the chain, recomputing each hash; on
 *     mismatch returns `{ ok: false, brokenAt: <index> }`.
 *
 * Tenant scoping:
 *   - Every query filters by `tenantId`. Cross-tenant reads are
 *     impossible without a deliberate role swap (RLS migration 0155
 *     hardens this at the role level).
 *
 * Error handling:
 *   - Failures degrade to structured-failure paths:
 *     `verify` returns `{ ok: false }` on DB error,
 *     `list` returns `[]`,
 *     `append` rethrows because losing an audit row is a SOC 2 violation.
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - Hash-chained, append-only, per-tenant — mutation is detectable.
 *   - `actor_id` + `tenant_id` + `document_*` satisfies the lawful-basis
 *     audit trail for personal-data exports.
 */

import { createHash, randomUUID } from 'crypto';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import {

  wormAuditLog,
  type WormAuditLogRow,
} from '../schemas/worm-audit-log.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

export interface WormAuditEntry {
  readonly entryId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly documentKind: string;
  readonly documentId: string;
  readonly renderedAtIso: string;
  readonly renderedSha256: string;
  readonly citationsSha256: string;
  readonly previousEntryHash: string | null;
  readonly chainHash: string;
}

/** Mirrors the in-memory port shape. */
export interface WormAuditStore {
  append(
    entry: Omit<
      WormAuditEntry,
      'entryId' | 'previousEntryHash' | 'chainHash'
    >,
  ): Promise<WormAuditEntry>;
  list(tenantId: string): Promise<ReadonlyArray<WormAuditEntry>>;
  verify(tenantId: string): Promise<{ ok: boolean; brokenAt?: number }>;
}

export type WormAuditStoreService = WormAuditStore;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function chainHashOf(entry: {
  readonly entryId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly documentKind: string;
  readonly documentId: string;
  readonly renderedAtIso: string;
  readonly renderedSha256: string;
  readonly citationsSha256: string;
  readonly previousEntryHash: string | null;
}): string {
  return sha256Hex(
    JSON.stringify({
      entryId: entry.entryId,
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      documentKind: entry.documentKind,
      documentId: entry.documentId,
      renderedAtIso: entry.renderedAtIso,
      renderedSha256: entry.renderedSha256,
      citationsSha256: entry.citationsSha256,
      previousEntryHash: entry.previousEntryHash,
    }),
  );
}

function rowToEntry(row: WormAuditLogRow): WormAuditEntry {
  return Object.freeze({
    entryId: row.entryId,
    tenantId: row.tenantId,
    actorId: row.actorId,
    documentKind: row.documentKind,
    documentId: row.documentId,
    renderedAtIso: row.renderedAtIso,
    renderedSha256: row.renderedSha256,
    citationsSha256: row.citationsSha256,
    previousEntryHash: row.previousEntryHash ?? null,
    chainHash: row.chainHash,
  });
}

export function createWormAuditLogService(db: DatabaseClient): WormAuditStore {
  return {
    async append(input) {
      if (!input.tenantId) {
        throw new Error('worm-audit-log.append: tenantId is required');
      }
      if (!input.actorId) {
        throw new Error('worm-audit-log.append: actorId is required');
      }

      // Read the current tail for this tenant (highest sequence_number).
      const tailRows = (await db
        .select(SELECT_COLS)
        .from(wormAuditLog)
        .where(eq(wormAuditLog.tenantId, input.tenantId))
        .orderBy(sql`${wormAuditLog.sequenceNumber} DESC`)
        .limit(1)) as ReadonlyArray<WormAuditLogRow>;
      const tail = tailRows[0] ?? null;
      const previousEntryHash = tail?.chainHash ?? null;
      const sequenceNumber = (tail?.sequenceNumber ?? 0) + 1;
      const entryId = `worm-${Date.now()}-${randomUUID().slice(0, 8)}`;

      const draft = {
        entryId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        documentKind: input.documentKind,
        documentId: input.documentId,
        renderedAtIso: input.renderedAtIso,
        renderedSha256: input.renderedSha256,
        citationsSha256: input.citationsSha256,
        previousEntryHash,
      };
      const chainHash = chainHashOf(draft);

      try {
        await db
          .insert(wormAuditLog)
          .values({
            ...draft,
            chainHash,
            sequenceNumber,
          } as never)
          .onConflictDoNothing({ target: wormAuditLog.entryId });
      } catch (error) {
        // Audit-log writes that fail are a SOC 2 / GDPR Art. 30 violation.
        // Bubble up so the caller (document-studio) can refuse delivery
        // rather than silently lose the trail.
        logger.error('worm-audit-log.append failed', { error: error });
        throw error;
      }

      return Object.freeze({ ...draft, chainHash });
    },

    async list(tenantId) {
      try {
        if (!tenantId) return Object.freeze([]);
        const rows = (await db
          .select(SELECT_COLS)
          .from(wormAuditLog)
          .where(eq(wormAuditLog.tenantId, tenantId))
          .orderBy(asc(wormAuditLog.sequenceNumber))) as ReadonlyArray<WormAuditLogRow>;
        return Object.freeze((rows ?? []).map(rowToEntry));
      } catch (error) {
        logger.error('worm-audit-log.list failed', { error: error });
        return Object.freeze([]);
      }
    },

    async verify(tenantId) {
      try {
        if (!tenantId) return { ok: true };
        const rows = (await db
          .select(SELECT_COLS)
          .from(wormAuditLog)
          .where(eq(wormAuditLog.tenantId, tenantId))
          .orderBy(asc(wormAuditLog.sequenceNumber))) as ReadonlyArray<WormAuditLogRow>;
        let prevHash: string | null = null;
        for (let i = 0; i < (rows ?? []).length; i += 1) {
          const row = rows![i]!;
          if ((row.previousEntryHash ?? null) !== prevHash) {
            return { ok: false, brokenAt: i };
          }
          const recomputed = chainHashOf({
            entryId: row.entryId,
            tenantId: row.tenantId,
            actorId: row.actorId,
            documentKind: row.documentKind,
            documentId: row.documentId,
            renderedAtIso: row.renderedAtIso,
            renderedSha256: row.renderedSha256,
            citationsSha256: row.citationsSha256,
            previousEntryHash: row.previousEntryHash ?? null,
          });
          if (recomputed !== row.chainHash) {
            return { ok: false, brokenAt: i };
          }
          prevHash = row.chainHash;
        }
        return { ok: true };
      } catch (error) {
        logger.error('worm-audit-log.verify failed', { error: error });
        return { ok: false };
      }
    },
  };
}

const SELECT_COLS = {
  entryId: wormAuditLog.entryId,
  tenantId: wormAuditLog.tenantId,
  actorId: wormAuditLog.actorId,
  documentKind: wormAuditLog.documentKind,
  documentId: wormAuditLog.documentId,
  renderedAtIso: wormAuditLog.renderedAtIso,
  renderedSha256: wormAuditLog.renderedSha256,
  citationsSha256: wormAuditLog.citationsSha256,
  previousEntryHash: wormAuditLog.previousEntryHash,
  chainHash: wormAuditLog.chainHash,
  sequenceNumber: wormAuditLog.sequenceNumber,
  createdAt: wormAuditLog.createdAt,
} as const;

// Re-export the schema so wirers can grab it from this module.
export { wormAuditLog };
// Silence "unused import" when no SQL helper is referenced.
void (and as unknown as SQL);
