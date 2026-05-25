/**
 * M-Pesa Daraja 3.0 — OAuth client + base-URL resolution.
 *
 * Sole responsibility: produce an authenticated `BaseConnector` instance
 * wired with token caching, rate-limit, circuit-breaker, retry, audit. The
 * STK Push and webhook modules consume this — they do not own auth.
 *
 * Token caching: Daraja's `/oauth/v1/generate?grant_type=client_credentials`
 * returns a Bearer good for `expires_in` seconds (typically 3599). We cache
 * inside the closure (per-adapter-instance — tenants get separate tokens)
 * and refresh 60s before expiry to avoid races.
 *
 * All IO injectable for deterministic tests. No global state. No real
 * network in CI — tests pass a `fetch` mock.
 */

import {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type ConnectorEventSink,
} from '../../base-connector.js';
import { MPESA_BASE_URLS, type MpesaCredentials, type MpesaEnv } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface MpesaClientDeps {
  readonly env?: MpesaEnv;
  /** Optional override; wins over `env`. */
  readonly baseUrl?: string;
  readonly credentials: MpesaCredentials;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface MpesaClient {
  readonly connector: BaseConnector;
  readonly env: MpesaEnv;
  readonly baseUrl: string;
  readonly credentials: MpesaCredentials;
  /** Diagnostic — token expiry epoch ms (or null when no token cached). */
  tokenExpiryMs(): number | null;
  /** Test-only: force token invalidation (e.g. after 401). */
  invalidateToken(): void;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

interface TokenCacheState {
  token: string | null;
  expiresAtMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

/**
 * Read credentials + env from `process.env`. Throws if anything missing.
 * Convenience for production wiring; tests build credentials inline.
 */
export function loadMpesaCredentialsFromEnv(): {
  readonly credentials: MpesaCredentials;
  readonly env: MpesaEnv;
} {
  const env = (process.env['MPESA_ENV'] ?? 'sandbox') as MpesaEnv;
  if (env !== 'sandbox' && env !== 'production') {
    throw new Error(`loadMpesaCredentialsFromEnv: invalid MPESA_ENV="${String(env)}"`);
  }
  const required = [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_BASE_URL',
  ] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `loadMpesaCredentialsFromEnv: missing env vars: ${missing.join(', ')}`,
    );
  }
  return {
    env,
    credentials: {
      consumerKey: process.env['MPESA_CONSUMER_KEY'] as string,
      consumerSecret: process.env['MPESA_CONSUMER_SECRET'] as string,
      shortCode: process.env['MPESA_SHORTCODE'] as string,
      passKey: process.env['MPESA_PASSKEY'] as string,
      callbackBaseUrl: process.env['MPESA_CALLBACK_BASE_URL'] as string,
    },
  };
}

export function createMpesaClient(deps: MpesaClientDeps): MpesaClient {
  const env: MpesaEnv = deps.env ?? 'sandbox';
  const baseUrl = deps.baseUrl ?? MPESA_BASE_URLS[env];
  const credentials = deps.credentials;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const clock = deps.clock ?? Date.now;

  if (!fetchImpl) {
    throw new Error('createMpesaClient: no fetch implementation available');
  }
  if (!credentials.consumerKey || !credentials.consumerSecret) {
    throw new Error(
      'createMpesaClient: consumerKey and consumerSecret are required',
    );
  }
  if (!credentials.shortCode || !credentials.passKey) {
    throw new Error('createMpesaClient: shortCode and passKey are required');
  }
  if (!credentials.callbackBaseUrl) {
    throw new Error('createMpesaClient: callbackBaseUrl is required');
  }

  const tokenCache: TokenCacheState = { token: null, expiresAtMs: 0 };

  async function fetchToken(): Promise<string> {
    const credPair = base64(
      `${credentials.consumerKey}:${credentials.consumerSecret}`,
    );
    const url = `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credPair}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`mpesa-client: oauth ${res.status}`);
    }
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: string | number;
    };
    if (!body.access_token) {
      throw new Error('mpesa-client: oauth response missing access_token');
    }
    const lifetimeSec = Number(body.expires_in ?? 3599);
    // Refresh 60s before expiry to avoid race.
    return Object.assign(tokenCache, {
      token: body.access_token,
      expiresAtMs: clock() + Math.max(60, lifetimeSec - 60) * 1000,
    }).token as string;
  }

  async function getToken(): Promise<string> {
    if (tokenCache.token && clock() < tokenCache.expiresAtMs) {
      return tokenCache.token;
    }
    return fetchToken();
  }

  function invalidateToken(): void {
    tokenCache.token = null;
    tokenCache.expiresAtMs = 0;
  }

  const connector = createBaseConnector({
    config: {
      id: 'mpesa-daraja-3',
      displayName: `M-Pesa Daraja 3.0 (${env})`,
      baseUrl,
      auth: {
        kind: 'oauth2',
        accessTokenProvider: getToken,
        refresh: async () => {
          invalidateToken();
          await fetchToken();
        },
      },
      rateLimit: { rpm: 600, burst: 60 },
      circuitBreaker: { errorThreshold: 5, halfOpenAfterMs: 30_000 },
      retry: { maxAttempts: 3, initialDelayMs: 250 },
      timeoutMs: 12_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  return {
    connector,
    env,
    baseUrl,
    credentials,
    tokenExpiryMs: () => (tokenCache.token ? tokenCache.expiresAtMs : null),
    invalidateToken,
  };
}
