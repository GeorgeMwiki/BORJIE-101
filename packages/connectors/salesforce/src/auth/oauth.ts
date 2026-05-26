/**
 * Salesforce OAuth 2.0 — Web Server Flow.
 *
 * Reference: Salesforce, *OAuth 2.0 Web Server Flow for Web App
 * Integration* — https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm
 *
 * Two surfaces:
 *   - `buildAuthorizeUrl`  — composes the initial 302 to login.salesforce.com.
 *   - `exchangeCode`       — code -> access+refresh token. Returns
 *                            `OAuth2TokenResult` for the broker to seal
 *                            into encrypted storage.
 *
 * Pure functions. Network calls are delegated to the injected `fetcher`
 * port so unit tests can drive the flow deterministically.
 */

import type { FetcherPort, SalesforceInstall } from '../types.js';

export interface OAuth2AuthorizeParams {
  readonly install: SalesforceInstall;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope?: string;
}

export interface OAuth2TokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly instanceUrl: string;
  readonly expiresAt: string; // ISO
  readonly tokenType: string;
}

export interface OAuth2ExchangeParams {
  readonly install: SalesforceInstall;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetcher: FetcherPort;
  /** Injectable clock so tests are deterministic. */
  readonly nowMs: () => number;
}

const DEFAULT_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours (Salesforce default)

export function buildAuthorizeUrl(params: OAuth2AuthorizeParams): string {
  const url = new URL('/services/oauth2/authorize', params.install.instanceUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.install.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set(
    'scope',
    params.scope ?? 'api refresh_token offline_access',
  );
  return url.toString();
}

export async function exchangeCode(
  params: OAuth2ExchangeParams,
): Promise<OAuth2TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.install.clientId,
    client_secret: params.install.clientSecret,
    redirect_uri: params.redirectUri,
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
    throw new Error(`Salesforce token exchange failed: status=${res.status}`);
  }
  const text = await res.text();
  const parsed = parseTokenResponse(text);
  const expiresAt = new Date(params.nowMs() + DEFAULT_LIFETIME_MS).toISOString();
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    instanceUrl: parsed.instance_url,
    expiresAt,
    tokenType: parsed.token_type,
  };
}

interface SalesforceTokenJson {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly instance_url: string;
  readonly token_type: string;
}

function parseTokenResponse(text: string): SalesforceTokenJson {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Salesforce token response was not JSON');
  }
  if (typeof json !== 'object' || json === null) {
    throw new Error('Salesforce token response had wrong shape');
  }
  const j = json as Record<string, unknown>;
  if (
    typeof j.access_token !== 'string' ||
    typeof j.refresh_token !== 'string' ||
    typeof j.instance_url !== 'string' ||
    typeof j.token_type !== 'string'
  ) {
    throw new Error('Salesforce token response missing required fields');
  }
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    instance_url: j.instance_url,
    token_type: j.token_type,
  };
}
