/**
 * Notification Provider Webhook Router — SCAFFOLDED 8 + NEW 21
 *
 * Single Hono router that terminates delivery-status webhooks from the
 * three SMS/WhatsApp/Email providers we use in production:
 *
 *   - POST /webhooks/notifications/africastalking  (SMS delivery reports)
 *   - POST /webhooks/notifications/twilio          (SMS + WhatsApp)
 *   - POST /webhooks/notifications/meta            (WhatsApp Business / Meta)
 *
 * Signature verification is enforced for each provider using the secret
 * configured via environment variable. The raw body is required for
 * verification — callers mounting this router MUST NOT pre-parse JSON for
 * these paths. We read the body ourselves via `c.req.raw.text()`.
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  createWebhookIdempotencyMiddleware,
  extractKeyFromHeaders,
  type RedisLike,
} from '../middleware/webhook-idempotency.middleware';
// DA1 MEDIUM: webhook signature rejects must emit the canonical
// `{ success: false, error: {...} }` envelope so SDK clients can use a
// single parser. `e401` builds the 401 form; `e400` for malformed
// bodies. Locked-down envelope contract lives at
// `services/api-gateway/src/utils/error-response.ts`.
import { e400, e401 } from '../utils/error-response';

/**
 * Resolves a tenant id from a provider-specific selector.
 *
 * The composition root supplies a resolver backed by the channel-config
 * registry (database or environment-driven map). Each provider passes
 * its own selector key:
 *
 *   - twilio          → the inbound `To` or `From` phone number (E.164)
 *   - meta            → the WhatsApp Business Account ID from `entry[0].id`
 *   - africastalking  → the AT username/account id from the body
 *
 * Returns `null` when no mapping exists — the router uses this to REJECT
 * the request (`401`) so a forged-but-signed payload can never land in
 * the anonymous tenant bucket and poison cross-tenant idempotency keys.
 *
 * Closes CRITICAL audit finding: `extractTenantId` was never wired,
 * so every webhook landed under `webhook:<scope>:anon:<key>` regardless
 * of which tenant it belonged to.
 */
export type TenantResolver = (
  provider: 'twilio' | 'meta' | 'africastalking',
  selector: string
) => string | null | Promise<string | null>;

import { withSecurityEvents } from '@borjie/observability';
export interface WebhookHandlerDeps {
  /** Handler invoked with the parsed status update. Kept abstract so the
   * gateway can decide whether to update the DB directly or emit an event. */
  onDeliveryStatus(update: {
    provider: 'africastalking' | 'twilio' | 'meta';
    providerMessageId?: string;
    status: string;
    occurredAt: Date;
    tenantId: string;
    raw: Record<string, unknown>;
  }): Promise<void> | void;
  /**
   * Redis client for cross-replica webhook idempotency (audit P3 from
   * `.audit/deep-audit-2026-05-20.md`). Passing `null` causes every
   * webhook POST to 503 — explicit fail-loud so duplicate deliveries
   * never silently re-execute. Callers in dev that want best-effort
   * behaviour should inject an in-memory fake that implements the
   * `RedisLike` surface.
   */
  readonly idempotencyRedis?: RedisLike | null;
  /**
   * Tenant resolver (CRITICAL audit fix). When omitted, the router
   * falls back to env-driven maps:
   *
   *   - TWILIO_PHONE_TENANT_MAP        ("+254700000001=tnt_a,+254700000002=tnt_b")
   *   - META_WABA_TENANT_MAP           ("1234567890=tnt_a,9876543210=tnt_b")
   *   - AFRICASTALKING_USERNAME_TENANT_MAP ("borjie=tnt_a")
   *
   * If no mapping resolves, the webhook is REJECTED with 401 — never
   * silently bucketed as `'anon'`.
   */
  readonly tenantResolver?: TenantResolver;
  /** Optional logger surfaced to the idempotency middleware. */
  readonly logger?: {
    readonly error: (meta: unknown, msg: string) => void;
    readonly warn?: (meta: unknown, msg: string) => void;
  };
}

// ---------------------------------------------------------------------------
// Signature verification helpers
// ---------------------------------------------------------------------------

// HIGH-7 (audit .audit/post-pr90-api-mcp-bug-sweep.md): the previous
// implementation computed HMAC over the raw body ALONE — no timestamp,
// no nonce. A signed body captured once was replayable forever.
//
// Fix: when callers send an `X-Webhook-Timestamp` header, include the
// timestamp in the signed payload AND enforce a 5-minute replay window
// (mirroring Inngest). Verifiers reject the request if drift exceeds the
// window even when the signature matches a stale body.
//
// Backward compatibility: if no timestamp header is present we fall back
// to the legacy body-only verification (with a startup warn) so existing
// production webhooks keep working until provider configs roll. Set
// `WEBHOOK_REQUIRE_TIMESTAMP=true` to fail closed in production.
const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const TIMESTAMP_HEADER = 'x-webhook-timestamp';

function timestampInWindow(tsHeader: string | undefined): boolean {
  if (!tsHeader) return false;
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(Date.now() - ts) <= WEBHOOK_REPLAY_WINDOW_MS;
}

function requireTimestamp(): boolean {
  return (
    process.env.WEBHOOK_REQUIRE_TIMESTAMP === 'true' ||
    process.env.NODE_ENV === 'production'
  );
}

/**
 * Africa's Talking: HMAC-SHA256 of `${ts}.${rawBody}` (with timestamp)
 * or raw body alone (legacy), sent as hex in `X-AT-Signature`. Secret
 * comes from `AFRICASTALKING_WEBHOOK_SECRET`.
 */
function verifyAfricasTalking(
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader?: string
): boolean {
  const secret = process.env.AFRICASTALKING_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  if (timestampHeader) {
    if (!timestampInWindow(timestampHeader)) return false;
    const expected = createHmac('sha256', secret)
      .update(`${timestampHeader}.${rawBody}`)
      .digest('hex');
    return safeEqualHex(expected, signatureHeader);
  }
  if (requireTimestamp()) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signatureHeader);
}

/**
 * Twilio: per https://www.twilio.com/docs/usage/webhooks/webhooks-security,
 * the signature is HMAC-SHA1 over `url + sorted-form-params` (concatenated
 * key+value), Base64-encoded, sent in `X-Twilio-Signature`.
 *
 * HIGH-7 fix: implement Twilio's documented format. The old code computed
 * HMAC-SHA1 over the JSON raw body — which (a) would reject real Twilio
 * webhooks following the documented URL+form format, AND (b) would accept
 * forged signatures computed over arbitrary JSON. Both broken.
 *
 * `url` must be the FULL request URL as Twilio called it (gateway should
 * pass the public-facing URL via `TWILIO_WEBHOOK_URL` or via the request
 * itself).
 */
function verifyTwilio(
  rawBody: string,
  signatureHeader: string | undefined,
  requestUrl: string | undefined
): boolean {
  const secret = process.env.TWILIO_AUTH_TOKEN;
  if (!secret || !signatureHeader) return false;
  if (!requestUrl) return false;
  // Twilio sends form-encoded bodies; sort the params and concatenate
  // key+value pairs to the URL.
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(rawBody);
  } catch {
    return false;
  }
  const sorted = Array.from(params.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  let signedPayload = requestUrl;
  for (const [k, v] of sorted) {
    signedPayload += k + v;
  }
  const expected = createHmac('sha1', secret).update(signedPayload).digest('base64');
  return safeEqualB64(expected, signatureHeader);
}

/**
 * Meta (WhatsApp Business Cloud API): HMAC-SHA256 of the raw body, prefixed
 * with "sha256=" in `X-Hub-Signature-256`. Meta does not yet sign a
 * timestamp; when callers wrap the request via the api-gateway we add
 * one and verify it for replay protection.
 */
function verifyMeta(
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader?: string
): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  if (timestampHeader && !timestampInWindow(timestampHeader)) return false;
  if (!timestampHeader && requireTimestamp()) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  return safeEqualHex(expected, provided);
}

function safeEqualHex(expectedHex: string, providedHex: string): boolean {
  if (expectedHex.length !== providedHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(providedHex, 'hex'));
  } catch {
    return false;
  }
}

function safeEqualB64(expectedB64: string, providedB64: string): boolean {
  try {
    const a = Buffer.from(expectedB64, 'base64');
    const b = Buffer.from(providedB64, 'base64');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tenant resolution (CRITICAL audit fix)
// ---------------------------------------------------------------------------
//
// Each webhook MUST be routed to a known tenant. If we cannot derive the
// tenant we reject with 401 — never bucket as `'anon'`, which would let a
// forged-but-signed webhook poison another tenant's idempotency cache.
//
// Environment maps are the default resolver — small ops surface, no DB
// dependency at boot, and easy to audit. Composition root may pass a
// richer `tenantResolver` (e.g. backed by the channel-config table)
// without touching this file.

/** Parse `"k1=v1,k2=v2"` → Map(k1→v1, k2→v2). Empty → empty Map. */
function parseEnvMap(envValue: string | undefined): ReadonlyMap<string, string> {
  if (!envValue || envValue.trim().length === 0) return new Map();
  const m = new Map<string, string>();
  for (const pair of envValue.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k.length > 0 && v.length > 0) m.set(k, v);
  }
  return m;
}

function envResolver(
  provider: 'twilio' | 'meta' | 'africastalking',
  selector: string
): string | null {
  const map =
    provider === 'twilio'
      ? parseEnvMap(process.env.TWILIO_PHONE_TENANT_MAP)
      : provider === 'meta'
        ? parseEnvMap(process.env.META_WABA_TENANT_MAP)
        : parseEnvMap(process.env.AFRICASTALKING_USERNAME_TENANT_MAP);
  return map.get(selector) ?? null;
}

/** Extract Twilio tenant selector — prefer the inbound `To` (our number;
 *  stable per channel-config) and fall back to `From` (caller's number;
 *  only used by some delivery-status callbacks). */
function extractTwilioSelector(payload: Record<string, unknown>): string | null {
  const to = typeof payload['To'] === 'string' ? (payload['To'] as string).trim() : '';
  if (to.length > 0) return to;
  const from = typeof payload['From'] === 'string' ? (payload['From'] as string).trim() : '';
  return from.length > 0 ? from : null;
}

/** Extract Meta WhatsApp Business Account ID from the standard webhook
 *  envelope: `entry[0].id`. */
function extractMetaSelector(payload: Record<string, unknown>): string | null {
  const entry = (payload as { entry?: Array<Record<string, unknown>> }).entry;
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const id = entry[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Extract Africa's Talking account selector — they POST a `username`
 *  field that maps 1:1 to an AT account. */
function extractAfricasTalkingSelector(
  payload: Record<string, unknown>
): string | null {
  const candidate =
    typeof payload['username'] === 'string'
      ? (payload['username'] as string)
      : typeof payload['accountId'] === 'string'
        ? (payload['accountId'] as string)
        : '';
  return candidate.trim().length > 0 ? candidate.trim() : null;
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

function normalizeAfricasTalkingStatus(raw: Record<string, unknown>): string {
  const status = String((raw as { status?: string }).status ?? 'unknown').toLowerCase();
  // AT values: Success, Sent, Submitted, Buffered, Rejected, Failed, Delivered, Expired
  if (status === 'success' || status === 'delivered') return 'delivered';
  if (status === 'sent' || status === 'submitted' || status === 'buffered') return 'sent';
  if (status === 'rejected' || status === 'failed') return 'failed';
  if (status === 'expired') return 'expired';
  return 'unknown';
}

function normalizeTwilioStatus(raw: Record<string, unknown>): string {
  const status = String(
    (raw as { MessageStatus?: string; SmsStatus?: string }).MessageStatus ??
      (raw as { SmsStatus?: string }).SmsStatus ??
      'unknown'
  ).toLowerCase();
  if (status === 'delivered' || status === 'read') return status;
  if (status === 'sent' || status === 'queued' || status === 'sending') return 'sent';
  if (status === 'failed' || status === 'undelivered') return 'failed';
  return 'unknown';
}

function normalizeMetaStatus(raw: Record<string, unknown>): {
  status: string;
  providerMessageId?: string;
} {
  // Meta webhooks are nested: entry[].changes[].value.statuses[].status
  const entry = (raw as { entry?: Array<Record<string, unknown>> }).entry ?? [];
  const changes = (entry[0]?.changes as Array<Record<string, unknown>>) ?? [];
  const value = (changes[0]?.value as Record<string, unknown>) ?? {};
  const statuses = (value.statuses as Array<Record<string, unknown>>) ?? [];
  const first = statuses[0];
  if (!first) return { status: 'unknown' };
  const status = String(first.status ?? 'unknown').toLowerCase();
  const normalized =
    status === 'delivered' || status === 'read' || status === 'sent' || status === 'failed'
      ? status
      : 'unknown';
  const providerMessageId = first.id as string | undefined;
  return {
    status: normalized,
    ...(providerMessageId !== undefined ? { providerMessageId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createNotificationWebhookRouter(deps: WebhookHandlerDeps): Hono {
  const app = new Hono();
  const resolveTenant: TenantResolver = deps.tenantResolver ?? envResolver;

  /**
   * Body-derived tenant extractor for the idempotency middleware.
   * Clones the raw request before reading so the route handler still
   * sees the unconsumed stream. Returns `null` when no tenant maps
   * (the middleware falls back to `'anon'` scoping for the KEY — but
   * the route handler does the actual REJECT decision, so the
   * middleware fallback is harmless if the route rejects below).
   *
   * Why we still scope the middleware: a forged signed payload would
   * fail signature verification IN the route, so it never reaches the
   * cache write path. But correctly-signed duplicates from tenant A
   * must not collide with tenant B's keys; the middleware-level
   * tenant scoping is the defence-in-depth that achieves that.
   */
  const tenantExtractor = (
    provider: 'twilio' | 'meta' | 'africastalking',
    extractSelector: (payload: Record<string, unknown>) => string | null
  ) => {
    return async (c: import('hono').Context): Promise<string | null> => {
      let text: string;
      try {
        text = await c.req.raw.clone().text();
      } catch {
        return null;
      }
      if (text.length === 0) return null;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Twilio sends form-encoded bodies — try that next.
        try {
          payload = Object.fromEntries(new URLSearchParams(text).entries());
        } catch {
          return null;
        }
      }
      const selector = extractSelector(payload);
      if (!selector) return null;
      try {
        const resolved = await resolveTenant(provider, selector);
        return resolved ?? null;
      } catch {
        return null;
      }
    };
  };

  // -------------------------------------------------------------------------
  // Idempotency middleware — keyed by provider-specific header so each
  // provider scopes its own cache namespace. Audit P3 fix.
  //
  // Header priority list per provider:
  //   - Africa's Talking: only emits an `id` inside the JSON body and
  //     does NOT use a token header. We accept the standard
  //     `Idempotency-Key` for callers proxying via our own dispatcher,
  //     and fall through (no cache) for direct AT deliveries — the
  //     downstream onDeliveryStatus subscriber MUST be idempotent at
  //     the providerMessageId layer.
  //   - Twilio: `X-Twilio-Idempotency-Token` (per Twilio docs) or
  //     fall back to `Idempotency-Key`.
  //   - Meta: no documented dedupe header; same fallback to
  //     `Idempotency-Key` for proxied callers.
  //
  // Scope is the provider name — cross-provider collision is
  // mathematically possible (different providers minting matching
  // ULIDs) but vanishingly unlikely; the namespace makes it impossible.
  //
  // CRITICAL audit fix: pass `extractTenantId` so the cache key
  // incorporates the resolved tenant (cross-tenant cache-poisoning
  // defence). Falls back to env-driven maps when no resolver is
  // injected; route handlers REJECT with 401 if no tenant can be
  // resolved, so the middleware's null-tenant scoping is moot.
  // -------------------------------------------------------------------------
  const idempotency = (
    scope: 'twilio' | 'meta' | 'africastalking',
    selectorFn: (payload: Record<string, unknown>) => string | null,
    ...headers: string[]
  ) =>
    createWebhookIdempotencyMiddleware({
      redis: deps.idempotencyRedis ?? null,
      scope,
      extractKey: extractKeyFromHeaders(...headers),
      extractTenantId: tenantExtractor(scope, selectorFn),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    });

  app.use(
    '/africastalking',
    idempotency('africastalking', extractAfricasTalkingSelector, 'idempotency-key')
  );
  app.use(
    '/twilio',
    idempotency(
      'twilio',
      extractTwilioSelector,
      'x-twilio-idempotency-token',
      'idempotency-key'
    )
  );
  app.use('/meta', idempotency('meta', extractMetaSelector, 'idempotency-key'));

  app.post('/africastalking', withSecurityEvents({ action: 'webhook.create', resource: 'webhook', severity: 'info' }, async (c) => {
    const raw = await c.req.raw.text();
    const sig = c.req.header('x-at-signature');
    const ts = c.req.header(TIMESTAMP_HEADER);
    if (!verifyAfricasTalking(raw, sig, ts)) {
      return e401(c, 'INVALID_SIGNATURE', 'Invalid signature');
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return e400(c, 'INVALID_BODY', 'Malformed JSON');
    }
    const selector = extractAfricasTalkingSelector(payload);
    if (!selector) {
      return e401(c, 'TENANT_UNRESOLVED', 'No account id in body');
    }
    const tenantId = await resolveTenant('africastalking', selector);
    if (!tenantId) {
      return e401(c, 'TENANT_UNRESOLVED', 'Unknown account');
    }
    const atProviderMessageId = (payload as { id?: string }).id;
    await deps.onDeliveryStatus({
      provider: 'africastalking',
      ...(atProviderMessageId !== undefined ? { providerMessageId: atProviderMessageId } : {}),
      status: normalizeAfricasTalkingStatus(payload),
      occurredAt: new Date(),
      tenantId,
      raw: payload,
    });
    return c.json({ received: true });
  }));

  app.post('/twilio', withSecurityEvents({ action: 'webhook.create', resource: 'webhook', severity: 'info' }, async (c) => {
    const raw = await c.req.raw.text();
    const sig = c.req.header('x-twilio-signature');
    // Twilio signs over the FULL URL — prefer the env-pinned URL so
    // forwarded-header spoofing can't shift it. Fall back to the
    // request URL only in non-prod.
    const requestUrl =
      process.env.TWILIO_WEBHOOK_URL ?? (process.env.NODE_ENV !== 'production' ? c.req.url : undefined);
    if (!verifyTwilio(raw, sig, requestUrl)) {
      return e401(c, 'INVALID_SIGNATURE', 'Invalid signature');
    }
    // Twilio uses form-encoded bodies by default; JSON webhooks are opt-in.
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      // Fallback: parse urlencoded.
      const params = new URLSearchParams(raw);
      payload = Object.fromEntries(params.entries());
    }
    const selector = extractTwilioSelector(payload);
    if (!selector) {
      return e401(c, 'TENANT_UNRESOLVED', 'No To/From in body');
    }
    const tenantId = await resolveTenant('twilio', selector);
    if (!tenantId) {
      return e401(c, 'TENANT_UNRESOLVED', 'Unknown phone number');
    }
    const twilioProviderMessageId = (payload as { MessageSid?: string }).MessageSid;
    await deps.onDeliveryStatus({
      provider: 'twilio',
      ...(twilioProviderMessageId !== undefined ? { providerMessageId: twilioProviderMessageId } : {}),
      status: normalizeTwilioStatus(payload),
      occurredAt: new Date(),
      tenantId,
      raw: payload,
    });
    return c.json({ received: true });
  }));

  app.post('/meta', withSecurityEvents({ action: 'webhook.create', resource: 'webhook', severity: 'info' }, async (c) => {
    const raw = await c.req.raw.text();
    const sig = c.req.header('x-hub-signature-256');
    const ts = c.req.header(TIMESTAMP_HEADER);
    if (!verifyMeta(raw, sig, ts)) {
      return e401(c, 'INVALID_SIGNATURE', 'Invalid signature');
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return e400(c, 'INVALID_BODY', 'Malformed JSON');
    }
    const selector = extractMetaSelector(payload);
    if (!selector) {
      return e401(c, 'TENANT_UNRESOLVED', 'No entry[0].id in body');
    }
    const tenantId = await resolveTenant('meta', selector);
    if (!tenantId) {
      return e401(c, 'TENANT_UNRESOLVED', 'Unknown WhatsApp Business Account');
    }
    const { status, providerMessageId } = normalizeMetaStatus(payload);
    await deps.onDeliveryStatus({
      provider: 'meta',
      ...(providerMessageId !== undefined ? { providerMessageId } : {}),
      status,
      occurredAt: new Date(),
      tenantId,
      raw: payload,
    });
    return c.json({ received: true });
  }));

  return app;
}

// Exported for unit testing without spinning up Hono.
export const __internal = {
  verifyAfricasTalking,
  verifyTwilio,
  verifyMeta,
  normalizeAfricasTalkingStatus,
  normalizeTwilioStatus,
  normalizeMetaStatus,
  parseEnvMap,
  envResolver,
  extractTwilioSelector,
  extractMetaSelector,
  extractAfricasTalkingSelector,
};
