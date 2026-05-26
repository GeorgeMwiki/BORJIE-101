/**
 * Session replay router — Central Command Phase B (B5 — Session Replay
 * + Counter-Model Safety).
 *
 * Receives chunked rrweb event uploads from the client recorder
 * (`apps/admin-web/src/lib/session-replay`) and offers
 * cold-store reads to the admin replay viewer.
 *
 *   POST   /api/v1/session-replay/chunks
 *           Body: { sessionId, sequenceNumber, eventsGzipBase64,
 *                   eventCount, capturedAt }
 *           Any logged-in user may post (operators may replay their
 *           own sessions; admins may replay anyone's).
 *
 *   GET    /api/v1/session-replay/sessions/:sessionId/chunks
 *           Admin-gated. Lists chunk metadata (sequence + storage URI
 *           + sizes) ordered oldest-first.
 *
 *   GET    /api/v1/session-replay/sessions/:sessionId/chunks/:chunkId
 *           Admin-gated. Returns the gzipped event bytes as
 *           `application/json` with `Content-Encoding: gzip`.
 *
 *   GET    /api/v1/session-replay/sessions
 *           Admin-gated. Recent-session summary for the landing page.
 *
 * Hard guardrails:
 *   - Max chunk size 5MB (gzip), enforced on the base64 length.
 *   - Tenant scope inherited from the JWT — body tenant claims ignored.
 *   - Dedup on (sessionId, sequenceNumber) — retries are idempotent and
 *     return 200 with `{ duplicate: true }`.
 *   - Degraded mode: missing `db` OR missing `sessionReplayStorage` in
 *     the services bag → 503 `SESSION_REPLAY_UNAVAILABLE`. The chat
 *     surface must never block on the replay pipeline.
 *
 * The PII masking lives at the client; this router does NOT inspect or
 * re-mask the gzip payload — it stores bytes opaquely.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { trace, type Attributes } from '@opentelemetry/api';
import {
  createSessionReplayChunksService,
  type SessionReplayChunksService,
} from '@borjie/database';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import type { SessionReplayStoragePort } from '../storage/session-replay-storage';
import { e400, e401, e404, e429, e500, e503, errorResponse } from '../utils/error-response';

import { withSecurityEvents } from '@borjie/observability';
// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

const MAX_GZIP_BYTES = 5 * 1024 * 1024;
const MAX_BATCHES_PER_WINDOW = 200;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const PostChunkBodySchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    surface: z.string().min(1).max(64).optional(),
    sequenceNumber: z.number().int().min(0).max(1_000_000),
    eventCount: z.number().int().min(0).max(100_000),
    capturedAt: z.string().min(1).max(64),
    /** Gzip-compressed rrweb event payload, base64-encoded. PII masking
     *  is the client's job — the server stores bytes opaquely. */
    eventsGzipBase64: z.string().min(1).max(Math.ceil(MAX_GZIP_BYTES * 1.4)),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────
// Rate limiter (process-local, mirrors sensorium router pattern)
// ─────────────────────────────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function rateLimitKey(tenantId: string, sessionId: string): string {
  return `srpl::${tenantId}::${sessionId}`;
}

function checkRateLimit(
  tenantId: string,
  sessionId: string,
  now: number,
): { allowed: boolean; retryAfterSec?: number } {
  const key = rateLimitKey(tenantId, sessionId);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (bucket.count >= MAX_BATCHES_PER_WINDOW) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }
  bucket.count += 1;
  return { allowed: true };
}

/** Test-only — reset the in-memory limiter between runs. */
export function __resetSessionReplayRateLimiter(): void {
  rateBuckets.clear();
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function getDbOrNull(c: any): unknown | null {
  const services = c.get('services') ?? {};
  return services.db ?? null;
}

function getStorageOrNull(c: any): SessionReplayStoragePort | null {
  const services = c.get('services') ?? {};
  return (services.sessionReplayStorage as SessionReplayStoragePort) ?? null;
}

function getServiceOrNull(c: any): SessionReplayChunksService | null {
  const services = c.get('services') ?? {};
  return (
    (services.sessionReplayChunks as SessionReplayChunksService) ?? null
  );
}

function unavailable(c: any) {
  return e503(
    c,
    'SESSION_REPLAY_UNAVAILABLE',
    'Session replay requires a live database and cold-storage backend.',
  );
}

function recordSpan(name: string, attrs: Attributes): void {
  try {
    const tracer = trace.getTracer('borjie.api-gateway.session-replay');
    const span = tracer.startSpan(name, { attributes: attrs });
    span.end();
  } catch {
    // OTel absence never breaks the replay pipeline.
  }
}

function decodeBase64(input: string): Uint8Array | null {
  try {
    const buf = Buffer.from(input, 'base64');
    if (buf.byteLength === 0) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function buildService(
  c: any,
  db: unknown,
): SessionReplayChunksService {
  const existing = getServiceOrNull(c);
  if (existing) return existing;
  return createSessionReplayChunksService(db as never);
}

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

const app = new Hono();
app.use('*', authMiddleware);

// POST /chunks — accept a single chunk upload. Any logged-in user.
app.post(
  '/chunks',
  zValidator('json', PostChunkBodySchema),
  withSecurityEvents({ action: 'session-replay.create', resource: 'session-replay', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId: string; userId: string }
      | undefined;
    if (!auth?.tenantId || !auth?.userId) {
      return e401(c, 'UNAUTHORIZED', 'auth context missing');
    }
    const body = c.req.valid('json') as z.infer<typeof PostChunkBodySchema>;
    const surface = body.surface ?? 'admin-web';

    const now = Date.now();
    const limit = checkRateLimit(auth.tenantId, body.sessionId, now);
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSec ?? 60));
      return e429(
        c,
        'SESSION_REPLAY_RATE_LIMITED',
        `Rate limit exceeded: ${MAX_BATCHES_PER_WINDOW} chunks per ${RATE_LIMIT_WINDOW_MS / 60_000} minutes.`,
      );
    }

    const db = getDbOrNull(c);
    const storage = getStorageOrNull(c);
    if (!db || !storage) return unavailable(c);

    const gzipBytes = decodeBase64(body.eventsGzipBase64);
    if (!gzipBytes) {
      return e400(
        c,
        'SESSION_REPLAY_INVALID_PAYLOAD',
        'eventsGzipBase64 is not valid base64.',
      );
    }
    if (gzipBytes.byteLength > MAX_GZIP_BYTES) {
      return errorResponse(
        c,
        413,
        'SESSION_REPLAY_PAYLOAD_TOO_LARGE',
        `Chunk exceeds the ${MAX_GZIP_BYTES} byte limit.`,
      );
    }

    // Upload to cold storage FIRST — if that fails, we never write
    // metadata. The metadata pointer being present without the bytes
    // is a strictly worse state than no row at all.
    const chunkId = generateChunkId();
    let storageUri: string;
    try {
      const result = await storage.upload({ chunkId, gzipBytes });
      storageUri = result.storageUri;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      recordSpan('session-replay.upload', {
        'session-replay.error': message,
        'session-replay.stage': 'storage',
      } as Attributes);
      return e500(c, 'SESSION_REPLAY_STORAGE_FAILED', message);
    }

    const svc = buildService(c, db);
    const append = await svc.appendChunk({
      tenantId: auth.tenantId,
      userId: auth.userId,
      sessionId: body.sessionId,
      surface,
      sequenceNumber: body.sequenceNumber,
      eventCount: body.eventCount,
      byteSize: gzipBytes.byteLength,
      storageUri,
      capturedAt: body.capturedAt,
    });

    recordSpan('session-replay.upload', {
      'session-replay.tenant_id': auth.tenantId,
      'session-replay.session_id': body.sessionId,
      'session-replay.sequence': body.sequenceNumber,
      'session-replay.bytes': gzipBytes.byteLength,
      'session-replay.outcome': append.reason,
    } as Attributes);

    if (append.reason === 'duplicate') {
      return c.json({
        success: true,
        data: {
          duplicate: true,
          chunkId: null,
          sequenceNumber: body.sequenceNumber,
        },
      });
    }
    if (!append.ok) {
      const code =
        append.reason === 'invalid'
          ? 'SESSION_REPLAY_INVALID'
          : 'SESSION_REPLAY_DB_FAILED';
      const msg = `appendChunk failed: ${append.reason}`;
      return append.reason === 'invalid' ? e400(c, code, msg) : e500(c, code, msg);
    }
    return c.json({
      success: true,
      data: {
        chunkId: append.chunkId,
        sequenceNumber: body.sequenceNumber,
        byteSize: gzipBytes.byteLength,
      },
    });
  }),
);

// GET /sessions/:sessionId/chunks — list metadata for the replay viewer.
app.get(
  '/sessions/:sessionId/chunks',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId: string; userId: string }
      | undefined;
    if (!auth?.tenantId) {
      return e401(c, 'UNAUTHORIZED', 'auth context missing');
    }
    const sessionId = c.req.param('sessionId');
    if (!sessionId) {
      return e400(c, 'INVALID_INPUT', 'sessionId is required');
    }
    const db = getDbOrNull(c);
    if (!db) return unavailable(c);
    const svc = buildService(c, db);
    const rows = await svc.listForSession({
      tenantId: auth.tenantId,
      sessionId,
    });
    return c.json({
      success: true,
      data: {
        sessionId,
        chunks: rows,
      },
    });
  },
);

// GET /sessions — recent session summary for the landing page.
app.get(
  '/sessions',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId: string; userId: string }
      | undefined;
    if (!auth?.tenantId) {
      return e401(c, 'UNAUTHORIZED', 'auth context missing');
    }
    const db = getDbOrNull(c);
    if (!db) return unavailable(c);
    const windowMinutes = Number(c.req.query('windowMinutes') ?? '1440') || 1440;
    const svc = buildService(c, db);
    const sessions = await svc.listRecentSessions({
      tenantId: auth.tenantId,
      windowMinutes,
    });
    return c.json({
      success: true,
      data: { sessions, windowMinutes },
    });
  },
);

// GET /sessions/:sessionId/chunks/:chunkId — return the gzipped bytes.
app.get(
  '/sessions/:sessionId/chunks/:chunkId',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId: string; userId: string }
      | undefined;
    if (!auth?.tenantId) {
      return e401(c, 'UNAUTHORIZED', 'auth context missing');
    }
    const sessionId = c.req.param('sessionId');
    const chunkId = c.req.param('chunkId');
    if (!sessionId || !chunkId) {
      return e400(c, 'INVALID_INPUT', 'sessionId and chunkId are required');
    }
    const db = getDbOrNull(c);
    const storage = getStorageOrNull(c);
    if (!db || !storage) return unavailable(c);
    const svc = buildService(c, db);
    const rows = await svc.listForSession({
      tenantId: auth.tenantId,
      sessionId,
    });
    const row = rows.find((r) => r.id === chunkId);
    if (!row) {
      return e404(c, 'NOT_FOUND', 'chunk not found');
    }
    try {
      const bytes = await storage.download(row.storageUri);
      // Cast through Uint8Array to a Response-compatible body. Hono's
      // signature accepts ArrayBuffer / Uint8Array directly.
      c.header('Content-Type', 'application/json');
      c.header('Content-Encoding', 'gzip');
      c.header('Cache-Control', 'private, max-age=0, no-store');
      return c.body(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      return e500(c, 'SESSION_REPLAY_STORAGE_DOWNLOAD_FAILED', message);
    }
  },
);

function generateChunkId(): string {
  // Crypto.randomUUID is available on Node 18+. The 36-char dashed form
  // is well within the storage adapter's `isSafeChunkId` regex.
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `srpl_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export const sessionReplayRouter = app;
export default app;
