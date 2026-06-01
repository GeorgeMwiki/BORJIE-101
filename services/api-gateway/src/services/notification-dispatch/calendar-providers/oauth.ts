/**
 * Calendar OAuth — provider config, authorize-URL builder, and the
 * authorization-code / refresh-token exchanges for Google + Microsoft.
 *
 * Reference:
 *   - Google "OAuth 2.0 for Web Server Applications"
 *     https://developers.google.com/identity/protocols/oauth2/web-server
 *   - Microsoft identity platform "Authorization code flow"
 *     https://learn.microsoft.com/azure/active-directory/develop/v2-oauth2-auth-code-flow
 *
 * Both flows request OFFLINE access (a refresh token) + a calendar scope so the
 * sync worker can create/patch events long after the consent screen.
 *
 * Secrets (env ONLY — no hardcoding):
 *   - Google:    GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *   - Microsoft: MS_OAUTH_CLIENT_ID, MS_OAUTH_CLIENT_SECRET, MS_OAUTH_TENANT
 *                (tenant defaults to 'common' for multi-tenant + personal MSAs)
 *   - Shared:    CALENDAR_OAUTH_REDIRECT_BASE (e.g. https://api.borjie.app),
 *                the callback path is appended → `/api/v1/owner/calendar/callback`
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { CalendarProvider } from '@borjie/database/schemas';

// ─────────────────────────────────────────────────────────────────────
// Signed OAuth `state` — CSRF + identity carrier across the redirect
//
// The consent redirect leaves our auth context behind; the callback returns
// with no JWT. So we encode (tenant,user,provider,nonce,exp) into an
// HMAC-signed, URL-safe `state` value. The callback verifies the signature
// (constant-time) + expiry before trusting any of it. The signing secret is
// derived from the same env key material as the token cipher, so no new secret
// is required; an explicit CALENDAR_OAUTH_STATE_SECRET overrides when set.
// ─────────────────────────────────────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000; // consent must complete within 10 min

export interface CalendarOAuthState {
  readonly tenantId: string;
  readonly userId: string;
  readonly provider: CalendarProvider;
}

interface SignedStatePayload extends CalendarOAuthState {
  readonly nonce: string;
  readonly exp: number;
}

function stateSecret(env: NodeJS.ProcessEnv): string {
  const secret =
    env.CALENDAR_OAUTH_STATE_SECRET ??
    env.CALENDAR_TOKEN_KEY ??
    env.ENCRYPTION_MASTER_KEY;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'calendar OAuth: no CALENDAR_OAUTH_STATE_SECRET / CALENDAR_TOKEN_KEY / ENCRYPTION_MASTER_KEY for state signing',
    );
  }
  return secret;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Build a signed `state` string for the authorize redirect. */
export function encodeOAuthState(
  state: CalendarOAuthState,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): string {
  const secret = stateSecret(env);
  const payload: SignedStatePayload = {
    ...state,
    nonce: randomBytes(12).toString('base64url'),
    exp: nowMs + STATE_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify + decode a `state` string. Returns null on any tamper, malformed
 * shape, or expiry — the callback rejects the request when this is null.
 */
export function decodeOAuthState(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): CalendarOAuthState | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, mac] = parts as [string, string];
  let secret: string;
  try {
    secret = stateSecret(env);
  } catch {
    return null;
  }
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as Partial<SignedStatePayload>;
    if (
      typeof parsed.tenantId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      (parsed.provider !== 'google' && parsed.provider !== 'microsoft') ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < nowMs
    ) {
      return null;
    }
    return {
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      provider: parsed.provider,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Endpoints + scopes
// ─────────────────────────────────────────────────────────────────────

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
] as const;

/** MS endpoints are tenant-parameterised; `common` covers work + personal. */
export function microsoftAuthUrl(msTenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(msTenant)}/oauth2/v2.0/authorize`;
}
export function microsoftTokenUrl(msTenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(msTenant)}/oauth2/v2.0/token`;
}
export const MICROSOFT_CALENDAR_SCOPES = [
  'offline_access',
  'openid',
  'email',
  'Calendars.ReadWrite',
] as const;

export const CALLBACK_PATH = '/api/v1/owner/calendar/callback';

// ─────────────────────────────────────────────────────────────────────
// Config (read from env at composition time)
// ─────────────────────────────────────────────────────────────────────

export interface CalendarOAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Microsoft only — directory tenant ('common' default). Ignored for Google. */
  readonly msTenant: string;
}

export interface CalendarOAuthConfig {
  readonly redirectUri: string;
  readonly google: CalendarOAuthProviderConfig | null;
  readonly microsoft: CalendarOAuthProviderConfig | null;
}

/**
 * Build the OAuth config from env. A provider is only enabled when BOTH its
 * client id and secret are present. `redirectUri` is derived from
 * `CALENDAR_OAUTH_REDIRECT_BASE` + the canonical callback path.
 */
export function readCalendarOAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CalendarOAuthConfig {
  const base = (env.CALENDAR_OAUTH_REDIRECT_BASE ?? '').trim().replace(/\/+$/, '');
  const redirectUri = base ? `${base}${CALLBACK_PATH}` : '';

  const google =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          msTenant: 'common',
        }
      : null;

  const microsoft =
    env.MS_OAUTH_CLIENT_ID && env.MS_OAUTH_CLIENT_SECRET
      ? {
          clientId: env.MS_OAUTH_CLIENT_ID,
          clientSecret: env.MS_OAUTH_CLIENT_SECRET,
          msTenant: (env.MS_OAUTH_TENANT ?? 'common').trim() || 'common',
        }
      : null;

  return { redirectUri, google, microsoft };
}

export function providerConfig(
  config: CalendarOAuthConfig,
  provider: CalendarProvider,
): CalendarOAuthProviderConfig | null {
  return provider === 'google' ? config.google : config.microsoft;
}

// ─────────────────────────────────────────────────────────────────────
// Authorize-URL builder
// ─────────────────────────────────────────────────────────────────────

export interface AuthorizeUrlInput {
  readonly provider: CalendarProvider;
  readonly config: CalendarOAuthConfig;
  /** Opaque, signed CSRF/identity state echoed back to the callback. */
  readonly state: string;
}

/**
 * Build the provider consent URL. Google asks for `access_type=offline` +
 * `prompt=consent` so a refresh token is always returned (Google omits it on
 * re-consent otherwise). Microsoft gets the refresh token via the
 * `offline_access` scope.
 */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const pc = providerConfig(input.config, input.provider);
  if (!pc) {
    throw new Error(`calendar OAuth provider not configured: ${input.provider}`);
  }
  if (!input.config.redirectUri) {
    throw new Error('calendar OAuth redirect URI not configured');
  }
  if (input.provider === 'google') {
    const params = new URLSearchParams({
      client_id: pc.clientId,
      redirect_uri: input.config.redirectUri,
      response_type: 'code',
      scope: GOOGLE_CALENDAR_SCOPES.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: input.state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }
  // microsoft
  const params = new URLSearchParams({
    client_id: pc.clientId,
    redirect_uri: input.config.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
    state: input.state,
  });
  return `${microsoftAuthUrl(pc.msTenant)}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────
// Token responses + exchanges
// ─────────────────────────────────────────────────────────────────────

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export interface CalendarTokenSet {
  readonly accessToken: string;
  /** Present on the code exchange; may be absent on some refreshes. */
  readonly refreshToken: string | null;
  /** Absolute expiry (epoch ms). */
  readonly expiresAt: number;
  readonly scope: string | null;
}

export type Fetcher = (
  input: string,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ExchangeDeps {
  readonly fetcher?: Fetcher;
  readonly now?: () => number;
}

function tokenUrlFor(
  provider: CalendarProvider,
  pc: CalendarOAuthProviderConfig,
): string {
  return provider === 'google'
    ? GOOGLE_TOKEN_URL
    : microsoftTokenUrl(pc.msTenant);
}

function defaultFetcher(): Fetcher {
  return fetch as unknown as Fetcher;
}

function toTokenSet(
  payload: z.infer<typeof tokenResponseSchema>,
  nowMs: number,
): CalendarTokenSet {
  const ttlMs = (payload.expires_in ?? 3600) * 1000;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: nowMs + ttlMs,
    scope: payload.scope ?? null,
  };
}

/**
 * Exchange an authorization code for an access + refresh token. Throws on a
 * non-2xx or a response missing a refresh token (offline access is required —
 * a connection without a refresh token cannot survive token expiry).
 */
export async function exchangeAuthorizationCode(args: {
  readonly provider: CalendarProvider;
  readonly config: CalendarOAuthConfig;
  readonly code: string;
  readonly deps?: ExchangeDeps;
}): Promise<CalendarTokenSet> {
  const pc = providerConfig(args.config, args.provider);
  if (!pc) {
    throw new Error(`calendar OAuth provider not configured: ${args.provider}`);
  }
  if (args.code.trim().length === 0) {
    throw new Error('calendar OAuth: authorization code must be non-empty');
  }
  const fetcher = args.deps?.fetcher ?? defaultFetcher();
  const now = args.deps?.now ?? (() => Date.now());

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    client_id: pc.clientId,
    client_secret: pc.clientSecret,
    redirect_uri: args.config.redirectUri,
  });
  if (args.provider === 'microsoft') {
    body.set('scope', MICROSOFT_CALENDAR_SCOPES.join(' '));
  }

  const res = await fetcher(tokenUrlFor(args.provider, pc), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `calendar OAuth code exchange failed (${args.provider}): ${res.status}`,
    );
  }
  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(
      `calendar OAuth code exchange returned an unexpected token payload (${args.provider})`,
    );
  }
  if (!parsed.data.refresh_token) {
    throw new Error(
      `calendar OAuth code exchange did not return a refresh token (${args.provider}); offline access is required`,
    );
  }
  return toTokenSet(parsed.data, now());
}

/**
 * Mint a fresh access token from a refresh token. The refresh token may rotate
 * (Microsoft commonly rotates); the returned `refreshToken` reflects the new
 * one when present, else `null` so the caller keeps the existing sealed value.
 */
export async function refreshAccessToken(args: {
  readonly provider: CalendarProvider;
  readonly config: CalendarOAuthConfig;
  readonly refreshToken: string;
  readonly deps?: ExchangeDeps;
}): Promise<CalendarTokenSet> {
  const pc = providerConfig(args.config, args.provider);
  if (!pc) {
    throw new Error(`calendar OAuth provider not configured: ${args.provider}`);
  }
  const fetcher = args.deps?.fetcher ?? defaultFetcher();
  const now = args.deps?.now ?? (() => Date.now());

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: pc.clientId,
    client_secret: pc.clientSecret,
  });
  if (args.provider === 'microsoft') {
    body.set('scope', MICROSOFT_CALENDAR_SCOPES.join(' '));
  }

  const res = await fetcher(tokenUrlFor(args.provider, pc), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `calendar OAuth refresh failed (${args.provider}): ${res.status}`,
    );
  }
  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(
      `calendar OAuth refresh returned an unexpected token payload (${args.provider})`,
    );
  }
  return toTokenSet(parsed.data, now());
}
