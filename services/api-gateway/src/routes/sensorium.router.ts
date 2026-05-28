/**
 * Sensorium router — Central Command Phase A (C4 Sensorium / Brain Skin).
 *
 * `POST /api/v1/sensorium/events` — receives batched sensory events
 * from the client-side sensory bus (apps/admin-web/src/lib/
 * sensorium). Body shape:
 *
 *   {
 *     "sessionId": string,
 *     "batch": SensoryEvent[]
 *   }
 *
 * Every logged-in user can post — the sensorium is universal across
 * surfaces. Per-batch and per-session rate limits keep a runaway tab
 * from flooding the gateway:
 *
 *   - Max 100 events per batch (over-limit batches truncated, surplus
 *     counted in `rejected`)
 *   - Max 100 batches per 10-minute window per (tenantId, sessionId)
 *
 * Tenant scope is derived from the JWT (`auth.tenantId`); the body's
 * tenant claim is IGNORED to defeat tenant-id spoofing. Every accepted
 * row inherits the auth tenantId + userId so cross-tenant injection
 * is structurally impossible.
 *
 * One OTel span per batch (`sensorium.ingest`) carrying inserted /
 * rejected counts so the brain-skin sensor coverage shows up in
 * Langfuse / Phoenix as a span-rate metric.
 *
 * Degraded mode: when `DATABASE_URL` is unset the registry's `db`
 * slot is null and the router returns `503 SENSORIUM_UNAVAILABLE`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { trace, type Attributes } from '@opentelemetry/api';
import {
  createSensoriumEventLogService,
  SENSORIUM_EVENT_TYPES,
} from '@borjie/database';
// @ts-ignore - internal service export
import type { SensoriumEventInput } from '@borjie/database/services';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

const MAX_EVENTS_PER_BATCH = 100;
const MAX_BATCHES_PER_WINDOW = 100;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const EventTypeEnum = z.enum(SENSORIUM_EVENT_TYPES);

const SensoryEventSchema = z
  .object({
    eventType: EventTypeEnum,
    route: z.string().min(1).max(512),
    emittedAt: z.string().min(1).max(64),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const PostBodySchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    surface: z.string().min(1).max(64).optional(),
    batch: z.array(SensoryEventSchema).min(0).max(MAX_EVENTS_PER_BATCH * 2),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────
// Rate limiter (process-local, in-memory)
//
// The sensorium is a side channel — over-limit batches drop, they do
// NOT crash the chat. A Redis-backed limiter is a follow-up; the
// in-memory variant is correct for single-replica gateways and ample
// for the "one admin per surface" reality of HQ today.
// ─────────────────────────────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function rateLimitKey(tenantId: string, sessionId: string): string {
  return `${tenantId}::${sessionId}`;
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
export function __resetSensoriumRateLimiter(): void {
  rateBuckets.clear();
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function getDbOrNull(c: any): unknown | null {
  const services = c.get('services') ?? {};
  return services.db ?? null;
}

function unavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SENSORIUM_UNAVAILABLE',
        message:
          'Sensorium event log requires a live database connection.',
      },
    },
    503,
  );
}

function recordSpan(name: string, attrs: Attributes): void {
  try {
    const tracer = trace.getTracer('borjie.api-gateway.sensorium');
    const span = tracer.startSpan(name, { attributes: attrs });
    span.end();
  } catch {
    // No tracer wired — sensorium ingest never fails on OTel absence.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

const app = new Hono();
app.use('*', authMiddleware);

app.post(
  '/events',
  zValidator('json', PostBodySchema),
  withSecurityEvents({ action: 'sensorium.create', resource: 'sensorium', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId: string; userId: string }
      | undefined;
    if (!auth?.tenantId || !auth?.userId) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'auth context missing' },
        },
        401,
      );
    }

    const body = c.req.valid('json') as z.infer<typeof PostBodySchema>;
    const surface = body.surface ?? 'admin-web';

    // Rate limit per (tenant, session).
    const now = Date.now();
    const limit = checkRateLimit(auth.tenantId, body.sessionId, now);
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfterSec ?? 60));
      return c.json(
        {
          success: false,
          error: {
            code: 'SENSORIUM_RATE_LIMITED',
            message: `Rate limit exceeded: ${MAX_BATCHES_PER_WINDOW} batches per ${RATE_LIMIT_WINDOW_MS / 60_000} minutes.`,
          },
        },
        429,
      );
    }

    const db = getDbOrNull(c);
    if (!db) return unavailable(c);

    // Cap batch size — surplus is rejected, not 4xx, because the
    // sensorium is a side channel.
    const overflow = Math.max(
      0,
      body.batch.length - MAX_EVENTS_PER_BATCH,
    );
    const capped = body.batch.slice(0, MAX_EVENTS_PER_BATCH);

    // Tenant-scope is enforced from the JWT, NOT the body — even if a
    // malicious client tried to write into another tenant the row
    // carries the auth-derived `tenantId`.
    const rows: SensoriumEventInput[] = capped.map((e) => ({
      tenantId: auth.tenantId,
      userId: auth.userId,
      sessionId: body.sessionId,
      surface,
      route: e.route,
      eventType: e.eventType,
      payload:
        e.payload && typeof e.payload === 'object'
          ? (e.payload as Record<string, unknown>)
          : {},
      emittedAt: e.emittedAt,
    }));

    try {
      const svc = createSensoriumEventLogService(db as never);
      const result = await svc.appendBatch(rows);
      const accepted = result.inserted;
      const rejected = result.rejected + overflow;

      recordSpan('sensorium.ingest', {
        'sensorium.batch.size': body.batch.length,
        'sensorium.accepted': accepted,
        'sensorium.rejected': rejected,
        'sensorium.surface': surface,
        'sensorium.tenant_id': auth.tenantId,
      } as Attributes);

      const reasons: string[] = [];
      if (overflow > 0) reasons.push(`batch-truncated:${overflow}`);
      if (result.rejected > 0)
        reasons.push(`invalid-rows:${result.rejected}`);

      return c.json({
        success: true,
        data: {
          accepted,
          rejected,
          ...(reasons.length > 0 ? { reasons } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      recordSpan('sensorium.ingest', {
        'sensorium.error': message,
        'sensorium.surface': surface,
      } as Attributes);
      return c.json(
        {
          success: false,
          error: {
            code: 'SENSORIUM_INGEST_FAILED',
            message,
          },
        },
        500,
      );
    }
  }),
);

export const sensoriumRouter = app;
export default app;
