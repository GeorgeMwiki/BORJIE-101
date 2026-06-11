/**
 * connector-oauth-descriptors — the GENERATIVE OAuth connect engine for the
 * universal integration fabric.
 *
 * THE LAST MILE this closes: the runtime invokers
 * (connector-invokers-wiring.ts) load + decrypt `connector_credentials`
 * rows at call time — but nothing ever WROTE those rows. This module is
 * the declarative half of the OAuth connect flow that seals them:
 *
 *   - ONE engine, parameterized by a per-provider `ConnectorOAuthDescriptor`
 *     ({ authorizeUrl, tokenUrl, scopes, envPrefix, mapTokenResponse }).
 *     Slack is the first descriptor; a 2nd provider is ONE new entry here —
 *     zero new route code (the generative rule the catalog already follows).
 *   - Signed single-use `state` (HMAC-SHA256, nonce + expiry) — the CSRF
 *     token of the OAuth dance AND the identity carrier across the consent
 *     redirect (the callback returns with no JWT; tenant/user/connector come
 *     from the verified state, mirroring calendar-providers/oauth.ts).
 *   - A bounded in-process replay guard consumes each state nonce as a
 *     same-process FAST-PATH; the cluster-wide authority is the durable
 *     Postgres consume (`composition/oauth-state-nonce-store.ts`, migration
 *     0343) the callback runs after it.
 *   - The authorization-code exchange engine (form-urlencoded POST to the
 *     descriptor's tokenUrl) returning a NORMALIZED token shape the route
 *     seals via the connector-token-cipher. Raw provider payloads (which
 *     carry plaintext tokens) NEVER leave this module — only the mapped
 *     shape or a token-free `{ ok:false, reason }`.
 *
 * SECURITY RAILS:
 *   - client_secret comes from env only, is sent only to the provider token
 *     endpoint, and never appears in any return value, error, or log.
 *   - redirect_uri derives from env (CONNECTOR_OAUTH_REDIRECT_BASE) only —
 *     never from the request.
 *   - state MACs verify in constant time; any tamper/expiry/shape failure
 *     returns null (the route maps it to a structured 400).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Normalized token shape — the ONLY thing that leaves the exchange
// ─────────────────────────────────────────────────────────────────────

export interface MappedConnectorTokens {
  /** Plaintext access token — sealed by the caller before persistence. */
  readonly accessToken: string;
  /** Plaintext refresh token when the provider rotates; null otherwise. */
  readonly refreshToken: string | null;
  /** Provider-side account id (Slack team id, email address, …). */
  readonly account: string;
  /** Scopes the provider actually granted. */
  readonly scopes: ReadonlyArray<string>;
  /** Absolute expiry when the provider returns one; null for long-lived. */
  readonly expiresAt: Date | null;
}

export type MapTokenResponseResult =
  | { readonly ok: true; readonly tokens: MappedConnectorTokens }
  | { readonly ok: false; readonly reason: string };

// ─────────────────────────────────────────────────────────────────────
// The descriptor — one entry per OAuth-capable provider
// ─────────────────────────────────────────────────────────────────────

export interface ConnectorOAuthDescriptor {
  /** Catalog id this descriptor connects (`connector-catalog.ts`). */
  readonly connectorId: string;
  /**
   * The `connector_credentials.connector_kind` the sealed row is written
   * under — MUST be one of the catalog entry's `credentialKinds`.
   */
  readonly credentialKind: string;
  /** Provider consent screen URL. */
  readonly authorizeUrl: string;
  /** Provider authorization-code exchange endpoint. */
  readonly tokenUrl: string;
  /** Optional best-effort token revocation endpoint (Bearer POST). */
  readonly revokeUrl?: string;
  /** Scopes the bound action adapters need (requested at consent). */
  readonly scopes: ReadonlyArray<string>;
  /** How the provider joins multiple scopes ("," for Slack, " " for Google). */
  readonly scopeSeparator: string;
  /**
   * Env prefix for the OAuth app credentials:
   * `${envPrefix}_CLIENT_ID` + `${envPrefix}_CLIENT_SECRET`.
   */
  readonly envPrefix: string;
  /** Extra static query params for the authorize URL (e.g. prompt=consent). */
  readonly extraAuthorizeParams?: Readonly<Record<string, string>>;
  /** Extra static body params for the token exchange (e.g. grant_type). */
  readonly extraTokenParams?: Readonly<Record<string, string>>;
  /**
   * Normalize the provider token payload. MUST return a token-free reason on
   * failure — never echo the raw payload (it carries plaintext tokens).
   */
  readonly mapTokenResponse: (payload: unknown) => MapTokenResponseResult;
}

// ─────────────────────────────────────────────────────────────────────
// Slack — the first descriptor (https://api.slack.com/authentication/oauth-v2)
// ─────────────────────────────────────────────────────────────────────

/**
 * Shape of a successful `oauth.v2.access` response (subset we consume) —
 * matches `slackOAuthTokensSchema` in @borjie/connector-slack/types.
 */
const SlackTokenPayload = z.object({
  ok: z.literal(true),
  access_token: z.string().min(1),
  scope: z.string().default(''),
  team: z.object({ id: z.string().min(1) }).optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

function mapSlackTokenResponse(payload: unknown): MapTokenResponseResult {
  const failed =
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { ok?: unknown }).ok !== true;
  if (failed) {
    const error = (payload as { error?: unknown }).error;
    return {
      ok: false,
      reason: `Slack oauth.v2.access refused: ${
        typeof error === 'string' ? error : 'unknown_error'
      }`,
    };
  }
  const parsed = SlackTokenPayload.safeParse(payload);
  if (!parsed.success) {
    // Token-free by construction — only the zod path, never values.
    return {
      ok: false,
      reason: `Slack token payload shape mismatch (${
        parsed.error.issues[0]?.path.join('.') ?? 'root'
      })`,
    };
  }
  const data = parsed.data;
  return {
    ok: true,
    tokens: Object.freeze({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      account: data.team?.id ?? 'unknown',
      scopes: Object.freeze(
        data.scope
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
      expiresAt:
        data.expires_in !== undefined
          ? new Date(Date.now() + data.expires_in * 1000)
          : null,
    }),
  };
}

/**
 * The registry — adding a 2nd provider is ONE new frozen entry (plus its
 * env vars). Scopes mirror exactly what CONNECTOR_ACTION_ADAPTERS calls:
 * chat.postMessage → chat:write, conversations.history → channels:history.
 */
export const CONNECTOR_OAUTH_DESCRIPTORS: Readonly<
  Record<string, ConnectorOAuthDescriptor>
> = Object.freeze({
  slack: Object.freeze({
    connectorId: 'slack',
    credentialKind: 'slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    revokeUrl: 'https://slack.com/api/auth.revoke',
    scopes: Object.freeze(['chat:write', 'channels:history', 'channels:read']),
    scopeSeparator: ',',
    envPrefix: 'SLACK',
    mapTokenResponse: mapSlackTokenResponse,
  }),
});

/** Look up an OAuth descriptor by connector id. Null for unknown ids. */
export function getConnectorOAuthDescriptor(
  connectorId: string,
): ConnectorOAuthDescriptor | null {
  return CONNECTOR_OAUTH_DESCRIPTORS[connectorId] ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Provider config (env ONLY — no secrets in code, no request-derived URIs)
// ─────────────────────────────────────────────────────────────────────

/** Canonical callback path — ONE callback for every provider. */
export const CONNECTOR_OAUTH_CALLBACK_PATH =
  '/api/v1/integrations/connectors/connect/callback';

export interface ConnectorOAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export type ProviderConfigResult =
  | { readonly ok: true; readonly config: ConnectorOAuthProviderConfig }
  | { readonly ok: false; readonly reason: string };

/**
 * Read one provider's OAuth-app config from env. HONEST: a missing piece
 * yields `{ ok:false, reason }` naming the unset env var(s) — never a
 * broken authorize URL. The redirect base is shared across providers
 * (CONNECTOR_OAUTH_REDIRECT_BASE, e.g. https://api.borjie.app).
 */
export function readConnectorOAuthProviderConfig(
  descriptor: ConnectorOAuthDescriptor,
  env: NodeJS.ProcessEnv,
): ProviderConfigResult {
  const clientId = env[`${descriptor.envPrefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${descriptor.envPrefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      reason:
        `provider OAuth app not configured — set ${descriptor.envPrefix}_CLIENT_ID` +
        ` and ${descriptor.envPrefix}_CLIENT_SECRET`,
    };
  }
  const base = (env.CONNECTOR_OAUTH_REDIRECT_BASE ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!base) {
    return {
      ok: false,
      reason:
        'redirect base not configured — set CONNECTOR_OAUTH_REDIRECT_BASE ' +
        '(e.g. https://api.borjie.app)',
    };
  }
  return {
    ok: true,
    config: Object.freeze({
      clientId,
      clientSecret,
      redirectUri: `${base}${CONNECTOR_OAUTH_CALLBACK_PATH}`,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Signed single-use `state` — CSRF token + identity carrier
// ─────────────────────────────────────────────────────────────────────

/** Consent must complete within this window. */
export const CONNECTOR_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface ConnectorOAuthStateClaims {
  readonly tenantId: string;
  readonly userId: string;
  readonly connectorId: string;
}

export interface VerifiedConnectorOAuthState extends ConnectorOAuthStateClaims {
  /** Single-use nonce — consumed by the replay guard on callback. */
  readonly nonce: string;
  /** Absolute expiry (ms epoch) the encoder stamped. */
  readonly exp: number;
}

const StatePayloadSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  connectorId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  nonce: z.string().min(8).max(64),
  exp: z.number().int().positive(),
});

/**
 * The signing secret reuses the cipher key material so no NEW secret is
 * required (mirrors calendar oauth); CONNECTOR_OAUTH_STATE_SECRET overrides.
 */
function stateSecret(env: NodeJS.ProcessEnv): string | null {
  const secret =
    env.CONNECTOR_OAUTH_STATE_SECRET ??
    env.CONNECTOR_TOKEN_KEY ??
    env.ENCRYPTION_MASTER_KEY;
  if (!secret || secret.trim().length === 0) return null;
  return secret;
}

/** True when state signing is possible (a secret is configured). */
export function isStateSigningProvisioned(env: NodeJS.ProcessEnv): boolean {
  return stateSecret(env) !== null;
}

function macOf(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Build a signed `state` string. Throws when no signing secret is set —
 * callers gate on `isStateSigningProvisioned` first (honest degrade).
 */
export function encodeConnectorOAuthState(
  claims: ConnectorOAuthStateClaims,
  env: NodeJS.ProcessEnv,
  nowMs: number = Date.now(),
): string {
  const secret = stateSecret(env);
  if (!secret) {
    throw new Error(
      'connector OAuth: no CONNECTOR_OAUTH_STATE_SECRET / CONNECTOR_TOKEN_KEY' +
        ' / ENCRYPTION_MASTER_KEY for state signing',
    );
  }
  const payload: VerifiedConnectorOAuthState = {
    ...claims,
    nonce: randomBytes(16).toString('base64url'),
    exp: nowMs + CONNECTOR_OAUTH_STATE_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${payloadB64}.${macOf(payloadB64, secret)}`;
}

/**
 * Verify + decode a `state` string. Null on ANY tamper, malformed shape,
 * missing secret, or expiry — the callback rejects when this is null.
 * MAC comparison is constant-time.
 */
export function decodeConnectorOAuthState(
  raw: string,
  env: NodeJS.ProcessEnv,
  nowMs: number = Date.now(),
): VerifiedConnectorOAuthState | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, mac] = parts as [string, string];
  const secret = stateSecret(env);
  if (!secret) return null;
  const expected = macOf(payloadB64, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = StatePayloadSchema.safeParse(
      JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')),
    );
    if (!parsed.success) return null;
    if (parsed.data.exp <= nowMs) return null;
    return Object.freeze({ ...parsed.data });
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Single-use replay guard (v1: bounded in-process map with TTL)
// ─────────────────────────────────────────────────────────────────────

export interface OAuthStateReplayGuard {
  /**
   * Atomically consume a nonce. True exactly once per nonce within its
   * TTL window; false on every replay.
   */
  consume(nonce: string, expMs: number): boolean;
}

/**
 * SAME-PROCESS FAST-PATH ONLY (not the authority): this map cannot see a
 * consumption that happened on another replica. The cluster-wide replay
 * authority is the DURABLE Postgres consume in
 * `composition/oauth-state-nonce-store.ts` (migration 0343 — INSERT … ON
 * CONFLICT DO NOTHING on the nonce), which the callback runs AFTER this
 * fast-path. Expired states are independently rejected by the signature TTL.
 */
export function createOAuthStateReplayGuard(opts?: {
  readonly maxEntries?: number;
  readonly now?: () => number;
}): OAuthStateReplayGuard {
  const maxEntries = opts?.maxEntries ?? 5000;
  const now = opts?.now ?? Date.now;
  // Encapsulated mutable cache — insertion order doubles as eviction order.
  const consumed = new Map<string, number>();

  const prune = (nowMs: number): void => {
    for (const [nonce, exp] of consumed) {
      if (exp <= nowMs) consumed.delete(nonce);
    }
    // Bound memory even under a flood of long-TTL states.
    while (consumed.size >= maxEntries) {
      const oldest = consumed.keys().next().value;
      if (oldest === undefined) break;
      consumed.delete(oldest);
    }
  };

  return {
    consume(nonce: string, expMs: number): boolean {
      const nowMs = now();
      prune(nowMs);
      if (consumed.has(nonce)) return false;
      consumed.set(nonce, expMs);
      return true;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Authorize-URL builder
// ─────────────────────────────────────────────────────────────────────

/** Build the provider consent URL — pure string assembly, no I/O. */
export function buildConnectorAuthorizeUrl(args: {
  readonly descriptor: ConnectorOAuthDescriptor;
  readonly config: ConnectorOAuthProviderConfig;
  readonly state: string;
}): string {
  const { descriptor, config, state } = args;
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: descriptor.scopes.join(descriptor.scopeSeparator),
    redirect_uri: config.redirectUri,
    state,
    ...(descriptor.extraAuthorizeParams ?? {}),
  });
  return `${descriptor.authorizeUrl}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────
// Authorization-code exchange engine
// ─────────────────────────────────────────────────────────────────────

export type ConnectorTokenExchangeResult =
  | { readonly ok: true; readonly tokens: MappedConnectorTokens }
  | { readonly ok: false; readonly reason: string };

/**
 * Exchange the consent code for tokens at the descriptor's token endpoint.
 * The client_secret rides ONLY in the form body to the provider; every
 * failure path returns a token-free reason. The raw payload is consumed by
 * `mapTokenResponse` and never returned.
 */
export async function exchangeConnectorAuthorizationCode(args: {
  readonly descriptor: ConnectorOAuthDescriptor;
  readonly config: ConnectorOAuthProviderConfig;
  readonly code: string;
  readonly fetchImpl: typeof fetch;
}): Promise<ConnectorTokenExchangeResult> {
  const { descriptor, config, code, fetchImpl } = args;
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    ...(descriptor.extraTokenParams ?? {}),
  }).toString();

  let res: Response;
  try {
    res = await fetchImpl(descriptor.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `token endpoint transport error: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    };
  }
  if (!res.ok) {
    return { ok: false, reason: `token endpoint HTTP ${res.status}` };
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, reason: 'token endpoint returned a non-JSON body' };
  }
  const mapped = descriptor.mapTokenResponse(payload);
  if (!mapped.ok) {
    return { ok: false, reason: mapped.reason };
  }
  return { ok: true, tokens: mapped.tokens };
}
