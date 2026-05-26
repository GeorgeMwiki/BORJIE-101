/**
 * X API v2 OAuth 2.0 with PKCE.
 *
 * Reference: X Developer Platform, *OAuth 2.0 Authorization Code Flow
 * with PKCE*,
 * https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code,
 * accessed 2026-05-25.
 *
 * Scopes (P2 read-only):
 *   - tweet.read
 *   - users.read
 *   - offline.access  (required for refresh tokens)
 *
 * tweet.write is *not* requested.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { FetcherPort, XInstall } from '../types.js';

const AUTH_BASE = 'https://x.com/i/oauth2/authorize';
const TOKEN_BASE = 'https://api.x.com/2/oauth2/token';

const DEFAULT_SCOPE = ['tweet.read', 'users.read', 'offline.access'].join(' ');

export interface PkceChallenge {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

/**
 * Build the PKCE pair. `codeVerifier` must be persisted on the
 * authorising session to be presented at the token exchange.
 */
export function generatePkce(
  randomBytesFn: (n: number) => Buffer = randomBytes,
): PkceChallenge {
  const verifier = base64Url(randomBytesFn(32));
  const challenge = base64Url(
    createHash('sha256').update(verifier).digest(),
  );
  return Object.freeze({
    codeVerifier: verifier,
    codeChallenge: challenge,
  });
}

function base64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export interface OAuth2AuthorizeParams {
  readonly install: XInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly pkce: PkceChallenge;
  readonly scope?: string;
}

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const u = new URL(AUTH_BASE);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', params.install.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('scope', params.scope ?? DEFAULT_SCOPE);
  u.searchParams.set('state', params.state);
  u.searchParams.set('code_challenge', params.pkce.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly tokenType: string;
}

export interface OAuth2ExchangeParams {
  readonly install: XInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: params.install.clientId,
  });
  const basic = Buffer.from(
    `${params.install.clientId}:${params.install.clientSecret}`,
  ).toString('base64');
  const res = await params.fetcher.fetch(TOKEN_BASE, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status !== 200) {
    throw new Error(`X OAuth exchange failed: ${res.status}`);
  }
  const json = JSON.parse(await res.text()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (
    typeof json.access_token !== 'string' ||
    typeof json.refresh_token !== 'string'
  ) {
    throw new Error('X OAuth response missing tokens');
  }
  const expiresInSec =
    typeof json.expires_in === 'number' ? json.expires_in : 7200;
  return Object.freeze({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(params.nowMs() + expiresInSec * 1000).toISOString(),
    tokenType: json.token_type ?? 'bearer',
  });
}
