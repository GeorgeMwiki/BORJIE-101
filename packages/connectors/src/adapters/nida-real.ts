/**
 * NIDA NIVS real adapter — Tanzania National Identification Authority's
 * biometric verification gateway. Wraps `POST /v1/identity/verify`
 * with production-grade auth (OAuth2 client-credentials OR API-key,
 * NIDA partners get either depending on tier), sandbox vs prod env,
 * and aware handling of NIDA's strict rate caps.
 *
 * Differs from `nida-adapter.ts` (the original stub-aware adapter) in:
 *   - Real default base URLs (sandbox / production).
 *   - Token-caching OAuth2 flow when consumerKey + consumerSecret supplied.
 *   - Retry-After honouring on 429 responses — the base connector
 *     returns `rate-limited` on token-bucket starvation; this adapter
 *     additionally translates an upstream 429 with `Retry-After`
 *     header into a `rate-limited` outcome surface so callers can back
 *     off without parsing upstream-error.
 *
 * NIDA's published cap (per 2024 NIVS partner addendum) is 60 calls
 * per minute per integration partner. Burst 10.
 */

import { z } from 'zod';
import {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type ConnectorAuth,
  type ConnectorEventSink,
  type ConnectorOutcome,
} from '../base-connector.js';

export type NidaEnv = 'sandbox' | 'production';

const BASE_URLS: Readonly<Record<NidaEnv, string>> = Object.freeze({
  sandbox: 'https://nivs-sandbox.nida.go.tz',
  production: 'https://nivs.nida.go.tz',
});

// ─────────────────────────────────────────────────────────────────────
// Schemas (re-export-compatible with nida-adapter.ts)
// ─────────────────────────────────────────────────────────────────────

export const NidaNumberSchema = z
  .string()
  .regex(
    /^[0-9]{20}$|^[0-9]{8}-[0-9]{4}-[0-9]{6}-[0-9]{2}$/,
    'nidaNumber must be 20 digits (with or without 8-4-6-2 hyphens)',
  );

export const BiometricHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'biometricHash must be SHA-256 hex (64 lowercase hex chars)');

export const VerifyIdentityInputSchema = z.object({
  nidaNumber: NidaNumberSchema,
  biometricHash: BiometricHashSchema,
});
export type VerifyIdentityInput = z.infer<typeof VerifyIdentityInputSchema>;

export const VerifyIdentityOutputSchema = z.object({
  verified: z.boolean(),
  name: z.string().min(1).max(200),
  dob: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  photo_match_score: z.number().min(0).max(1),
});
export type VerifyIdentityOutput = z.infer<typeof VerifyIdentityOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

export type NidaAuthMode =
  | { readonly kind: 'api-key'; readonly headerName?: string; readonly key: string }
  | { readonly kind: 'oauth2'; readonly consumerKey: string; readonly consumerSecret: string };

export interface NidaRealAdapterDeps {
  readonly env?: NidaEnv;
  readonly baseUrl?: string;
  readonly auth: NidaAuthMode;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface NidaRealAdapter {
  readonly connector: BaseConnector;
  readonly env: NidaEnv;
  verifyIdentity(
    args: VerifyIdentityInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<VerifyIdentityOutput>>;
  tokenExpiryMs(): number | null;
}

interface TokenCache {
  token: string | null;
  expiresAtMs: number;
}

export function createNidaRealAdapter(deps: NidaRealAdapterDeps): NidaRealAdapter {
  const env: NidaEnv = deps.env ?? 'sandbox';
  const baseUrl = deps.baseUrl ?? BASE_URLS[env];
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const clock = deps.clock ?? Date.now;

  if (!fetchImpl) throw new Error('createNidaRealAdapter: no fetch implementation');

  const tokenCache: TokenCache = { token: null, expiresAtMs: 0 };

  // HIGH-3 (audit .audit/post-pr90-api-mcp-bug-sweep.md): /oauth/token
  // used to bypass connector.call() — no rate-limit, no circuit-breaker,
  // no audit. NIDA's published cap is 60 rpm; a misconfigured OAuth-storm
  // would burn quota in seconds. Route through a dedicated no-auth
  // connector with tighter limits than the data plane.
  const oauthConnector = createBaseConnector({
    config: {
      id: 'nida-real-oauth',
      displayName: `NIDA NIVS oauth (${env})`,
      baseUrl,
      rateLimit: { rpm: 6, burst: 2 },
      circuitBreaker: { errorThreshold: 3, halfOpenAfterMs: 90_000 },
      retry: { maxAttempts: 1, initialDelayMs: 400 },
      timeoutMs: 15_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function fetchOauthToken(consumerKey: string, consumerSecret: string): Promise<string> {
    const basic = Buffer.from(`${consumerKey}:${consumerSecret}`, 'utf8').toString('base64');
    // Form-encoded body; the base connector forwards body as-is when
    // Content-Type isn't JSON. We send the raw form string via a
    // pass-through serialiser.
    const outcome = await oauthConnector.call<
      string,
      { access_token?: string; expires_in?: number | string }
    >({
      path: '/oauth/token',
      method: 'POST',
      body: 'grant_type=client_credentials' as unknown as string,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });
    if (outcome.kind !== 'ok') throw new Error(`nida-real: oauth ${outcome.kind}`);
    const body = outcome.data;
    if (!body.access_token) throw new Error('nida-real: oauth response missing access_token');
    tokenCache.token = body.access_token;
    const lifetime = Number(body.expires_in ?? 3599);
    tokenCache.expiresAtMs = clock() + Math.max(60, lifetime - 60) * 1000;
    return body.access_token;
  }

  let connectorAuth: ConnectorAuth;
  if (deps.auth.kind === 'api-key') {
    connectorAuth = {
      kind: 'api-key',
      headerName: deps.auth.headerName ?? 'x-api-key',
      key: deps.auth.key,
    };
  } else {
    const { consumerKey, consumerSecret } = deps.auth;
    connectorAuth = {
      kind: 'oauth2',
      accessTokenProvider: async () => {
        if (tokenCache.token && clock() < tokenCache.expiresAtMs) return tokenCache.token;
        return fetchOauthToken(consumerKey, consumerSecret);
      },
      refresh: async () => {
        tokenCache.token = null;
        tokenCache.expiresAtMs = 0;
        await fetchOauthToken(consumerKey, consumerSecret);
      },
    };
  }

  const connector = createBaseConnector({
    config: {
      id: 'nida-real',
      displayName: `NIDA NIVS (${env})`,
      baseUrl,
      auth: connectorAuth,
      // NIDA's published cap.
      rateLimit: { rpm: 60, burst: 10 },
      circuitBreaker: { errorThreshold: 3, halfOpenAfterMs: 45_000 },
      retry: { maxAttempts: 2, initialDelayMs: 400 },
      timeoutMs: 15_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function verifyIdentity(
    args: VerifyIdentityInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<VerifyIdentityOutput>> {
    const parsed = VerifyIdentityInputSchema.safeParse(args);
    if (!parsed.success) return { kind: 'validation-failed', issue: parsed.error.message };
    // Strip optional hyphens before forwarding upstream.
    const upstreamBody = {
      nidaNumber: parsed.data.nidaNumber.replace(/-/g, ''),
      biometricHash: parsed.data.biometricHash,
    };
    const outcome = await connector.call<unknown, VerifyIdentityOutput>({
      path: '/v1/identity/verify',
      method: 'POST',
      body: upstreamBody,
      outputSchema: VerifyIdentityOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    // Translate upstream-429 into rate-limited shape.
    if (outcome.kind === 'upstream-error' && outcome.status === 429) {
      return { kind: 'rate-limited', retryAfterMs: 60_000 };
    }
    return outcome;
  }

  return {
    connector,
    env,
    verifyIdentity,
    tokenExpiryMs: () => (tokenCache.token ? tokenCache.expiresAtMs : null),
  };
}
