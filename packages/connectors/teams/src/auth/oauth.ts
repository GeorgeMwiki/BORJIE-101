/**
 * Microsoft Identity Platform — client credentials flow (application
 * permissions for unattended Graph ingest).
 *
 * Reference: Microsoft, *OAuth 2.0 client credentials flow* —
 * https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-client-creds-grant-flow
 */

import type { FetcherPort, TeamsInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: TeamsInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly tokenType: string;
}

export interface OAuth2ExchangeParams {
  readonly install: TeamsInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

const DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(params.install.account)}/oauth2/v2.0/authorize`,
  );
  url.searchParams.set('client_id', params.install.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', params.scope ?? 'ChannelMessage.Read.All Team.ReadBasic.All OnlineMeetings.Read.All offline_access');
  url.searchParams.set('response_mode', 'query');
  return url.toString();
}

/**
 * Exchanges a (delegated) auth code for an access + refresh token, OR
 * if `code` is the literal string `__client_credentials__`, runs the
 * unattended client-credentials grant. Production composition roots
 * choose between the two by configuration.
 */
export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const isClientCreds = params.code === '__client_credentials__';
  const body = isClientCreds
    ? new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: params.install.clientId,
        client_secret: params.install.clientSecret,
        scope: DEFAULT_SCOPE,
      })
    : new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: params.install.clientId,
        client_secret: params.install.clientSecret,
        code: params.code,
        redirect_uri: params.redirectUri,
      });
  const url = `https://login.microsoftonline.com/${encodeURIComponent(params.install.account)}/oauth2/v2.0/token`;
  const res = await params.fetcher.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Teams token exchange failed: status=${res.status}`);
  }
  const json = JSON.parse(await res.text()) as Record<string, unknown>;
  const access = typeof json.access_token === 'string' ? json.access_token : '';
  const refresh = typeof json.refresh_token === 'string' ? json.refresh_token : '';
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  if (access === '') throw new Error('Teams token response missing access_token');
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(params.nowMs() + expiresIn * 1000).toISOString(),
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}
