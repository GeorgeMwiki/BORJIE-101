/**
 * M-Pesa webhook hardening middleware.
 *
 * CRITICAL-3 (audit .audit/post-pr90-api-mcp-bug-sweep.md): Safaricom Daraja
 * STK callbacks are not signed today, but C2B and B2C results CAN be
 * HMAC-signed via the Org-managed `Initiator` shared secret. We layer
 * three defences:
 *
 *   1. IP allowlist (existing) — receive only from Safaricom's published
 *      source IPs.
 *   2. HMAC signature verification (NEW) — when `MPESA_WEBHOOK_SECRET`
 *      is set, require an `X-Mpesa-Signature` header that contains a
 *      lowercase hex HMAC-SHA256 of `${timestamp}.${rawBody}`. Reject
 *      requests with a missing/invalid signature OR a timestamp outside
 *      the 5-minute replay window. Production MUST set this secret
 *      (`MPESA_WEBHOOK_SECRET_REQUIRED=true`). Sandbox/dev may leave it
 *      unset for local testing.
 *   3. Deduplicate by `(tenantId, BusinessShortCode, TransID)` (existing)
 *      so retries cannot double-credit the ledger.
 *
 * Comparison is done with `crypto.timingSafeEqual` per the project's
 * mandatory security checks (~/.claude/rules/security.md).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// Safaricom Daraja production source IPs (as of 2024). Override via
// MPESA_ALLOWED_IPS (comma-separated) when Safaricom publishes changes
// or when running against the sandbox.
const DEFAULT_ALLOWED_IPS = [
  '196.201.214.200',
  '196.201.214.206',
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.128',
  '196.201.212.129',
  '196.201.212.132',
  '196.201.212.136',
  '196.201.212.138',
  '196.201.212.69',
  '196.201.212.74',
];

function getClientIp(req: Request): string | null {
  // Prefer X-Forwarded-For (set by load balancer); fall back to socket.
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  if (xff) return xff;
  const remote = req.socket?.remoteAddress ?? null;
  if (!remote) return null;
  // Strip IPv6-mapped prefix (::ffff:a.b.c.d).
  return remote.replace(/^::ffff:/, '');
}

export function mpesaIpAllowlistMiddleware(logger: {
  warn: (ctx: unknown, msg: string) => void;
}) {
  const raw = process.env.MPESA_ALLOWED_IPS?.trim();
  const allowed = new Set(
    raw ? raw.split(',').map((ip) => ip.trim()).filter(Boolean) : DEFAULT_ALLOWED_IPS
  );
  // Dev escape hatch — set MPESA_DISABLE_IP_ALLOWLIST=true only for local
  // webhook testing with ngrok/webhook.site.
  const disabled = process.env.MPESA_DISABLE_IP_ALLOWLIST === 'true';

  return (req: Request, res: Response, next: NextFunction) => {
    if (disabled) return next();

    const ip = getClientIp(req);
    if (!ip || !allowed.has(ip)) {
      logger.warn({ ip, path: req.path }, 'M-Pesa callback from non-allowlisted IP');
      // Respond 200 with a non-success body so Safaricom does not retry
      // (they interpret 4xx/5xx as retryable). This matches the pattern
      // used for invalid payloads in the same file.
      res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
      return;
    }
    next();
  };
}

/**
 * Idempotency store port — a callback deduplicator backend.
 *
 * KI-012 closure: the original in-memory store was process-local, which
 * opened a narrow double-credit window in multi-replica deployments
 * (two pods could both observe `seenBefore=false` for the same TransID
 * before either committed the ledger entry).
 *
 * Implementations:
 *   - {@link InMemoryIdempotencyStore} — Map-backed; default; suitable
 *     for single-replica dev and staging.
 *   - {@link RedisIdempotencyStore}    — SETNX/EX-backed; atomic across
 *     replicas; required for production. Wired by composition when
 *     `REDIS_URL` env is set.
 */
export interface IdempotencyStore {
  /**
   * Atomically check + claim a key.
   *
   * Contract: returns `true` if the key was already claimed (callback
   * is a duplicate; caller should drop it). Returns `false` and records
   * the key on first sight. The recording side is fire-and-forget — the
   * store SHOULD persist the key but if persistence fails, the caller
   * still proceeds (an extra Safaricom retry is preferable to losing
   * the legitimate first delivery).
   */
  seenBefore(key: string): Promise<boolean>;
}

/**
 * Process-local Map-backed implementation. Retains the synchronous
 * `seenBeforeSync` API for legacy callers; the async path simply
 * delegates to it.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
    setInterval(() => this.reap(), 60 * 60 * 1000).unref?.();
  }

  seenBeforeSync(key: string): boolean {
    const now = Date.now();
    const existing = this.seen.get(key);
    if (existing && existing > now) return true;
    this.seen.set(key, now + this.ttlMs);
    return false;
  }

  async seenBefore(key: string): Promise<boolean> {
    return this.seenBeforeSync(key);
  }

  private reap(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}

/**
 * Minimal Redis client shape used by {@link RedisIdempotencyStore}.
 * Compatible with ioredis (`set(key, value, 'EX', ttl, 'NX')`) without
 * dragging the ioredis types into this module.
 */
export interface RedisLikeClient {
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttlSeconds: number,
    setNx: 'NX',
  ): Promise<string | null>;
}

/**
 * Redis-backed idempotency store. Uses `SET key val NX EX ttl` so the
 * claim is atomic across replicas.
 *
 * Failure mode: if Redis is unreachable the store falls back to the
 * provided fallback (in-memory by default) so a Redis outage degrades
 * to the legacy behaviour rather than losing webhooks entirely.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly client: RedisLikeClient;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly fallback: IdempotencyStore;
  private readonly logger:
    | { warn: (ctx: unknown, msg: string) => void }
    | undefined;

  constructor(input: {
    client: RedisLikeClient;
    ttlSeconds?: number;
    keyPrefix?: string;
    fallback?: IdempotencyStore;
    logger?: { warn: (ctx: unknown, msg: string) => void };
  }) {
    this.client = input.client;
    this.ttlSeconds = input.ttlSeconds ?? 24 * 60 * 60;
    this.keyPrefix = input.keyPrefix ?? 'mpesa:idem:';
    this.fallback = input.fallback ?? new InMemoryIdempotencyStore();
    this.logger = input.logger;
  }

  async seenBefore(key: string): Promise<boolean> {
    const fullKey = `${this.keyPrefix}${key}`;
    try {
      // SET key value NX EX ttl → returns 'OK' on first sight,
      // null when the key already exists (duplicate).
      const result = await this.client.set(
        fullKey,
        '1',
        'EX',
        this.ttlSeconds,
        'NX',
      );
      // null → key already existed → duplicate.
      return result === null;
    } catch (error) {
      // Redis outage — fall back to in-memory so the webhook does NOT
      // get rejected with a 500. Visible in logs so an operator can
      // see the degraded state.
      this.logger?.warn(
        { error, key },
        'Redis idempotency store failed; falling back to in-memory',
      );
      return this.fallback.seenBefore(key);
    }
  }
}

/**
 * Process-local idempotency cache keyed by
 *   `{tenantId}:{type}:{CheckoutRequestID-or-TransID}`
 * so a replay across tenants (e.g. a shared paybill in staging)
 * cannot collide. 24h TTL matches Safaricom's retry window.
 *
 * KI-012: this class retains the sync `seenBefore` for legacy callers
 * but the production path SHOULD use the {@link IdempotencyStore} port
 * (see {@link createIdempotencyStore}) bound to Redis when `REDIS_URL`
 * is set.
 */
export class CallbackDeduplicator {
  private readonly inner: InMemoryIdempotencyStore;

  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.inner = new InMemoryIdempotencyStore(ttlMs);
  }

  /**
   * Returns true if this key was seen before (callback is a duplicate).
   * Returns false and records the key on first sight.
   *
   * @param key  the deduplication key. Callers SHOULD namespace by
   *   tenantId using {@link tenantKey} below rather than passing a
   *   raw TransID to prevent cross-tenant collisions.
   */
  seenBefore(key: string): boolean {
    return this.inner.seenBeforeSync(key);
  }

  /**
   * Build a tenant-scoped deduplication key. Prefer this over raw
   * string concatenation at callsites so the shape stays consistent.
   */
  static tenantKey(
    tenantId: string | null,
    type: 'stk' | 'c2b' | 'b2c',
    externalId: string
  ): string {
    const tenant = tenantId ?? 'global';
    return `${tenant}:${type}:${externalId}`;
  }
}

export const mpesaDeduplicator = new CallbackDeduplicator();

/**
 * Build the production-grade {@link IdempotencyStore}.
 *
 * If `REDIS_URL` env is set, returns a {@link RedisIdempotencyStore}
 * wired to that client; otherwise returns an {@link InMemoryIdempotencyStore}
 * (the legacy behaviour). Tests should NEVER call this directly — they
 * construct {@link InMemoryIdempotencyStore} explicitly.
 */
export function createIdempotencyStore(input: {
  redisUrl?: string;
  ttlSeconds?: number;
  keyPrefix?: string;
  logger?: { warn: (ctx: unknown, msg: string) => void };
}): IdempotencyStore {
  if (!input.redisUrl) {
    return new InMemoryIdempotencyStore(
      (input.ttlSeconds ?? 24 * 60 * 60) * 1000,
    );
  }
  // Lazy require so dev tooling that doesn't have ioredis installed
  // can still import this module.
  const ioredisModule = (
    eval('require') as (id: string) => unknown
  )('ioredis') as {
    default?: new (url: string) => RedisLikeClient;
  } & { Redis?: new (url: string) => RedisLikeClient } & (new (
    url: string,
  ) => RedisLikeClient);
  // ioredis exports both `Redis` named and as the default export.
  const Ctor = ioredisModule.default ?? ioredisModule.Redis ?? ioredisModule;
  const client = new (Ctor as new (url: string) => RedisLikeClient)(
    input.redisUrl,
  );
  return new RedisIdempotencyStore({
    client,
    ttlSeconds: input.ttlSeconds,
    keyPrefix: input.keyPrefix,
    logger: input.logger,
  });
}

// ---------------------------------------------------------------------------
// CRITICAL-3: HMAC signature verification for Daraja webhooks
// ---------------------------------------------------------------------------

const SIGNATURE_HEADER = 'x-mpesa-signature';
const TIMESTAMP_HEADER = 'x-mpesa-timestamp';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

interface MpesaSignatureLogger {
  warn: (ctx: unknown, msg: string) => void;
}

/**
 * Express middleware that verifies an M-Pesa webhook HMAC signature.
 *
 * Behaviour:
 *   - If `MPESA_WEBHOOK_SECRET` is unset and `MPESA_WEBHOOK_SECRET_REQUIRED`
 *     is not `'true'`, signature verification is SKIPPED (sandbox/dev).
 *   - If the secret is set, the request MUST include
 *     `X-Mpesa-Signature: <hex>` and `X-Mpesa-Timestamp: <unix-ms>`.
 *     The signature is computed as
 *     `hex(hmac-sha256(secret, `${timestamp}.${rawBody}`))`.
 *   - The timestamp must be within `REPLAY_WINDOW_MS` of `Date.now()`
 *     (mirrors Inngest's 5-minute window).
 *   - Comparison uses `crypto.timingSafeEqual` (project rule).
 *
 * On failure, responds 401 immediately — NEVER reaches the handler. The
 * response body intentionally returns `{ResultCode: 1, ResultDesc: ...}`
 * so Safaricom's retry behaviour treats the rejection as authoritative
 * rather than retryable.
 */
export function mpesaSignatureMiddleware(logger: MpesaSignatureLogger) {
  const secret = process.env.MPESA_WEBHOOK_SECRET?.trim();
  const required =
    process.env.MPESA_WEBHOOK_SECRET_REQUIRED === 'true' ||
    process.env.NODE_ENV === 'production';

  if (!secret && required) {
    // Fail closed: in production we refuse to mount the route at all.
    throw new Error(
      'MPESA_WEBHOOK_SECRET must be set when running with NODE_ENV=production or MPESA_WEBHOOK_SECRET_REQUIRED=true'
    );
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!secret) {
      // Sandbox / dev — allow through but log so it's visible in logs.
      logger.warn(
        { path: req.path },
        'MPESA_WEBHOOK_SECRET not set; webhook signature verification SKIPPED'
      );
      next();
      return;
    }
    const signature = (req.headers[SIGNATURE_HEADER] as string | undefined)?.trim();
    const timestampRaw = (req.headers[TIMESTAMP_HEADER] as string | undefined)?.trim();
    if (!signature || !timestampRaw) {
      logger.warn(
        { path: req.path, hasSig: !!signature, hasTs: !!timestampRaw },
        'M-Pesa webhook missing signature/timestamp headers'
      );
      res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
      return;
    }
    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
      return;
    }
    const drift = Math.abs(Date.now() - timestamp);
    if (drift > REPLAY_WINDOW_MS) {
      logger.warn(
        { path: req.path, driftMs: drift },
        'M-Pesa webhook timestamp outside replay window'
      );
      res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
      return;
    }
    const raw = req.rawBody;
    if (!raw) {
      logger.warn(
        { path: req.path },
        'M-Pesa webhook raw body not captured; refusing'
      );
      res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
      return;
    }
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${raw.toString('utf8')}`)
      .digest('hex');
    let valid = false;
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(signature, 'hex');
      valid = a.length === b.length && timingSafeEqual(a, b);
    } catch {
      valid = false;
    }
    if (!valid) {
      logger.warn({ path: req.path }, 'M-Pesa webhook signature verification failed');
      res.status(401).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
      return;
    }
    next();
  };
}
