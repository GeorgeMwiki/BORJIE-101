/**
 * Notion public OAuth 2.0 install flow.
 *
 * The connector receives an authorisation code from Notion's redirect
 * and exchanges it at `https://api.notion.com/v1/oauth/token` for a
 * long-lived access_token plus workspace metadata.
 *
 * Reference: Notion — "Authorization"
 *   https://developers.notion.com/docs/authorization
 *   (visited 2026-05-26).
 */

import type { EncryptedCredentialStore, Fetcher } from '../types.js';

const TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

export interface NotionOAuthExchangeInput {
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface NotionTokenResponse {
  readonly access_token: string;
  readonly workspace_id: string;
  readonly workspace_name?: string;
  readonly workspace_icon?: string;
  readonly bot_id: string;
}

export interface NotionCredentials {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceName: string | null;
  readonly encryptedAccessToken: Uint8Array;
  readonly botId: string;
  readonly createdAt: string;
}

export interface NotionInstallDeps {
  readonly fetcher: Fetcher;
  readonly store: EncryptedCredentialStore;
  readonly nowIso: () => string;
}

/**
 * Run the OAuth code-exchange and seal the resulting token.
 */
export async function exchangeNotionAuthCode(
  tenantId: string,
  input: NotionOAuthExchangeInput,
  deps: NotionInstallDeps,
): Promise<NotionCredentials> {
  if (input.code.length === 0) {
    throw new Error('OAuth code must be non-empty');
  }
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const authHeader =
    'Basic ' +
    Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64');
  const req = new Request(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });
  const res = await deps.fetcher(req);
  if (!res.ok) {
    throw new Error(`Notion token exchange failed: ${res.status}`);
  }
  const payload = (await res.json()) as NotionTokenResponse;
  if (!payload.access_token) {
    throw new Error('Notion token response missing access_token');
  }
  const encryptedAccessToken = await deps.store.seal(payload.access_token);
  return {
    tenantId,
    workspaceId: payload.workspace_id,
    workspaceName: payload.workspace_name ?? null,
    encryptedAccessToken,
    botId: payload.bot_id,
    createdAt: deps.nowIso(),
  };
}
