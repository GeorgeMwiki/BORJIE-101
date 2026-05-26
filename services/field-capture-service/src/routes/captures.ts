/**
 * Field capture routes.
 *
 *   POST /v1/field/capture/photo       (JSON body — base64 OR storageUri + location)
 *   POST /v1/field/capture/video       (JSON body)
 *   POST /v1/field/capture/audio       (JSON body)
 *   POST /v1/field/capture/inspection  (JSON checklist response)
 *   POST /v1/field/capture/sync        (bulk array)
 *   GET  /v1/field/queue/:surveyorId   (captures still pending)
 *   POST /v1/field/parcels/:id/polygon (submit a captured polygon)
 *
 * Wrapped in `withSecurityEventsFastify`. Idempotency-Key required for
 * POSTs (header is validated; routes are functionally idempotent
 * keyed by it).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  recordSecurityEvent,
  withSecurityEventsFastify,
} from '@borjie/observability';
import {
  createCapturePipeline,
  defaultAiInference,
  type CaptureStore,
  type FieldCaptureInput,
} from '@borjie/geo-intelligence';
import {
  type StorageAdapter,
  tenantScopedPath,
} from '@borjie/storage-adapter';
import { requireUser } from '../middleware/auth.js';

const CapturePayloadSchema = z.object({
  kind: z.enum(['photo', 'video', 'audio', 'inspection', 'polygon', 'sensor', 'drone', 'pano']),
  parcelId: z.string().optional(),
  capturedAt: z.string().datetime().optional(),
  capturedLocation: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    ts: z.string().optional(),
    deviceModel: z.string().optional(),
    altitudeM: z.number().optional(),
  }).optional(),
  storageUri: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  // base64 payload for inline uploads (small only). Production prefers
  // a pre-signed S3 PUT + storageUri.
  bytesBase64: z.string().optional(),
});

// NOTE: `tenantId` is intentionally NOT in any of these schemas — it is
// derived from the authenticated JWT (see `requireUser`). A separate
// `bodyTenantId` field is accepted for backwards compatibility with
// older mobile-app builds; if it disagrees with the session tenant we
// emit a security event and use the session value (never the body).
// See P40 follow-up for the write-to-wrong-tenant risk this closes.
const SyncBodySchema = z.object({
  surveyorUserId: z.string().min(1),
  /** Deprecated — ignored. Kept optional so older clients keep parsing. */
  tenantId: z.string().min(1).optional(),
  captures: z.array(CapturePayloadSchema).min(1).max(200),
});

const SingleSubmitBodySchema = CapturePayloadSchema.extend({
  surveyorUserId: z.string().min(1),
  /** Deprecated — ignored. Kept optional so older clients keep parsing. */
  tenantId: z.string().min(1).optional(),
});

const PolygonSubmitBodySchema = z.object({
  surveyorUserId: z.string().min(1),
  /** Deprecated — ignored. Kept optional so older clients keep parsing. */
  tenantId: z.string().min(1).optional(),
  capturedAt: z.string().datetime().optional(),
  geometry: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(
      z.array(z.tuple([z.number(), z.number()])),
    ).min(1),
  }),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Resolve the effective tenantId for a request, comparing the
 * session-bound value against any body-supplied value. Always returns
 * the session value; emits a security event on mismatch so SREs can
 * detect tampering attempts or stale clients.
 */
function resolveTenantId(
  request: FastifyRequest,
  bodyTenantId: string | undefined,
  action: string,
): string {
  const sessionTenantId = requireUser(request).tenantId;
  if (bodyTenantId && bodyTenantId !== sessionTenantId) {
    // Fire-and-forget — recordSecurityEvent swallows its own errors so
    // a failing sink can never block the request.
    void recordSecurityEvent({
      action: `${action}.tenant_mismatch`,
      resource: 'capture',
      severity: 'warn',
      method: request.method,
      route: request.url,
      tenantId: sessionTenantId,
      actorId: requireUser(request).userId,
      detail: {
        sessionTenantId,
        bodyTenantId,
        note: 'body tenantId ignored — session value used',
      },
    });
  }
  return sessionTenantId;
}

function decodeBase64ToBytes(b64?: string): Uint8Array | undefined {
  if (!b64) return undefined;
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function requireIdempotencyKey(headers: Record<string, unknown> | undefined): string | null {
  const key = headers?.['idempotency-key'] ?? headers?.['Idempotency-Key'];
  if (typeof key !== 'string' || key.length < 8) return null;
  return key;
}

function toCaptureInput(payload: z.infer<typeof CapturePayloadSchema>): FieldCaptureInput {
  const bytes = decodeBase64ToBytes(payload.bytesBase64);
  return {
    kind: payload.kind,
    ...(payload.parcelId !== undefined ? { parcelId: payload.parcelId } : {}),
    ...(payload.capturedAt !== undefined ? { capturedAt: payload.capturedAt } : {}),
    ...(payload.capturedLocation !== undefined ? { capturedLocation: payload.capturedLocation } : {}),
    ...(payload.storageUri !== undefined ? { storageUri: payload.storageUri } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(payload.metadata !== undefined ? { metadata: payload.metadata } : {}),
  };
}

export interface CaptureRoutesDeps {
  readonly store: CaptureStore;
  /**
   * Optional shared storage port (`@borjie/storage-adapter`). When
   * provided, the route persists any submitted inline bytes through
   * the adapter using `tenantScopedPath(tenantId, captureId)` and
   * rewrites the capture's `storageUri` to the returned URI. This
   * closes the wiring-gaps audit chain-6 hole — before this change,
   * base64 bytes received here were hashed for C2PA only and never
   * written to the canonical bucket, so production had no consistent
   * tenant-scoped backend for inline-uploaded media.
   *
   * SECURITY: the path scoping uses the tenantId the route resolves
   * via `resolveTenantId` (session value wins; body mismatches emit a
   * security warn event but do not overwrite it). The adapter
   * guarantees the file physically lands inside that tenant's prefix,
   * so a Supabase RLS policy keyed on
   * `(storage.foldername(name))[1] = current_setting('app.current_tenant_id')`
   * will deny cross-tenant reads.
   */
  readonly storageAdapter?: StorageAdapter;
  /** Override the default kind→bucket mapping if the deployment uses bespoke names. */
  readonly kindToBucket?: (kind: string) => string;
}

const DEFAULT_KIND_BUCKETS: Record<string, string> = {
  photo: 'media-photos',
  video: 'media-videos',
  audio: 'media-audio',
  inspection: 'tenant-uploads',
  polygon: 'tenant-uploads',
  sensor: 'tenant-uploads',
  drone: 'media-videos',
  pano: 'media-photos',
};

function pickBucket(
  kind: string,
  override?: (k: string) => string,
): string {
  if (override) {
    try {
      const out = override(kind);
      if (out && typeof out === 'string') return out;
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_KIND_BUCKETS[kind] ?? 'tenant-uploads';
}

function pickContentType(kind: string): string {
  switch (kind) {
    case 'photo':
    case 'pano':
      return 'image/jpeg';
    case 'video':
    case 'drone':
      return 'video/mp4';
    case 'audio':
      return 'audio/mp4';
    default:
      return 'application/octet-stream';
  }
}

/**
 * If the payload carries inline bytes (base64) AND a StorageAdapter is
 * wired, push the bytes to `<bucket>/<tenantId>/<captureId>` and return
 * the payload with a freshly-assigned `storageUri`. Otherwise return
 * the payload unchanged. Errors from the adapter propagate.
 */
async function persistBytesIfNeeded(args: {
  payload: z.infer<typeof CapturePayloadSchema>;
  tenantId: string;
  storageAdapter?: StorageAdapter;
  kindToBucket?: (kind: string) => string;
}): Promise<z.infer<typeof CapturePayloadSchema>> {
  if (!args.storageAdapter) return args.payload;
  if (!args.payload.bytesBase64) return args.payload;

  const bytes = new Uint8Array(
    Buffer.from(args.payload.bytesBase64, 'base64'),
  );
  const captureId = randomUUID();
  const bucket = pickBucket(args.payload.kind, args.kindToBucket);
  const path = tenantScopedPath(args.tenantId, captureId);
  const contentType = pickContentType(args.payload.kind);

  await args.storageAdapter.upload(bucket, path, bytes, contentType);

  // Rewrite the payload: strip the inline bytes (they're now in object
  // storage) and set a `storageUri` so the capture record persists a
  // pointer rather than re-uploading the blob downstream.
  const next: z.infer<typeof CapturePayloadSchema> = {
    ...args.payload,
    storageUri: `storage://${bucket}/${path}`,
  };
  delete (next as { bytesBase64?: string }).bytesBase64;
  return next;
}

export async function registerCaptureRoutes(
  app: FastifyInstance,
  deps: CaptureRoutesDeps,
): Promise<void> {
  const pipeline = createCapturePipeline({
    store: deps.store,
    aiInference: defaultAiInference(),
  });

  // ------------------------------------------------------------------
  // Single-kind submit endpoints (photo / video / audio / inspection)
  // ------------------------------------------------------------------
  const singleHandler = (forceKind: 'photo' | 'video' | 'audio' | 'inspection') =>
    async (
      request: FastifyRequest,
      reply: { code: (n: number) => unknown; send: (b: unknown) => unknown },
    ) => {
      const idemKey = requireIdempotencyKey(request.headers ?? {});
      if (!idemKey) {
        reply.code(400);
        return { error: 'idempotency-key header required (>= 8 chars)' };
      }
      const parsed = SingleSubmitBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid request body', details: parsed.error.flatten() };
      }
      const { surveyorUserId, tenantId: bodyTenantId, ...payload } = parsed.data;
      const tenantId = resolveTenantId(
        request,
        bodyTenantId,
        `field.capture.${forceKind}`,
      );
      // Force the kind to match the route.
      const forcedPayload = { ...payload, kind: forceKind } as z.infer<typeof CapturePayloadSchema>;
      // Persist inline bytes through the shared StorageAdapter so the
      // blob lands at `<bucket>/<tenantId>/<captureId>` — see
      // CaptureRoutesDeps.storageAdapter for the wiring rationale.
      let persistedPayload: z.infer<typeof CapturePayloadSchema>;
      try {
        persistedPayload = await persistBytesIfNeeded({
          payload: forcedPayload,
          tenantId,
          storageAdapter: deps.storageAdapter,
          kindToBucket: deps.kindToBucket,
        });
      } catch (err) {
        reply.code(502);
        return {
          error: 'storage upload failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }
      const result = await pipeline.submitFieldCapture({
        surveyorUserId,
        tenantId,
        captures: [toCaptureInput(persistedPayload)],
      });
      reply.code(201);
      return { idempotencyKey: idemKey, captures: result };
    };

  app.post('/v1/field/capture/photo', withSecurityEventsFastify(
    { action: 'field.capture.photo', resource: 'capture', severity: 'info' },
    singleHandler('photo'),
  ));

  app.post('/v1/field/capture/video', withSecurityEventsFastify(
    { action: 'field.capture.video', resource: 'capture', severity: 'info' },
    singleHandler('video'),
  ));

  app.post('/v1/field/capture/audio', withSecurityEventsFastify(
    { action: 'field.capture.audio', resource: 'capture', severity: 'info' },
    singleHandler('audio'),
  ));

  app.post('/v1/field/capture/inspection', withSecurityEventsFastify(
    { action: 'field.capture.inspection', resource: 'capture', severity: 'info' },
    singleHandler('inspection'),
  ));

  // ------------------------------------------------------------------
  // Bulk sync
  // ------------------------------------------------------------------
  app.post('/v1/field/capture/sync', withSecurityEventsFastify(
    { action: 'field.capture.sync', resource: 'capture', severity: 'info' },
    async (request: FastifyRequest, reply) => {
      const idemKey = requireIdempotencyKey((request.headers ?? {}) as Record<string, unknown>);
      if (!idemKey) {
        reply.code(400);
        return { error: 'idempotency-key header required (>= 8 chars)' };
      }
      const parsed = SyncBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid sync body', details: parsed.error.flatten() };
      }
      const { surveyorUserId, tenantId: bodyTenantId, captures } = parsed.data;
      const tenantId = resolveTenantId(
        request,
        bodyTenantId,
        'field.capture.sync',
      );
      // Persist any inline bytes through the shared StorageAdapter,
      // one capture at a time so we keep the per-capture captureId
      // distinct in the bucket. Errors fail the whole batch — the
      // mobile client should retry the same Idempotency-Key.
      let persistedCaptures: ReadonlyArray<z.infer<typeof CapturePayloadSchema>>;
      try {
        persistedCaptures = await Promise.all(
          captures.map((c) =>
            persistBytesIfNeeded({
              payload: c,
              tenantId,
              storageAdapter: deps.storageAdapter,
              kindToBucket: deps.kindToBucket,
            }),
          ),
        );
      } catch (err) {
        reply.code(502);
        return {
          error: 'storage upload failed',
          details: err instanceof Error ? err.message : String(err),
        };
      }
      const result = await pipeline.submitFieldCapture({
        surveyorUserId,
        tenantId,
        captures: persistedCaptures.map(toCaptureInput),
      });
      reply.code(202);
      return {
        idempotencyKey: idemKey,
        accepted: result.length,
        captures: result,
      };
    },
  ));

  // ------------------------------------------------------------------
  // Queue inspection (read)
  // ------------------------------------------------------------------
  app.get('/v1/field/queue/:surveyorId', async (request, reply) => {
    const { surveyorId } = request.params as { surveyorId: string };
    if (!surveyorId || typeof surveyorId !== 'string') {
      reply.code(400);
      return { error: 'invalid surveyorId' };
    }
    const queued = deps.store.listForSurveyor(surveyorId, 'queued');
    const processed = deps.store.listForSurveyor(surveyorId, 'processed');
    return { surveyorId, queued, processed };
  });

  // ------------------------------------------------------------------
  // Submit captured polygon for an existing parcel
  // ------------------------------------------------------------------
  app.post('/v1/field/parcels/:id/polygon', withSecurityEventsFastify(
    { action: 'field.parcel.polygon', resource: 'parcel', severity: 'info' },
    async (request: FastifyRequest, reply) => {
      const idemKey = requireIdempotencyKey((request.headers ?? {}) as Record<string, unknown>);
      if (!idemKey) {
        reply.code(400);
        return { error: 'idempotency-key header required (>= 8 chars)' };
      }
      const { id } = request.params as { id: string };
      const parsed = PolygonSubmitBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid polygon body', details: parsed.error.flatten() };
      }
      const {
        surveyorUserId,
        tenantId: bodyTenantId,
        geometry,
        capturedAt,
        metadata,
      } = parsed.data;
      const tenantId = resolveTenantId(
        request,
        bodyTenantId,
        'field.parcel.polygon',
      );
      const result = await pipeline.submitFieldCapture({
        surveyorUserId,
        tenantId,
        parcelId: id,
        captures: [{
          kind: 'polygon',
          parcelId: id,
          ...(capturedAt !== undefined ? { capturedAt } : {}),
          metadata: {
            geometry,
            ...(metadata ?? {}),
          },
        }],
      });
      reply.code(201);
      return { idempotencyKey: idemKey, parcelId: id, captures: result };
    },
  ));
}
