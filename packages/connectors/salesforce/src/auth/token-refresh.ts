/**
 * Salesforce OAuth refresh.
 *
 * Implements the `refresh_token` grant against
 * `https://{instance}/services/oauth2/token`. Tokens are NEVER held
 * in memory across sync runs — the broker fetches fresh creds per
 * invocation. This function is the bottom half of that broker.
 *
 * Reference: Salesforce, *OAuth 2.0 Refresh Token Flow* —
 * https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_refresh_token_flow.htm
 */

import type { FetcherPort, SalesforceInstall } from '../types.js';
import type { OAuth2TokenResult } from './oauth.js';

export interface RefreshTokenParams {
  readonly install: SalesforceInstall;
  readonly refreshToken: string;
  readonly fetcher: FetcherPort;
  readonly nowMs: () => number;
}

/**
 * Encrypted-at-rest token storage port. Production wires to the
 * tenant-bound DEK / KMS stack; tests inject an in-memory stub.
 */
export interface EncryptedTokenStoragePort {
  readonly load: (params: {
    readonly tenantId: string;
    readonly account: string;
  }) => Promise<{ readonly refreshToken: string } | null>;
  readonly save: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly token: OAuth2TokenResult;
  }) => Promise<void>;
}

const DEFAULT_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function refreshAccessToken(
  params: RefreshTokenParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    refresh_token: params.refreshToken,
  });
  const url = new URL(
    '/services/oauth2/token',
    params.install.instanceUrl,
  ).toString();
  const res = await params.fetcher.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Salesforce refresh failed: status=${res.status}`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Salesforce refresh response was not JSON');
  }
  if (typeof json !== 'object' || json === null) {
    throw new Error('Salesforce refresh response had wrong shape');
  }
  const j = json as Record<string, unknown>;
  const access = typeof j.access_token === 'string' ? j.access_token : '';
  const instance = typeof j.instance_url === 'string' ? j.instance_url : params.install.instanceUrl;
  const tokenType = typeof j.token_type === 'string' ? j.token_type : 'Bearer';
  if (access === '') {
    throw new Error('Salesforce refresh response missing access_token');
  }
  return {
    accessToken: access,
    refreshToken: params.refreshToken, // Salesforce reissues only when policy dictates
    instanceUrl: instance,
    expiresAt: new Date(params.nowMs() + DEFAULT_LIFETIME_MS).toISOString(),
    tokenType,
  };
}
