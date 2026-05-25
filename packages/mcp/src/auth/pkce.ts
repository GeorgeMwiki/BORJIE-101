/**
 * OAuth 2.1 + PKCE helper for SSE / streamable-http MCP transports.
 *
 * Implements the Authorization-Code-with-PKCE flow per RFC 7636. The
 * caller is responsible for the actual redirect / user consent; we
 * provide:
 *
 *  - `createOAuthPKCEFlow(...)` returns helpers for generating the
 *    code verifier, deriving the challenge, building the authorize URL,
 *    and exchanging the code for tokens.
 *  - `createBearerAuth(...)` is a trivial bearer-token holder for cases
 *    where the OAuth dance has already happened.
 *  - `createServiceTokenAuth(...)` is for server-to-server flows with
 *    rotation handled by an injected `ServiceTokenStore`.
 *
 * All flows return an `AuthProvider` that produces an `Authorization`
 * header value per request.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface AuthProvider {
  /**
   * Returns the `Authorization` header value (e.g. `Bearer <token>`) for the
   * next request. May refresh internally — caller does not need to know.
   */
  getAuthorizationHeader(): Promise<string>;
}

// ──────────────────────────────────────────────────────────────────────────────
// OAuth 2.1 + PKCE
// ──────────────────────────────────────────────────────────────────────────────

export interface OAuthPKCEConfig {
  readonly clientId: string;
  readonly authzServer: {
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
  };
  readonly redirectUri: string;
  readonly scopes: ReadonlyArray<string>;
  readonly fetchImpl?: typeof fetch;
}

export interface PKCEChallenge {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
  readonly state: string;
}

export interface OAuthPKCEFlow {
  /** Generate a fresh verifier + challenge + state pair. */
  startChallenge(): PKCEChallenge;
  /** Build the authorize URL the user agent should redirect to. */
  buildAuthorizeUrl(challenge: PKCEChallenge): string;
  /**
   * Exchange an authorization code for tokens. Verifies state matches.
   * Returns an `AuthProvider` that will refresh the token automatically.
   */
  exchangeCode(opts: {
    readonly code: string;
    readonly state: string;
    readonly challenge: PKCEChallenge;
  }): Promise<AuthProvider & { readonly accessToken: string; readonly refreshToken?: string }>;
}

interface TokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly scope?: string;
}

export function createOAuthPKCEFlow(config: OAuthPKCEConfig): OAuthPKCEFlow {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    startChallenge(): PKCEChallenge {
      const codeVerifier = base64UrlEncode(randomBytes(64));
      const codeChallenge = base64UrlEncode(
        createHash('sha256').update(codeVerifier).digest(),
      );
      const state = base64UrlEncode(randomBytes(16));
      return {
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: 'S256',
        state,
      };
    },

    buildAuthorizeUrl(challenge: PKCEChallenge): string {
      const url = new URL(config.authzServer.authorizationEndpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('scope', config.scopes.join(' '));
      url.searchParams.set('state', challenge.state);
      url.searchParams.set('code_challenge', challenge.codeChallenge);
      url.searchParams.set('code_challenge_method', challenge.codeChallengeMethod);
      return url.toString();
    },

    async exchangeCode({ code, state, challenge }) {
      if (state !== challenge.state) {
        throw new Error('OAuth state mismatch — possible CSRF');
      }
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: challenge.codeVerifier,
      });
      const resp = await fetchImpl(config.authzServer.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
      });
      if (!resp.ok) {
        throw new Error(`OAuth token exchange failed: ${resp.status}`);
      }
      const tokens = (await resp.json()) as TokenResponse;

      let accessToken = tokens.access_token;
      let refreshToken = tokens.refresh_token;
      let expiresAt = tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : Number.POSITIVE_INFINITY;

      async function refresh(): Promise<void> {
        if (!refreshToken) {
          throw new Error('OAuth token expired and no refresh token available');
        }
        const refreshBody = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: config.clientId,
        });
        const refreshResp = await fetchImpl(config.authzServer.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: refreshBody,
        });
        if (!refreshResp.ok) {
          throw new Error(`OAuth refresh failed: ${refreshResp.status}`);
        }
        const refreshed = (await refreshResp.json()) as TokenResponse;
        accessToken = refreshed.access_token;
        if (refreshed.refresh_token) refreshToken = refreshed.refresh_token;
        expiresAt = refreshed.expires_in
          ? Date.now() + refreshed.expires_in * 1000
          : Number.POSITIVE_INFINITY;
      }

      // Build the provider — we use Object.defineProperty for the optional
      // refreshToken so exactOptionalPropertyTypes treats it as a true
      // optional that is *absent* rather than `undefined` when not issued.
      const provider = {
        get accessToken() {
          return accessToken;
        },
        async getAuthorizationHeader(): Promise<string> {
          if (Date.now() >= expiresAt - 10_000) await refresh();
          return `Bearer ${accessToken}`;
        },
      } as AuthProvider & { readonly accessToken: string; readonly refreshToken?: string };
      if (refreshToken !== undefined) {
        Object.defineProperty(provider, 'refreshToken', {
          get: () => refreshToken,
          enumerable: true,
        });
      }
      return provider;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Simple bearer
// ──────────────────────────────────────────────────────────────────────────────

export function createBearerAuth(opts: { readonly token: string }): AuthProvider {
  return {
    async getAuthorizationHeader(): Promise<string> {
      return `Bearer ${opts.token}`;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Service token (S2S with rotation)
// ──────────────────────────────────────────────────────────────────────────────

export interface ServiceTokenStore {
  getToken(): Promise<{ readonly token: string; readonly expiresAt?: number }>;
  /** Optional: rotate the token now and return the new one. */
  rotate?(): Promise<{ readonly token: string; readonly expiresAt?: number }>;
}

export function createServiceTokenAuth(opts: {
  readonly tokenStore: ServiceTokenStore;
}): AuthProvider {
  return {
    async getAuthorizationHeader(): Promise<string> {
      let { token, expiresAt } = await opts.tokenStore.getToken();
      if (expiresAt && Date.now() >= expiresAt - 5_000 && opts.tokenStore.rotate) {
        const rotated = await opts.tokenStore.rotate();
        token = rotated.token;
      }
      return `Bearer ${token}`;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// internals
// ──────────────────────────────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
