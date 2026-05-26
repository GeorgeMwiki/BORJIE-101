/**
 * Zoom Server-to-Server OAuth (`account_credentials` grant).
 *
 * Reference: Zoom, *Server-to-Server OAuth* —
 * https://developers.zoom.us/docs/internal-apps/s2s-oauth/
 *
 * Zoom S2S has no refresh token — every fetch of a new access token
 * uses HTTP Basic auth (client_id:client_secret) with
 * grant_type=account_credentials&account_id=<account>.
 */

import type { FetcherPort, ZoomInstall } from '../types.js';

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly tokenType: string;
  readonly scope: string;
}

export interface OAuth2ExchangeParams {
  readonly install: ZoomInstall;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

/**
 * Fetches a fresh access token via Zoom's account_credentials grant.
 * There is no refresh token: callers re-invoke this when the token
 * approaches `expiresAt`.
 */
export async function fetchAccountAccessToken(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const basic = Buffer.from(
    `${params.install.clientId}:${params.install.clientSecret}`,
  ).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'account_credentials',
    account_id: params.install.account,
  });
  const res = await params.fetcher.fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Zoom S2S token fetch failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  if (access === '') throw new Error('Zoom token response missing access_token');
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  return {
    accessToken: access,
    expiresAt: new Date(params.nowMs() + expiresIn * 1000).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    scope: typeof json.scope === 'string' ? json.scope : '',
  };
}
