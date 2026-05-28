/**
 * Inngest webhook router — Central Command Phase B B3.
 *
 * `POST /api/v1/inngest` is the endpoint Inngest's serve runtime
 * uses to dispatch function-trigger events to our process. The
 * Inngest cloud (or dev server) signs every request body with the
 * shared `INNGEST_SIGNING_KEY` so we can verify it came from
 * Inngest and not a malicious actor with the public URL.
 *
 * Why hand-roll instead of using `@inngest/middleware-hono`?
 *
 *   1. The middleware package is light enough that we can match
 *      its surface (signature header check + body dispatch) in
 *      one screen of code.
 *   2. The api-gateway already mounts every webhook the same way
 *      — terminating raw body + verifying HMAC. Diverging here
 *      would be a maintenance smell.
 *   3. We can degrade gracefully when the `inngest` package isn't
 *      installed (CI baseline) — the route still returns 503 with
 *      a clear reason instead of crashing the gateway boot.
 *
 * Operational contract:
 *
 *   - `POST /api/v1/inngest` with body { name, data, id }
 *     → 200 + dispatch ack when signature verifies
 *     → 401 when `X-Inngest-Signature` is missing or wrong
 *     → 400 when the body is not JSON or violates the event shape
 *     → 409 (Conflict) when an idempotent replay is detected
 *     → 503 when the runtime is not wired (composition root did
 *       not bind `inngestRuntime`)
 *
 * Idempotency: Inngest itself guarantees at-least-once delivery,
 * so we de-dupe by `event.id` (when provided) for a small in-memory
 * window. Long-lived idempotency lives in the checkpoint store
 * (per-step `success` rows are skipped on resume), so this layer
 * only needs to protect against bursts of the same event.
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { withSecurityEvents } from '@borjie/observability';
export interface InngestRuntime {
  /** Process an Inngest event. Returns the run result envelope or
   *  throws when the runtime is misconfigured. The runtime is
   *  bound by the composition root — when absent the route 503s. */
  handle(event: {
    readonly name: string;
    readonly data: Record<string, unknown>;
    readonly id?: string;
  }): Promise<{ readonly ok: true; readonly result?: unknown }>;
}

/**
 * Hono context-variable map extension — the composition root sets
 * `services.inngestRuntime` and we read it off `c.get('services')`.
 */
declare module 'hono' {
  interface ContextVariableMap {
    // Existing `services` already declared by service-context.middleware.ts.
  }
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Inngest signs the body with HMAC-SHA256 and surfaces the result
 * in `X-Inngest-Signature: t=<unix>&s=<hex>`. We verify by
 * recomputing `sha256(signingKey, t + body)`.
 *
 * The signing key is read from `INNGEST_SIGNING_KEY` at request
 * time so rotation does not require a process restart.
 */
export function verifyInngestSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  now: number = Date.now(),
): { readonly ok: boolean; readonly reason?: string } {
  const secret = process.env.INNGEST_SIGNING_KEY?.trim();
  if (!secret) return { ok: false, reason: 'missing-signing-key' };
  if (!signatureHeader) return { ok: false, reason: 'missing-signature' };
  const parts = Object.fromEntries(
    signatureHeader.split('&').map((p) => {
      const [k, v] = p.split('=');
      return [k ?? '', v ?? ''] as const;
    }),
  );
  const ts = parts.t;
  const sig = parts.s;
  if (!ts || !sig) return { ok: false, reason: 'malformed-signature' };
  const tsNum = Number(ts);
  // 5-minute replay window — matches Inngest's documented tolerance.
  if (!Number.isFinite(tsNum) || Math.abs(now / 1000 - tsNum) > 300) {
    return { ok: false, reason: 'stale-timestamp' };
  }
  const expected = createHmac('sha256', secret)
    .update(`${ts}${rawBody}`)
    .digest('hex');
  if (expected.length !== sig.length) return { ok: false, reason: 'bad-signature' };
  try {
    const eq = timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(sig, 'hex'),
    );
    return eq ? { ok: true } : { ok: false, reason: 'bad-signature' };
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
}

// ---------------------------------------------------------------------------
// In-memory idempotency cache
// ---------------------------------------------------------------------------

const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const seenEvents = new Map<string, number>();

function isReplay(eventId: string | undefined, now: number = Date.now()): boolean {
  if (!eventId) return false;
  // Sweep stale entries — bounded scan keeps GC light without
  // an explicit interval timer.
  for (const [k, ts] of seenEvents.entries()) {
    if (ts < now - IDEMPOTENCY_TTL_MS) seenEvents.delete(k);
  }
  if (seenEvents.has(eventId)) return true;
  seenEvents.set(eventId, now);
  return false;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();

app.post('/', withSecurityEvents({ action: 'inngest-webhook.create', resource: 'inngest-webhook', severity: 'info' }, async (c) => {
  const rawBody = await c.req.raw.text();
  const sigHeader = c.req.header('x-inngest-signature') ?? c.req.header('X-Inngest-Signature');
  const verdict = verifyInngestSignature(rawBody, sigHeader);
  if (!verdict.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INNGEST_SIGNATURE_INVALID',
          message: verdict.reason ?? 'signature verification failed',
        },
      },
      401,
    );
  }

  type InngestPayload = { readonly name?: unknown; readonly data?: unknown; readonly id?: unknown };
  let payload: InngestPayload | null = null;
  try {
    payload = JSON.parse(rawBody) as InngestPayload | null;
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'INNGEST_BODY_INVALID', message: 'body is not valid JSON' },
      },
      400,
    );
  }
  if (!payload) {
    return c.json(
      {
        success: false,
        error: { code: 'INNGEST_BODY_INVALID', message: 'body must be an object' },
      },
      400,
    );
  }
  if (typeof payload.name !== 'string' || payload.name.length === 0) {
    return c.json(
      {
        success: false,
        error: { code: 'INNGEST_BODY_INVALID', message: 'event.name is required' },
      },
      400,
    );
  }
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    return c.json(
      {
        success: false,
        error: { code: 'INNGEST_BODY_INVALID', message: 'event.data must be an object' },
      },
      400,
    );
  }

  const eventId = typeof payload.id === 'string' ? payload.id : undefined;
  if (isReplay(eventId)) {
    return c.json(
      {
        success: true,
        data: { replay: true, eventId },
      },
      409,
    );
  }

  const services = (c.get('services') ?? {}) as Record<string, unknown>;
  const runtime = services.inngestRuntime as InngestRuntime | undefined;
  if (!runtime) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INNGEST_UNAVAILABLE',
          message:
            'inngest runtime not wired — composition root did not bind inngestRuntime',
        },
      },
      503,
    );
  }

  try {
    const handlePayload: {
      name: string;
      data: Record<string, unknown>;
      id?: string;
    } = {
      name: payload.name,
      data: payload.data as Record<string, unknown>,
<<<<<<< Updated upstream
      ...(eventId && { id: eventId }),
    });
=======
    };
    if (eventId !== undefined) handlePayload.id = eventId;
    const result = await runtime.handle(handlePayload);
>>>>>>> Stashed changes
    return c.json({ success: true, data: result }, 200);
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INNGEST_DISPATCH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    );
  }
}));

export const __internal = {
  verifyInngestSignature,
  isReplay,
  // Test-only: clear the idempotency cache between cases so each
  // test runs from a clean slate.
  _resetIdempotency: () => seenEvents.clear(),
};

export const inngestWebhookRouter = app;
export default app;
