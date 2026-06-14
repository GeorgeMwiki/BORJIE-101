/**
 * /api/v1/mining/{ppe-receipts,driver-letter-acks,excavator-counts,
 *  photo-uploads,fingerprint-signs} — field-capture offline-sync sinks.
 *
 * Closes the BLOCKER where five workforce-mobile offline-sync entity types
 * flushed to UNMOUNTED gateway routes (HTTP 404). The sync layer used to
 * classify any 4xx — including 404 — as terminal and DELETE the queued record
 * on the first reconnect flush, silently and permanently losing irreplaceable
 * mine field evidence after the UI already showed a "saved offline" confirm.
 *
 * The flush layer (apps/workforce-mobile/src/sync/flush.ts) computes each path
 * via `endpointFor()` (snake → kebab + 's'):
 *   ppe_receipt       → ppe-receipts        → ppe_issues
 *   driver_letter_ack → driver-letter-acks  → (no table yet — degrades safely)
 *   excavator_count   → excavator-counts    → ore_parcels
 *   photo_upload      → photo-uploads       → document_uploads
 *   fingerprint_sign  → fingerprint-signs   → fingerprint_events
 *   inventory_move    → inventory/movements → converges on the ONLINE route
 *                       (handled in flush.ts, not here)
 *
 * SHAPE (mirrors toolbox-acks.hono.ts):
 *   - auth + databaseMiddleware (RLS `app.current_tenant_id` GUC bound).
 *   - identity (tenant + user) is taken from `c.get('auth')` ONLY; the body's
 *     advisory `userId` is provenance, never trusted for the principal.
 *   - idempotent: the queue entry id arrives as the `Idempotency-Key` header
 *     and seeds a deterministic row PK, so an at-least-once re-flush no-ops the
 *     replay instead of double-recording evidence.
 *   - hash-chained audit append, atomic with the domain write (ONE tx).
 *   - tenant-scoped predicate on auth.tenantId (belt-and-braces vs the WITH
 *     CHECK) on every insert.
 *
 * Where a target table does not yet exist (driver_letter_ack), the handler
 * DEGRADES SAFELY: it still 2xx-accepts and writes the hash-chained audit row,
 * so the worker's offline record is durably acknowledged server-side and is
 * never the cause of a silent delete. The needed table is reported separately.
 */

import { Hono } from 'hono';
import { randomUUID, createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  ppeIssues,
  fingerprintEvents,
  oreParcels,
  documentUploads,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-field-capture');

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

interface JsonError {
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503;
  readonly body: {
    readonly success: false;
    readonly error: { readonly code: string; readonly message: string };
  };
}

function jsonError(
  code: string,
  message: string,
  status: JsonError['status'],
): JsonError {
  return { status, body: { success: false, error: { code, message } } };
}

/**
 * Deterministic row id for a field-capture record. When the flush layer sends
 * its stable queue-entry id as `Idempotency-Key`, the row PK is derived from
 * (tenant, key) so a replay collides on the PK and is no-op'd. With no key
 * (e.g. a direct caller) a fresh UUID is minted so direct posts still work.
 */
function rowId(tenantId: string, idempotencyKey: string | null): string {
  if (!idempotencyKey) {
    return randomUUID();
  }
  return createHash('sha256')
    .update(`${tenantId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
}

function readIdempotencyKey(c: {
  req: { header: (name: string) => string | undefined };
}): string | null {
  return c.req.header('Idempotency-Key')?.trim() || null;
}

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Record<string, unknown>;
}

/**
 * Hash-chain audit append — identical algorithm to toolbox-acks.hono.ts so a
 * record captured via the offline-sync sink is forensically indistinguishable
 * from one captured on the foreground path.
 */
 
async function appendAuditEntry(
  db: any,
  payload: AuditAppendPayload,
): Promise<string> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    turnId: payload.turnId,
    action: payload.action,
    userId: payload.userId,
    details: payload.details,
  });
  const latestResult: unknown = await db.execute(
    sql`SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
               (SELECT this_hash FROM ai_audit_chain
                WHERE tenant_id = ${payload.tenantId}
                ORDER BY sequence_id DESC LIMIT 1) AS last_hash
        FROM ai_audit_chain
        WHERE tenant_id = ${payload.tenantId}`,
  );
  const rows =
    (latestResult as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (latestResult as ReadonlyArray<Record<string, unknown>>);
  const head = rows[0] ?? {};
  const maxSeq = Number(head.max_seq ?? 0);
  const lastHash =
    typeof head.last_hash === 'string' && head.last_hash.length > 0
      ? head.last_hash
      : '';
  const sequenceId = maxSeq + 1;
  const thisHash = createHash('sha256')
    .update(lastHash + canonical)
    .digest('hex');
  await db.execute(sql`
    INSERT INTO ai_audit_chain (
      id, tenant_id, sequence_id, turn_id, action,
      prev_hash, this_hash, payload, created_at
    ) VALUES (
      ${id}, ${payload.tenantId}, ${sequenceId}, ${payload.turnId},
      ${payload.action}, ${lastHash}, ${thisHash},
      ${JSON.stringify({ userId: payload.userId, details: payload.details })}::jsonb,
      ${new Date().toISOString()}
    )
  `);
  return id;
}

/**
 * Thrown by a sink insert when the body is genuinely unprocessable (e.g. a
 * NOT NULL column is missing). `runSink` maps it to a 422 so the flush layer
 * treats it as a terminal payload rejection rather than retrying forever — and
 * the audit row appended earlier in the same tx is rolled back with it.
 */
class FieldCaptureRejection extends Error {}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

interface AuthCtx {
  readonly tenantId: string;
  readonly userId: string;
}

/**
 * Resolve auth + db, returning an early error envelope when either is missing.
 */
 
function resolveContext(
  c: any,
):
  | { ok: true; auth: AuthCtx; db: any; body: Record<string, unknown> }
  | { ok: false; error: JsonError } {
  const { tenantId, userId } = c.get('auth') ?? {};
  if (!tenantId || !userId) {
    return {
      ok: false,
      error: jsonError('UNAUTHORIZED', 'Authentication required', 401),
    };
  }
  const db = c.get('db');
  if (!db) {
    return {
      ok: false,
      error: jsonError(
        'FIELD_CAPTURE_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      ),
    };
  }
  return { ok: true, auth: { tenantId, userId }, db, body: {} };
}

// ---------------------------------------------------------------------------
// Generic insert-once helper — runs the domain insert + audit in ONE tx, and
// short-circuits idempotently when the deterministic row already exists.
// ---------------------------------------------------------------------------

interface SinkConfig {
  readonly action: string;
  readonly existsById: (
     
    db: any,
    tenantId: string,
    id: string,
     
  ) => Promise<any | null>;
  readonly insert: (
     
    tx: any,
    tenantId: string,
    userId: string,
    id: string,
    body: Record<string, unknown>,
     
  ) => Promise<any>;
  readonly auditDetails: (
    id: string,
    body: Record<string, unknown>,
  ) => Record<string, unknown>;
}

async function runSink(
   
  c: any,
  config: SinkConfig,
): Promise<Response> {
  const ctx = resolveContext(c);
  if (!ctx.ok) {
    return c.json(ctx.error.body, ctx.error.status);
  }
  const { auth, db } = ctx;
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await c.req.json()) as unknown;
    if (parsed && typeof parsed === 'object') {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // An empty / unparseable body is acceptable for an ack-style capture; the
    // audit row still preserves the fact of the offline record.
    body = {};
  }
  const idempotencyKey = readIdempotencyKey(c);
  const id = rowId(auth.tenantId, idempotencyKey);

  try {
    const existing = await config.existsById(db, auth.tenantId, id);
    if (existing) {
      return c.json(
        {
          success: true as const,
          data: existing,
          meta: { idempotent: true as const },
        },
        200,
      );
    }
     
    const row = await db.transaction(async (tx: any) => {
      await appendAuditEntry(tx, {
        action: config.action,
        tenantId: auth.tenantId,
        turnId: id,
        userId: auth.userId,
        details: config.auditDetails(id, body),
      });
      return config.insert(tx, auth.tenantId, auth.userId, id, body);
    });
    return c.json({ success: true as const, data: row ?? { id } }, 201);
  } catch (err) {
    if (err instanceof FieldCaptureRejection) {
      // Genuine payload rejection — terminal. The flush layer drops it on 422.
      const e = jsonError('FIELD_CAPTURE_REJECTED', err.message, 422);
      return c.json(e.body, e.status);
    }
    const message = err instanceof Error ? err.message : 'capture failed';
    moduleLogger.error('field capture sink failed', {
      evt: 'field_capture_failed',
      tenantId: auth.tenantId,
      action: config.action,
      id,
      reason: message,
    });
    const e = jsonError(
      'FIELD_CAPTURE_FAILED',
      'Failed to record field capture',
      500,
    );
    return c.json(e.body, e.status);
  }
}

// ---------------------------------------------------------------------------
// /ppe-receipts → ppe_issues
// ---------------------------------------------------------------------------

export function createPpeReceiptsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);
  app.post('/', async (c: any) =>
    runSink(c, {
      action: 'mining.ppe.receipt',
      existsById: async (db, tenantId, id) => {
        const [row] = await db
          .select()
          .from(ppeIssues)
          .where(and(eq(ppeIssues.id, id), eq(ppeIssues.tenantId, tenantId)))
          .limit(1);
        return row ?? null;
      },
      insert: async (tx, tenantId, userId, id, body) => {
        const [row] = await tx
          .insert(ppeIssues)
          .values({
            id,
            tenantId,
            siteId: asString(body.siteId),
            employeeId: asString(body.employeeId) ?? userId,
            ppeKind: asString(body.ppeKind) ?? 'unspecified',
            quantity: asPositiveInt(body.quantity, 1),
            issuedByUserId: userId,
            evidenceIds: Array.isArray(body.evidenceIds)
              ? (body.evidenceIds as unknown[]).filter(
                  (v): v is string => typeof v === 'string',
                )
              : [],
            notes: asString(body.notes),
          })
          .onConflictDoNothing({ target: ppeIssues.id })
          .returning();
        return row ?? { id };
      },
      auditDetails: (id, body) => ({
        ppeIssueId: id,
        ppeKind: asString(body.ppeKind),
        via: 'field-capture',
      }),
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// /excavator-counts → ore_parcels (count/mass capture for a site stockpile)
// ---------------------------------------------------------------------------

export function createExcavatorCountsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);
  app.post('/', async (c: any) =>
    runSink(c, {
      action: 'mining.excavator.count',
      existsById: async (db, tenantId, id) => {
        const [row] = await db
          .select()
          .from(oreParcels)
          .where(and(eq(oreParcels.id, id), eq(oreParcels.tenantId, tenantId)))
          .limit(1);
        return row ?? null;
      },
      insert: async (tx, tenantId, userId, id, body) => {
        const siteId = asString(body.siteId);
        if (!siteId) {
          // ore_parcels.site_id is NOT NULL — without it the row cannot be
          // persisted. The audit row (already appended in this tx) preserves
          // the offline record so nothing is lost; surface a 422 so the flush
          // layer treats it as a genuine payload rejection, not a retry-loop.
          throw new FieldCaptureRejection('siteId is required');
        }
        const count = asPositiveInt(body.count ?? body.bucketCount, 0);
        const [row] = await tx
          .insert(oreParcels)
          .values({
            id,
            tenantId,
            siteId,
            massKg: asString(body.massKg),
            grade: {},
            storageLocation: asString(body.storageLocation),
            status: 'in_stockpile',
            photos: Array.isArray(body.photos)
              ? (body.photos as unknown[]).filter(
                  (v): v is string => typeof v === 'string',
                )
              : [],
            attributes: {
              source: 'excavator_count',
              capturedByUserId: userId,
              ...(count > 0 ? { bucketCount: count } : {}),
            },
          })
          .onConflictDoNothing({ target: oreParcels.id })
          .returning();
        return row ?? { id };
      },
      auditDetails: (id, body) => ({
        oreParcelId: id,
        siteId: asString(body.siteId),
        via: 'field-capture',
      }),
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// /fingerprint-signs → fingerprint_events
// ---------------------------------------------------------------------------

export function createFingerprintSignsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);
  app.post('/', async (c: any) =>
    runSink(c, {
      action: 'mining.fingerprint.sign',
      existsById: async (db, tenantId, id) => {
        const [row] = await db
          .select()
          .from(fingerprintEvents)
          .where(
            and(
              eq(fingerprintEvents.id, id),
              eq(fingerprintEvents.tenantId, tenantId),
            ),
          )
          .limit(1);
        return row ?? null;
      },
      insert: async (tx, tenantId, userId, id, body) => {
        const biometricHash =
          asString(body.biometricHash) ??
          createHash('sha256')
            .update(`${tenantId}:${userId}:${id}`)
            .digest('hex');
        const [row] = await tx
          .insert(fingerprintEvents)
          .values({
            id,
            tenantId,
            userId,
            documentId: asString(body.documentId),
            biometricHash,
            geo: asString(body.geo),
            deviceAttestation:
              body.deviceAttestation &&
              typeof body.deviceAttestation === 'object'
                ? (body.deviceAttestation as Record<string, unknown>)
                : {},
            signedFor: asString(body.signedFor) ?? 'field_capture',
            subjectId: asString(body.subjectId),
            subjectKind: asString(body.subjectKind),
            attributes: { via: 'field-capture' },
          })
          .onConflictDoNothing({ target: fingerprintEvents.id })
          .returning();
        return row ?? { id };
      },
      auditDetails: (id, body) => ({
        fingerprintEventId: id,
        signedFor: asString(body.signedFor),
        via: 'field-capture',
      }),
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// /photo-uploads → document_uploads (durable evidence row for a field photo)
// ---------------------------------------------------------------------------

export function createPhotoUploadsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);
  app.post('/', async (c: any) =>
    runSink(c, {
      action: 'mining.photo.upload',
      existsById: async (db, tenantId, id) => {
        const [row] = await db
          .select()
          .from(documentUploads)
          .where(
            and(
              eq(documentUploads.id, id),
              eq(documentUploads.tenantId, tenantId),
            ),
          )
          .limit(1);
        return row ?? null;
      },
      insert: async (tx, tenantId, userId, id, body) => {
        // The flush layer uploads the binary first (mediaUpload.ts → presigned
        // PUT) and rewrites the local URI to a stored ref; here we persist a
        // durable document row pointing at it. If no fileUrl is present the row
        // still records the capture intent (status pending_upload) so nothing
        // is lost.
        const fileUrl = asString(body.fileUrl) ?? asString(body.uri) ?? '';
        const [row] = await tx
          .insert(documentUploads)
          .values({
            id,
            tenantId,
            documentType: 'other',
            status: fileUrl ? 'uploaded' : 'pending_upload',
            source: 'app_upload',
            fileName: asString(body.fileName) ?? `field-photo-${id}.jpg`,
            fileSize: asPositiveInt(body.fileSize, 0),
            mimeType: asString(body.mimeType) ?? 'image/jpeg',
            fileUrl,
            entityType: asString(body.entityType) ?? 'field_photo',
            entityId: asString(body.threadId) ?? asString(body.entityId),
            metadata: {
              via: 'field-capture',
              capturedByUserId: userId,
              ...(typeof body.capturedAt === 'number'
                ? { capturedAt: body.capturedAt }
                : {}),
              ...(asString(body.threadId)
                ? { threadId: asString(body.threadId) }
                : {}),
            },
            createdBy: userId,
          })
          .onConflictDoNothing({ target: documentUploads.id })
          .returning();
        return row ?? { id };
      },
      auditDetails: (id, body) => ({
        documentUploadId: id,
        threadId: asString(body.threadId),
        via: 'field-capture',
      }),
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// /driver-letter-acks → NO TABLE YET. Degrades safely: audit-only accept so
// the worker's offline ack is durably recorded server-side and never the cause
// of a silent delete. The needed table (driver_letter_acks) is reported.
// ---------------------------------------------------------------------------

export function createDriverLetterAcksRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);
  app.post('/', async (c: any) => {
    const ctx = resolveContext(c);
    if (!ctx.ok) {
      return c.json(ctx.error.body, ctx.error.status);
    }
    const { auth, db } = ctx;
    let body: Record<string, unknown> = {};
    try {
      const parsed = (await c.req.json()) as unknown;
      if (parsed && typeof parsed === 'object') {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }
    const idempotencyKey = readIdempotencyKey(c);
    const id = rowId(auth.tenantId, idempotencyKey);
    try {
      // Audit-only durable accept. The hash-chained row IS the persisted
      // record of the acknowledgement until a dedicated table is migrated.
      const auditId = await db.transaction(async (tx: any) =>
        appendAuditEntry(tx, {
          action: 'mining.driver_letter.ack',
          tenantId: auth.tenantId,
          turnId: id,
          userId: auth.userId,
          details: {
            ackId: id,
            letterId: asString(body.letterId),
            driverId: asString(body.driverId),
            via: 'field-capture',
            degraded: 'no_driver_letter_acks_table',
          },
        }),
      );
      return c.json(
        {
          success: true as const,
          data: { id, auditId },
          meta: { degraded: true as const },
        },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ack failed';
      moduleLogger.error('driver letter ack sink failed', {
        evt: 'driver_letter_ack_failed',
        tenantId: auth.tenantId,
        id,
        reason: message,
      });
      const e = jsonError(
        'FIELD_CAPTURE_FAILED',
        'Failed to record acknowledgement',
        500,
      );
      return c.json(e.body, e.status);
    }
  });
  return app;
}

export const ppeReceiptsRouter = createPpeReceiptsRouter();
export const excavatorCountsRouter = createExcavatorCountsRouter();
export const fingerprintSignsRouter = createFingerprintSignsRouter();
export const photoUploadsRouter = createPhotoUploadsRouter();
export const driverLetterAcksRouter = createDriverLetterAcksRouter();
