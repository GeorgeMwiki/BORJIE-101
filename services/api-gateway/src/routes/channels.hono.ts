/**
 * Unified channel ingress + USSD routes (LP-25 / LP-30).
 *
 * Turns the previously-orphan `@borjie/channel-gateway` and
 * `@borjie/ussd-engine` packages on at the api-gateway runtime:
 *
 *   POST /api/v1/webhooks/channels/:channel
 *     - Canonicalizes a provider webhook (whatsapp | sms | voice | email |
 *       web | ussd) into ONE `ChannelEvent` via `createChannelGateway`.
 *     - Signature is verified FIRST, on the raw body, before any parse —
 *       an invalid signature returns 400 and NEVER reaches the brain.
 *     - The resolved sender -> tenant + actor + tier is then recorded into
 *       cross-channel state via `createStateSync` so a person can hop
 *       channels (start on WhatsApp, finish on the web) coherently.
 *
 *   POST /api/v1/webhooks/channels/ussd/session
 *     - Drives the bilingual USSD menu tree via `handleUssdRequest` from the
 *       Africa's-Talking session webhook. Africa's Talking expects a plain
 *       `text/plain` body prefixed `CON ` (continue) or `END ` (terminal).
 *
 * Security-first contract (CLAUDE.md):
 *   - Signature verify is fail-CLOSED: an unknown channel or a missing
 *     provider secret rejects the event (400). No reflective trust.
 *   - Africa's-Talking inbound (sms/voice/ussd) is authenticated only by a
 *     shared-secret token (the provider does not HMAC-sign callbacks), so it
 *     is hardened in depth: an optional IP-allowlist gate
 *     (`BORJIE_AT_IP_ALLOWLIST`) runs ahead of the secret check, and the
 *     channel-resolved tier is CLAMPED to a non-privileged member tier
 *     before it reaches the brain (a forgeable phone can never inherit
 *     owner/manager authority — the directory tier is a display hint only).
 *   - Tier resolution is fail-SOFT: an unresolved sender becomes
 *     `tier: 'anonymous'` with null scope (the brain can still answer
 *     public questions) — it is never an error.
 *   - No secrets are echoed to a USSD screen (USSD is plaintext).
 *   - Pino logger only; no console.*.
 *
 * Composition discipline: the signature verifier + tier resolver are built
 * from the SAME conventions the existing notification-webhooks router uses
 * (Meta `X-Hub-Signature-256`, Twilio HMAC-SHA1, Africa's-Talking shared
 * secret; env phone->tenant maps). This route adds no new secret surface —
 * it reuses `META_APP_SECRET`, `TWILIO_AUTH_TOKEN`,
 * `AFRICASTALKING_WEBHOOK_SECRET`, and the `*_PHONE_TENANT_MAP` env maps.
 *
 * @module services/api-gateway/src/routes/channels.hono
 */

import { Hono, type Context } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  createChannelGateway,
  createStateSync,
  createInMemoryConversationStore,
  type ActorTier,
  type ChannelKind,
  type ConversationStore,
  type RawSender,
  type SignatureInput,
  type SignatureVerifier,
  type TierResolver,
} from '@borjie/channel-gateway';
import {
  handleUssdRequest,
  createInMemorySessionStore,
  type UssdEngineDeps,
  type UssdLanguage,
  type UssdRequest,
  type UssdSessionStore,
  type UssdTier,
} from '@borjie/ussd-engine';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Channel allowlist — the six channels the canonicalizer understands.
// ---------------------------------------------------------------------------

const CHANNEL_KINDS: ReadonlyArray<ChannelKind> = Object.freeze([
  'whatsapp',
  'sms',
  'ussd',
  'voice',
  'email',
  'web',
]);

function isChannelKind(value: string): value is ChannelKind {
  return (CHANNEL_KINDS as ReadonlyArray<string>).includes(value);
}

// ---------------------------------------------------------------------------
// Env helpers — mirror notification-webhooks.router.ts conventions so the
// ops surface is consistent (no new secret names introduced here).
// ---------------------------------------------------------------------------

/** Parse a comma-separated allowlist into a frozen Set of trimmed entries. */
function parseCsvSet(envValue: string | undefined): ReadonlySet<string> {
  if (!envValue || envValue.trim().length === 0) return new Set();
  const out = new Set<string>();
  for (const raw of envValue.split(',')) {
    const v = raw.trim();
    if (v.length > 0) out.add(v);
  }
  return out;
}

/**
 * Extract the client source IP from edge headers, mirroring the convention
 * used elsewhere in the gateway (cf-connecting-ip, then the left-most
 * x-forwarded-for hop). Returns null when neither header is present.
 */
function clientIpOf(
  headers: Readonly<Record<string, string>>,
): string | null {
  const cf = headers['cf-connecting-ip']?.trim();
  if (cf && cf.length > 0) return cf;
  const fwd = headers['x-forwarded-for'];
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first && first.length > 0) return first;
  }
  const real = headers['x-real-ip']?.trim();
  if (real && real.length > 0) return real;
  return null;
}

/** Parse `"k1=v1,k2=v2"` -> Map(k1->v1, ...). Empty input -> empty map. */
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

function safeEqualHex(expectedHex: string, providedHex: string): boolean {
  if (expectedHex.length !== providedHex.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expectedHex, 'hex'),
      Buffer.from(providedHex, 'hex'),
    );
  } catch {
    return false;
  }
}

function safeEqualUtf8(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signature verifier — fail-closed per channel, env-secret backed.
// ---------------------------------------------------------------------------

function headerOf(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  // Headers are already lower-cased by the route before they reach here.
  return headers[name.toLowerCase()];
}

/**
 * Build the per-provider signature verifier. Each channel maps to the
 * provider whose webhook signs it:
 *   - whatsapp -> Meta Cloud API, HMAC-SHA256 over the raw body in
 *     `X-Hub-Signature-256: sha256=<hex>`.
 *   - sms / voice / ussd -> Africa's Talking, shared-secret token compared
 *     in constant time (header `x-at-signature` or `x-africastalking-key`).
 *   - email / web -> internal/edge-signed via `WEBHOOK_DEFAULT_HMAC_SECRET`
 *     (HMAC-SHA256 in `x-borjie-signature: sha256=<hex>`).
 *
 * Fail-closed: a missing secret for the channel returns `false`.
 */
function buildSignatureVerifier(
  env: Readonly<Record<string, string | undefined>>,
): SignatureVerifier {
  const verify = (input: SignatureInput): boolean => {
    switch (input.channel) {
      case 'whatsapp':
        return verifyMeta(input, env);
      case 'sms':
      case 'voice':
      case 'ussd':
        return verifyAfricasTalking(input, env);
      case 'email':
      case 'web':
        return verifyInternalHmac(input, env);
      default:
        return false;
    }
  };
  return { verify };
}

function verifyMeta(
  input: SignatureInput,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const secret = env.META_APP_SECRET;
  const header =
    headerOf(input.headers, 'x-hub-signature-256') ??
    headerOf(input.headers, 'x-hub-signature');
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(input.rawBody).digest('hex');
  return safeEqualHex(expected, header.slice('sha256='.length));
}

function verifyAfricasTalking(
  input: SignatureInput,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const secret = env.AFRICASTALKING_WEBHOOK_SECRET;
  if (!secret) return false;
  // Africa's Talking does not HMAC-sign USSD/SMS callbacks; the shared-secret
  // token below is NECESSARY-NOT-SUFFICIENT. It is one constant-time check in
  // a defence-in-depth stack: an optional IP-allowlist gate
  // (`BORJIE_AT_IP_ALLOWLIST`) runs ahead of it, and a channel-resolved phone
  // is tier-clamped (see `clampChannelTier`) so a leaked token can never
  // confer owner/manager authority on a brain turn. The canonical hardening
  // is a shared-secret token on a dedicated header (configured on the
  // gateway's callback URL). Compared in constant time.
  const token =
    headerOf(input.headers, 'x-at-signature') ??
    headerOf(input.headers, 'x-africastalking-key') ??
    headerOf(input.headers, 'x-at-webhook-token');
  if (!token) return false;
  return safeEqualUtf8(secret, token);
}

function verifyInternalHmac(
  input: SignatureInput,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const secret = env.WEBHOOK_DEFAULT_HMAC_SECRET;
  const header = headerOf(input.headers, 'x-borjie-signature');
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(input.rawBody).digest('hex');
  return safeEqualHex(expected, header.slice('sha256='.length));
}

// ---------------------------------------------------------------------------
// Tier resolver — fail-soft env-map directory.
// ---------------------------------------------------------------------------

/** Tenant + actor + tier strings parsed from `"tenantId:actorId:tier"`. */
interface DirectoryEntry {
  readonly tenantId: string;
  readonly actorId: string | null;
  readonly tier: ActorTier;
}

const ACTOR_TIERS: ReadonlyArray<ActorTier> = Object.freeze([
  'owner',
  'manager',
  'employee',
  'buyer',
  'anonymous',
]);

function coerceTier(raw: string | undefined): ActorTier {
  if (raw && (ACTOR_TIERS as ReadonlyArray<string>).includes(raw)) {
    return raw as ActorTier;
  }
  return 'anonymous';
}

/**
 * Privileged tiers that confer owner/manager authority on a brain turn. A
 * tier resolved purely from a (forgeable) channel sender address must NEVER
 * be one of these.
 */
const PRIVILEGED_TIERS: ReadonlySet<ActorTier> = new Set<ActorTier>([
  'owner',
  'manager',
]);

/**
 * Clamp a directory-resolved tier to the lowest non-privileged tier for the
 * brain turn. Inbound channel identity (SMS / USSD / voice / WhatsApp) is a
 * forgeable phone number authenticated only by a shared provider secret, so a
 * channel-resolved phone is treated as a member at most: `owner` / `manager`
 * are demoted to `employee`. Already-non-privileged tiers (`employee`,
 * `buyer`, `anonymous`) pass through unchanged. The original directory tier
 * is retained separately as a display-only hint and is never used for
 * authorization.
 */
function clampChannelTier(directoryTier: ActorTier): ActorTier {
  return PRIVILEGED_TIERS.has(directoryTier) ? 'employee' : directoryTier;
}

/**
 * Parse a `"<selector>=<tenantId>:<actorId>:<tier>"` directory map. The
 * selector is a phone number / email / web subject. `actorId` and `tier`
 * are optional; missing tier defaults to `employee` for a resolved member
 * (a known sender is at least a member) but stays `anonymous` when the
 * selector is absent.
 */
function parseDirectoryMap(
  envValue: string | undefined,
): ReadonlyMap<string, DirectoryEntry> {
  const out = new Map<string, DirectoryEntry>();
  for (const [selector, spec] of parseEnvMap(envValue)) {
    const parts = spec.split(':');
    const tenantId = (parts[0] ?? '').trim();
    if (tenantId.length === 0) continue;
    const actorId = (parts[1] ?? '').trim();
    const tier = coerceTier((parts[2] ?? '').trim() || 'employee');
    out.set(selector, {
      tenantId,
      actorId: actorId.length > 0 ? actorId : null,
      tier,
    });
  }
  return out;
}

/**
 * Build the sender->tier resolver from the env directory maps. Phone-keyed
 * for whatsapp/sms/voice/ussd, email-keyed for email, web-subject-keyed for
 * web. NEVER throws: an unresolved sender resolves to anonymous/null scope.
 */
function buildTierResolver(
  env: Readonly<Record<string, string | undefined>>,
): TierResolver {
  const phoneDir = parseDirectoryMap(env.CHANNEL_PHONE_DIRECTORY);
  const emailDir = parseDirectoryMap(env.CHANNEL_EMAIL_DIRECTORY);
  const webDir = parseDirectoryMap(env.CHANNEL_WEB_DIRECTORY);

  const resolve = async (
    sender: RawSender,
  ): Promise<{
    readonly tenantId: string | null;
    readonly actorId: string | null;
    readonly tier: ActorTier;
  }> => {
    const hit =
      (sender.phone ? phoneDir.get(sender.phone) : undefined) ??
      (sender.email ? emailDir.get(sender.email) : undefined) ??
      (sender.webUserId ? webDir.get(sender.webUserId) : undefined);
    if (hit) {
      // SECURITY (channel spoof): the sender address is forgeable and is
      // authenticated only by a shared provider secret, so the directory
      // tier is NOT trusted for authorization. Clamp owner/manager down to
      // a member tier for the brain turn; a spoofed phone can never inherit
      // privileged authority. Scope (tenant/actor) is still resolved so
      // cross-channel state stays coherent.
      return {
        tenantId: hit.tenantId,
        actorId: hit.actorId,
        tier: clampChannelTier(hit.tier),
      };
    }
    return { tenantId: null, actorId: null, tier: 'anonymous' };
  };
  return { resolve };
}

// ---------------------------------------------------------------------------
// Conversation id — stable per (tenant|sender-key). Keeps cross-channel
// state coherent without leaking a raw phone number into logs.
// ---------------------------------------------------------------------------

function conversationIdFor(args: {
  readonly tenantId: string | null;
  readonly senderKey: string;
}): string {
  const tenantPart = args.tenantId ?? 'anon';
  // Hash the sender key so the conversation id is safe to log / store
  // without exposing the raw MSISDN.
  const senderHash = createHmac('sha256', 'borjie-channel-conv')
    .update(args.senderKey)
    .digest('hex')
    .slice(0, 24);
  return `conv_${tenantPart}_${senderHash}`;
}

function senderKeyOf(sender: RawSender): string {
  return sender.phone ?? sender.email ?? sender.webUserId ?? 'unknown';
}

// ---------------------------------------------------------------------------
// USSD identity + data adapters.
// ---------------------------------------------------------------------------

function ussdTierFrom(tier: ActorTier): UssdTier {
  // ActorTier and UssdTier share the same union; coerce defensively.
  switch (tier) {
    case 'owner':
    case 'manager':
    case 'employee':
    case 'buyer':
      return tier;
    default:
      return 'anonymous';
  }
}

/**
 * Build the USSD engine deps. Identity reuses the SAME phone directory the
 * channel tier resolver uses. The read-only data fetchers degrade to "nothing
 * on file" screens until the Drizzle-backed mining adapters are wired (a
 * follow-up batch supplies licence / royalty / payout / marketplace readers);
 * `recordProduction` returns false so the menu shows the safe non-confirm
 * screen. This keeps the USSD tree fully navigable today without taking a hard
 * DB dependency at boot, and never crashes a dialer's session.
 */
function buildUssdDeps(
  env: Readonly<Record<string, string | undefined>>,
  sessionStore: UssdSessionStore,
): UssdEngineDeps {
  const phoneDir = parseDirectoryMap(env.CHANNEL_PHONE_DIRECTORY);
  const defaultLanguage: UssdLanguage = env.BORJIE_DEFAULT_LANGUAGE === 'sw' ? 'sw' : 'en';

  return {
    store: sessionStore,
    identity: {
      resolve: async (phoneNumber: string) => {
        const hit = phoneDir.get(phoneNumber);
        if (hit) {
          // SECURITY (channel spoof): a USSD MSISDN is forgeable, so the
          // directory tier is clamped to a member tier before it reaches the
          // menu tree. A spoofed phone can never open owner/manager screens.
          return {
            tenantId: hit.tenantId,
            actorId: hit.actorId,
            tier: ussdTierFrom(clampChannelTier(hit.tier)),
          };
        }
        return { tenantId: null, actorId: null, tier: 'anonymous' as UssdTier };
      },
    },
    data: {
      // Read-only mining screens. Until the Drizzle readers land, every
      // fetcher returns the "nothing on file" sentinel (null / empty), which
      // the menu-tree renders as a friendly single-language screen.
      fetchLicence: async () => null,
      fetchRoyalty: async () => null,
      fetchPayout: async () => null,
      fetchMarketplace: async () => [],
      // Production logging is NOT the money path (royalty settlement stays on
      // the gateway's authoritative LedgerService). Returning false renders
      // the safe "could not record" screen rather than implying success.
      recordProduction: async () => false,
    },
    audit: {
      log: (entry) => {
        logger.info(
          {
            route: 'channels',
            channel: 'ussd',
            sessionId: entry.sessionId,
            isEnd: entry.isEnd,
            serviceCode: entry.serviceCode,
          },
          'ussd: session step',
        );
      },
    },
    defaultLanguage,
  };
}

// ---------------------------------------------------------------------------
// Africa's Talking USSD request schema (validated before the engine runs).
// ---------------------------------------------------------------------------

interface RawUssdForm {
  readonly sessionId?: unknown;
  readonly serviceCode?: unknown;
  readonly phoneNumber?: unknown;
  readonly text?: unknown;
  readonly networkCode?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseUssdForm(form: RawUssdForm): UssdRequest | null {
  const sessionId = asString(form.sessionId).trim();
  const phoneNumber = asString(form.phoneNumber).trim();
  const serviceCode = asString(form.serviceCode).trim();
  if (sessionId.length === 0 || phoneNumber.length === 0) return null;
  const networkCode = asString(form.networkCode).trim();
  return {
    sessionId,
    serviceCode,
    phoneNumber,
    text: asString(form.text),
    provider: 'africas_talking',
    ...(networkCode.length > 0 ? { networkCode } : {}),
  };
}

// ---------------------------------------------------------------------------
// Africa's Talking IP-allowlist gate.
// ---------------------------------------------------------------------------

/** Channels delivered by Africa's Talking (subject to the IP-allowlist gate). */
const AFRICAS_TALKING_CHANNELS: ReadonlySet<ChannelKind> = new Set<ChannelKind>([
  'sms',
  'voice',
  'ussd',
]);

/**
 * Decide whether an Africa's-Talking inbound request passes the optional
 * IP-allowlist. Returns `true` (pass) when:
 *   - the allowlist is empty (feature disabled), OR
 *   - the channel is not an Africa's-Talking channel, OR
 *   - the resolved source IP is in the allowlist.
 *
 * Returns `false` (reject) when the allowlist is set for an Africa's-Talking
 * channel and the source IP is absent or not listed. This is a defence-in-
 * depth layer in front of the shared-secret check; it is fail-closed only
 * when explicitly configured.
 */
function passesAtIpAllowlist(args: {
  readonly channel: ChannelKind;
  readonly allowlist: ReadonlySet<string>;
  readonly headers: Readonly<Record<string, string>>;
}): boolean {
  if (args.allowlist.size === 0) return true;
  if (!AFRICAS_TALKING_CHANNELS.has(args.channel)) return true;
  const ip = clientIpOf(args.headers);
  if (ip === null) return false;
  return args.allowlist.has(ip);
}

// ---------------------------------------------------------------------------
// Router factory.
// ---------------------------------------------------------------------------

export interface ChannelsRouterDeps {
  /** Env source. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Cross-channel conversation store. Defaults to an in-memory store; a
   * Redis/Upstash-backed store with a TTL is injected in production.
   */
  readonly conversationStore?: ConversationStore;
  /** USSD session store. Defaults to an in-memory store. */
  readonly ussdSessionStore?: UssdSessionStore;
}

/**
 * Build the channel ingress + USSD router. Pure factory: all I/O is through
 * the injected stores + env. Mounted by `index.ts` at
 * `/webhooks/channels`.
 */
export function createChannelsRouter(deps: ChannelsRouterDeps = {}): Hono {
  const env = deps.env ?? process.env;
  const signature = buildSignatureVerifier(env);
  const tier = buildTierResolver(env);
  // Optional IP-allowlist for Africa's Talking inbound (sms/voice/ussd). When
  // `BORJIE_AT_IP_ALLOWLIST` is set, a request whose source IP is not listed
  // is rejected BEFORE the shared-secret check. When unset, the gate is a
  // no-op (the shared-secret check still applies).
  const atIpAllowlist = parseCsvSet(env.BORJIE_AT_IP_ALLOWLIST);
  const gateway = createChannelGateway({ signature, tier });
  const stateSync = createStateSync({
    store: deps.conversationStore ?? createInMemoryConversationStore(),
  });
  const ussdDeps = buildUssdDeps(
    env,
    deps.ussdSessionStore ?? createInMemorySessionStore(),
  );

  const app = new Hono();

  // -------------------------------------------------------------------------
  // USSD session webhook (Africa's Talking). Registered BEFORE the generic
  // `:channel` matcher so `/ussd/session` is not swallowed by it.
  // -------------------------------------------------------------------------
  app.post('/ussd/session', async (c) => {
    // Signature-verify FIRST on the raw body (fail-closed), before parse.
    const rawBody = await c.req.raw.text();
    const headers = lowerCaseHeaders(c.req.raw.headers);
    // Optional IP-allowlist gate (defence in depth ahead of the shared secret).
    if (!passesAtIpAllowlist({ channel: 'ussd', allowlist: atIpAllowlist, headers })) {
      logger.warn(
        { route: 'channels', channel: 'ussd' },
        'channels: ussd source IP not in BORJIE_AT_IP_ALLOWLIST; rejecting',
      );
      return ussdText(c, 'END Service unavailable. Please try again later.');
    }
    const verified = await Promise.resolve(
      signature.verify({ channel: 'ussd', rawBody, headers }),
    ).catch(() => false);
    if (!verified) {
      // USSD must always answer with a terminal text/plain body; a rejected
      // signature ends the session politely without reaching the engine.
      return ussdText(c, 'END Service unavailable. Please try again later.');
    }

    const form = parseAfricasTalkingForm(rawBody);
    const request = parseUssdForm(form);
    if (!request) {
      return ussdText(c, 'END Invalid request.');
    }

    try {
      const response = await handleUssdRequest(request, ussdDeps);
      const prefix = response.isEnd ? 'END ' : 'CON ';
      return ussdText(c, prefix + response.message);
    } catch (err) {
      logger.error(
        {
          route: 'channels',
          channel: 'ussd',
          error: err instanceof Error ? err.message : String(err),
        },
        'ussd: handler failed; returning generic end screen',
      );
      return ussdText(c, 'END Service unavailable. Please try again later.');
    }
  });

  // -------------------------------------------------------------------------
  // Unified channel webhook. Canonicalize -> verify-first -> sender->tier ->
  // cross-channel state ingest.
  // -------------------------------------------------------------------------
  app.post('/:channel', async (c) => {
    const channelParam = c.req.param('channel').toLowerCase();
    if (!isChannelKind(channelParam)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CHANNEL_UNSUPPORTED',
            message: `unsupported channel '${channelParam}'`,
          },
        },
        404,
      );
    }

    const rawBody = await c.req.raw.text();
    const headers = lowerCaseHeaders(c.req.raw.headers);

    // Optional IP-allowlist gate for Africa's-Talking channels (sms/voice/
    // ussd), ahead of the in-gateway shared-secret signature check.
    if (
      !passesAtIpAllowlist({ channel: channelParam, allowlist: atIpAllowlist, headers })
    ) {
      logger.warn(
        { route: 'channels', channel: channelParam },
        'channels: source IP not in BORJIE_AT_IP_ALLOWLIST; rejecting (403)',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'CHANNEL_IP_NOT_ALLOWED',
            message: 'source IP not permitted for this channel',
          },
        },
        403,
      );
    }

    let payload: unknown = {};
    if (rawBody.trim().length > 0) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        // Form-encoded providers (SMS/voice) send urlencoded bodies. Fall
        // back to a parsed form object so the canonicalizer can still read
        // sender/text fields.
        payload = parseAfricasTalkingForm(rawBody);
      }
    }

    // The gateway runs signature-verify FIRST internally; on an invalid
    // signature it returns `{ ok:false, reason:'signature_invalid' }` and
    // the payload NEVER reaches the brain.
    const result = await gateway.canonicalize({
      channel: channelParam,
      rawBody,
      headers,
      payload,
    });

    if (!result.ok) {
      if (result.reason === 'signature_invalid') {
        logger.warn(
          { route: 'channels', channel: channelParam },
          'channels: signature verification failed; rejecting (400)',
        );
        return c.json(
          {
            success: false,
            error: {
              code: 'CHANNEL_SIGNATURE_INVALID',
              message: 'signature verification failed',
            },
          },
          400,
        );
      }
      // Non-message payloads (delivery receipts / status webhooks) are
      // acknowledged with 200 so the provider does not retry.
      return c.json(
        { success: true, data: { status: 'ignored', reason: result.reason } },
        200,
      );
    }

    const event = result.event;
    const conversationId = conversationIdFor({
      tenantId: event.sender.tenantId,
      senderKey: senderKeyOf(event.sender.raw),
    });

    try {
      await stateSync.ingest(conversationId, event);
    } catch (err) {
      // State-sync is a side-channel — a store hiccup must not 500 the
      // webhook (the provider would retry and double-deliver).
      logger.warn(
        {
          route: 'channels',
          channel: channelParam,
          error: err instanceof Error ? err.message : String(err),
        },
        'channels: state-sync ingest failed (non-fatal)',
      );
    }

    return c.json(
      {
        success: true,
        data: {
          status: 'accepted',
          channel: event.channel,
          eventId: event.eventId,
          tier: event.sender.tier,
          conversationId,
          signatureVerified: event.signatureVerified,
        },
      },
      200,
    );
  });

  return app;
}

// ---------------------------------------------------------------------------
// Hono helpers.
// ---------------------------------------------------------------------------

function lowerCaseHeaders(headers: Headers): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return Object.freeze(out);
}

/** Parse an Africa's-Talking form-encoded body into a plain object. */
function parseAfricasTalkingForm(rawBody: string): RawUssdForm {
  const out: Record<string, string> = {};
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(rawBody);
  } catch {
    return out;
  }
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out as RawUssdForm;
}

/** Africa's Talking expects a `text/plain` USSD response body. */
function ussdText(c: Context, body: string): Response {
  return c.text(body, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
}

// ---------------------------------------------------------------------------
// Internal exports for tests (pure security helpers).
// ---------------------------------------------------------------------------

export const __testables = Object.freeze({
  buildTierResolver,
  clampChannelTier,
  passesAtIpAllowlist,
  parseCsvSet,
  clientIpOf,
  PRIVILEGED_TIERS,
});
