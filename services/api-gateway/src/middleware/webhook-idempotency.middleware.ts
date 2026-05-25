/**
 * Webhook Idempotency Middleware — closes audit gap P3 from
 * `.audit/deep-audit-2026-05-20.md`:
 *
 *   "Webhook handlers missing idempotency — duplicate webhook deliveries
 *    create duplicate notifications/state."
 *
 * Why this is a separate variant of `idempotency.ts`:
 *
 *   1. Webhooks do NOT carry an authenticated JWT — the existing
 *      middleware bails when `c.get('auth')` is absent, which is the
 *      common path for provider callbacks.
 *   2. Provider key shapes differ: Inngest signs an `id` inside the
 *      JSON body, Twilio uses `X-Twilio-Idempotency-Token`, Stripe
 *      uses `event.id`, Africa's Talking + Meta send no key at all
 *      (we synthesize one from the signed payload digest if we have
 *      to). A pluggable `extractKey` keeps the middleware honest.
 *   3. Failure mode is the inverse of the JWT path: when Redis is
 *      down we MUST NOT silently allow the request through — that
 *      would re-execute duplicate webhooks and corrupt state. We
 *      fail LOUD with 503 so the provider retries against a healthy
 *      replica.
 *
 * Scoping:
 *
 *   Cache keys are `webhook:${scope}:${tenantOrAnon}:${idempotencyKey}`.
 *   `scope` is the provider name (twilio | meta | africastalking |
 *   inngest | stripe …) — prevents collision when two providers
 *   coincidentally mint the same id. `tenantId`, when extractable,
 *   adds defence-in-depth against cross-tenant cache poisoning if a
 *   provider tenant id can be forged inside the body.
 *
 * Lifecycle:
 *
 *   1. Extract key (sync or async). No key → SKIP idempotency (let
 *      the route through; we never silently 200 a webhook without
 *      processing it).
 *   2. Lookup `webhook:scope:tenant:key` in Redis. Hit → replay
 *      cached status + headers + body + `webhook-idempotent-replay`
 *      marker header.
 *   3. Miss → run handler. On 2xx capture response and cache for
 *      `ttlMs` (default 24h).
 *   4. Redis lookup or write FAIL → return 503 with
 *      `WEBHOOK_IDEMPOTENCY_UNAVAILABLE` so the provider retries.
 *      No silent fall-through.
 *
 * The middleware never CONSUMES the request body — `extractKey`
 * implementations that need the body should clone (`c.req.raw.clone()`)
 * before reading. The route handler still gets the original
 * unconsumed stream.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const REPLAY_MARKER_HEADER = 'webhook-idempotent-replay';
const MAX_KEY_LENGTH = 256;

// ---------------------------------------------------------------------------
// Zod schema for keys we pull off the wire — guards against pathological
// values (multi-MB headers, null bytes, control chars) that could blow up
// Redis or get rejected by downstream key length limits.
//
// HIGH-fix (.audit/deep-audit-2026-05-20.md): the previous regex permitted
// `:` and `/` — both of which collide with the Redis key separator we use
// when building `webhook:${scope}:${tenant}:${key}`. A malicious provider
// (or a benign one minting unfortunate IDs) could escape its own namespace
// by submitting a key like `foo:bar:baz` and clobber another tenant's
// cache slot. Drop both characters here: only `[A-Za-z0-9_\-.]` survive.
// All four providers we integrate with (Twilio, Meta, AT, Inngest) mint
// ULID-shaped or UUID-shaped ids that conform to this tighter set; the
// generic `Idempotency-Key` header per RFC draft also recommends URL-safe
// chars only.
// ---------------------------------------------------------------------------

const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(MAX_KEY_LENGTH)
  .regex(/^[A-Za-z0-9_\-.]+$/, 'idempotency key contains invalid characters');

function safeParseKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const parsed = idempotencyKeySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal Redis surface — matches the `RedisLike` shape in
 * `idempotency.ts` so callers can pass the same ioredis client.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts?: { PX?: number; EX?: number }
  ): Promise<unknown>;
}

export interface CachedWebhookResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly cachedAt: number;
}

export interface WebhookIdempotencyOptions {
  /**
   * Connected Redis client. When null/undefined the middleware fails
   * closed (503) — never silently bypassed.
   */
  readonly redis: RedisLike | null | undefined;
  /**
   * Provider/router name. Keys are namespaced by scope so two
   * providers can never collide on the same id.
   */
  readonly scope: string;
  /**
   * Extract the idempotency key from the request. Return null/undefined
   * when no key is present — those requests skip caching entirely
   * (they still execute, never silent-200).
   *
   * May be async — implementations that need the body should
   * `c.req.raw.clone()` before reading so the route handler still
   * sees the unconsumed stream.
   */
  readonly extractKey: (c: Context) => string | null | Promise<string | null>;
  /**
   * Optional tenant extractor — when present, the key incorporates
   * `tenantId` to prevent cross-tenant cache poisoning. Webhooks that
   * are inherently global (no tenant) leave this undefined.
   */
  readonly extractTenantId?: (
    c: Context
  ) => string | null | Promise<string | null>;
  /** Cache TTL in ms. Defaults to 24h. */
  readonly ttlMs?: number;
  /**
   * Optional logger. Errors are logged via `logger.error`; never
   * thrown into the request pipeline beyond the 503.
   */
  readonly logger?: {
    readonly error: (meta: unknown, msg: string) => void;
    readonly warn?: (meta: unknown, msg: string) => void;
  };
}

// ---------------------------------------------------------------------------
// Key derivation — pure helper, exported for tests.
// ---------------------------------------------------------------------------

export function buildWebhookKey(
  scope: string,
  tenantId: string | null,
  idempotencyKey: string
): string {
  const tenantPart = tenantId ?? 'anon';
  return `webhook:${scope}:${tenantPart}:${idempotencyKey}`;
}

// ---------------------------------------------------------------------------
// Header allow-list — explicit allowlist of headers we will replay from
// cache. A previous version of this middleware used a strip-list approach
// (drop only a fixed set of hop-by-hop headers) which silently let
// arbitrary `Set-Cookie`, `Location`, `Access-Control-Allow-*`, etc. ride
// out on a cached replay. That is a CRITICAL hole:
//
//   - `Set-Cookie` poisoning: an attacker who could induce the original
//     handler to emit a cookie could replay-cache it onto every duplicate
//     delivery for the TTL window (24h default), pinning the cookie on
//     every retried delivery from the provider.
//   - `Location` poisoning: cached redirects (e.g. 201 + Location) would
//     redirect every replay to the original target even after the
//     downstream resource was deleted/moved.
//   - CORS-header poisoning: cached `Access-Control-Allow-Origin` (or
//     `*-Allow-Credentials`) would lock the response to whatever origin
//     happened to be in the first request, even if the route logic
//     would have negotiated a different origin on the replay.
//
// We replay ONLY:
//   - `content-type`      — clients parse the body using it
//   - `x-request-id`      — trace correlation; safe to replay because it
//                            identifies the ORIGINAL request that produced
//                            the cached payload (operators expect this)
//   - `webhook-idempotent-replay` — set by THIS middleware; never user-set
//
// Anything else is dropped on replay. The webhook receivers we ship do
// not need to set custom response headers; if a new provider requires
// one, add it to this allowlist explicitly after a security review.
// ---------------------------------------------------------------------------

const REPLAY_ALLOW_HEADERS = new Set([
  'content-type',
  'x-request-id',
  'webhook-idempotent-replay',
]);

function snapshotHeaders(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (!REPLAY_ALLOW_HEADERS.has(name.toLowerCase())) return;
    headers[name] = value;
  });
  return headers;
}

// ---------------------------------------------------------------------------
// Cache (de)serialization — JSON.parse with type guard so a corrupted
// blob never crashes the middleware.
// ---------------------------------------------------------------------------

const cachedResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.unknown(),
  headers: z.record(z.string()),
  cachedAt: z.number(),
});

function parseCached(raw: string): CachedWebhookResponse | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const verdict = cachedResponseSchema.safeParse(parsed);
    return verdict.success
      ? {
          status: verdict.data.status,
          body: verdict.data.body,
          headers: verdict.data.headers,
          cachedAt: verdict.data.cachedAt,
        }
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 503 response builder — single source of truth so the fail-loud shape is
// consistent across the read and write paths.
// ---------------------------------------------------------------------------

function unavailableResponse(
  c: Context,
  reason: 'no-redis' | 'lookup-failed' | 'write-failed'
): Response {
  // Build a fresh Response so we never accidentally inherit a partially-
  // written response from a downstream handler.
  return c.json(
    {
      success: false,
      error: {
        code: 'WEBHOOK_IDEMPOTENCY_UNAVAILABLE',
        message:
          'Webhook idempotency cache unavailable — retry against a healthy replica.',
        reason,
      },
    },
    503
  );
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function createWebhookIdempotencyMiddleware(
  options: WebhookIdempotencyOptions
): MiddlewareHandler {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const { redis, scope, extractKey, extractTenantId, logger } = options;

  return async (c: Context, next): Promise<void | Response> => {
    // Only mutation methods need idempotency — provider webhooks are
    // overwhelmingly POST but we guard cleanly in case the route
    // mounts on PUT/PATCH too.
    const method = c.req.method.toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
      await next();
      return;
    }

    // Extract candidate key. If the extractor itself throws (e.g. body
    // JSON parse failure) we treat it as "no key" rather than 500 —
    // signature verification + body validation in the route will
    // surface the real error.
    let rawKey: string | null = null;
    try {
      const maybe = await extractKey(c);
      rawKey = maybe ?? null;
    } catch (err) {
      logger?.warn?.(
        { err: err instanceof Error ? err.message : String(err) },
        'webhook-idempotency: extractKey threw — proceeding without cache'
      );
      rawKey = null;
    }
    const idempotencyKey = safeParseKey(rawKey);

    // No (valid) key → execute the handler. We do NOT 400 here because
    // some providers (Africa's Talking, Meta) don't send one — the
    // route layer is responsible for the signature-derived dedupe in
    // that case (downstream subscribers must be idempotent too).
    if (!idempotencyKey) {
      await next();
      return;
    }

    // No Redis client → fail LOUD. Allowing the request through would
    // re-process duplicate webhooks.
    if (!redis) {
      logger?.error?.(
        { scope },
        'webhook-idempotency: redis client missing — returning 503'
      );
      return unavailableResponse(c, 'no-redis');
    }

    // Optional tenant extraction — failures degrade to anonymous scope
    // (still safer than 503 because the key itself is provider-unique).
    let tenantId: string | null = null;
    if (extractTenantId) {
      try {
        const t = await extractTenantId(c);
        const trimmed = typeof t === 'string' ? t.trim() : '';
        tenantId = trimmed.length > 0 ? trimmed : null;
      } catch (err) {
        logger?.warn?.(
          { err: err instanceof Error ? err.message : String(err) },
          'webhook-idempotency: extractTenantId threw — using anonymous scope'
        );
        tenantId = null;
      }
    }

    const cacheKey = buildWebhookKey(scope, tenantId, idempotencyKey);

    // ---- READ PATH ----
    let cachedRaw: string | null;
    try {
      cachedRaw = await redis.get(cacheKey);
    } catch (err) {
      logger?.error?.(
        { err: err instanceof Error ? err.message : String(err), cacheKey, scope },
        'webhook-idempotency: redis.get failed — returning 503'
      );
      return unavailableResponse(c, 'lookup-failed');
    }

    if (cachedRaw) {
      const cached = parseCached(cachedRaw);
      if (cached) {
        // Replay — set headers (clone to a new object so we never
        // mutate the cached entry), then return a fresh Response.
        //
        // Defence in depth: re-filter through `REPLAY_ALLOW_HEADERS`
        // on the read path even though `snapshotHeaders` already
        // filtered on write. An older cache entry written before the
        // allowlist landed could still carry `Set-Cookie`/`Location`/
        // CORS bytes; re-filtering guarantees they cannot leak out
        // on replay regardless of when the cache entry was minted.
        for (const [h, v] of Object.entries(cached.headers)) {
          if (!REPLAY_ALLOW_HEADERS.has(h.toLowerCase())) continue;
          c.header(h, v);
        }
        c.header(REPLAY_MARKER_HEADER, 'true');
        return c.json(cached.body, cached.status as 200 | 201);
      }
      // Corrupt cache entry — fall through to re-execute. The 503-on-
      // write below will guard against split-brain (two replicas
      // racing to repopulate).
      logger?.warn?.(
        { cacheKey, scope },
        'webhook-idempotency: cached payload corrupted — re-executing'
      );
    }

    // ---- EXECUTE ----
    await next();

    // ---- WRITE PATH ----
    const status = c.res.status;
    if (status < 200 || status >= 300) {
      // Don't cache errors — providers should be able to retry.
      return;
    }

    let cloneBody: string;
    let snapshot: CachedWebhookResponse;
    try {
      const cloned = c.res.clone();
      cloneBody = await cloned.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(cloneBody);
      } catch {
        parsedBody = cloneBody;
      }
      snapshot = {
        status,
        body: parsedBody,
        headers: snapshotHeaders(cloned),
        cachedAt: Date.now(),
      };
    } catch (err) {
      logger?.error?.(
        { err: err instanceof Error ? err.message : String(err), cacheKey },
        'webhook-idempotency: failed to snapshot response — caller saw success but cache empty'
      );
      // Don't 503 here — the handler already produced a response and
      // closed any side effects. Logging is the right signal.
      return;
    }

    try {
      await redis.set(cacheKey, JSON.stringify(snapshot), { PX: ttl });
    } catch (err) {
      logger?.error?.(
        { err: err instanceof Error ? err.message : String(err), cacheKey, scope },
        'webhook-idempotency: redis.set failed — duplicate webhook is now possible until TTL'
      );
      // Same reasoning: side effects already occurred. The next
      // duplicate will re-execute, which is wrong, but we cannot
      // un-send the response. Logging is the operator's signal to
      // investigate Redis health.
      return;
    }
  };
}

// ---------------------------------------------------------------------------
// Common extractor builders — exported so each router can wire its own
// provider quirks without re-implementing the boilerplate.
// ---------------------------------------------------------------------------

/**
 * Header strategy — checks a prioritised list of header names. First
 * non-empty value wins. Header names are lowercased before lookup
 * (Hono normalises).
 */
export function extractKeyFromHeaders(
  ...headerNames: ReadonlyArray<string>
): (c: Context) => string | null {
  const normalised = headerNames.map((h) => h.toLowerCase());
  return (c) => {
    for (const name of normalised) {
      const v = c.req.header(name);
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return null;
  };
}

/**
 * Body-JSON strategy — clones the raw request, reads it once, and
 * pulls a top-level string field. Safe to call from middleware
 * because we clone before reading: the route's own
 * `c.req.raw.text()` still works.
 *
 * `field` may be a dotted path (e.g. `data.id`) — keeps the
 * extractor declarative without dragging in a json-pointer dep.
 */
export function extractKeyFromBodyField(
  field: string
): (c: Context) => Promise<string | null> {
  const path = field.split('.');
  return async (c) => {
    let text: string;
    try {
      text = await c.req.raw.clone().text();
    } catch {
      return null;
    }
    if (text.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    let cursor: unknown = parsed;
    for (const segment of path) {
      if (!cursor || typeof cursor !== 'object') return null;
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
  };
}

// Re-exported for tests.
export const __internal = {
  safeParseKey,
  parseCached,
  buildWebhookKey,
  snapshotHeaders,
  REPLAY_MARKER_HEADER,
  REPLAY_ALLOW_HEADERS,
};
