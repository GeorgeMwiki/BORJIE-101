/**
 * Slack token refresh.
 *
 * Slack OAuth v2 issues refresh tokens to apps that opt into token
 * rotation. For non-rotation apps, the bot token is long-lived and
 * this helper is a no-op (`kind: 'not-rotated'`). For rotation apps,
 * we POST to `https://slack.com/api/oauth.v2.access` with
 * `grant_type=refresh_token`.
 *
 * The boundary contract: this helper takes a plaintext refresh
 * token and returns a fresh plaintext access token + (optionally) a
 * rotated refresh token. The caller is responsible for sealing both
 * via the `CredentialCipher` before persistence.
 */

import {
  type Fetcher,
  type SlackOAuthTokensValidated,
  slackOAuthTokensSchema,
} from '../types.js';

const SLACK_OAUTH_URL = 'https://slack.com/api/oauth.v2.access';

/** Safety margin before `expires_at`. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface RefreshTokenInput {
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly nowIso: string;
}

export type RefreshTokenResult =
  | { readonly kind: 'ok'; readonly tokens: SlackOAuthTokensValidated }
  | { readonly kind: 'not-rotated' }
  | { readonly kind: 'not-yet-due' }
  | { readonly kind: 'invalid-grant'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export interface RefreshTokenDeps {
  readonly fetcher: Fetcher;
}

export function createTokenRefresher(
  deps: RefreshTokenDeps,
): (input: RefreshTokenInput) => Promise<RefreshTokenResult> {
  return async (input) => {
    if (input.refreshToken === null) return { kind: 'not-rotated' };

    if (input.expiresAt !== null) {
      const expiresAtMs = Date.parse(input.expiresAt);
      const nowMs = Date.parse(input.nowIso);
      if (!Number.isNaN(expiresAtMs) && !Number.isNaN(nowMs)) {
        if (expiresAtMs - nowMs > TOKEN_REFRESH_MARGIN_MS) {
          return { kind: 'not-yet-due' };
        }
      }
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    }).toString();

    try {
      const res = await deps.fetcher({
        url: SLACK_OAUTH_URL,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      });
      if (!res.ok) {
        return { kind: 'upstream-error', status: res.status, message: res.statusText };
      }
      const payload = (await res.json()) as Record<string, unknown>;
      if (payload['ok'] !== true) {
        return {
          kind: 'invalid-grant',
          message:
            typeof payload['error'] === 'string'
              ? payload['error']
              : 'refresh ok=false',
        };
      }
      const parsed = slackOAuthTokensSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          kind: 'invalid-grant',
          message: `refresh payload shape mismatch: ${parsed.error.message}`,
        };
      }
      return { kind: 'ok', tokens: parsed.data };
    } catch (error) {
      return {
        kind: 'transport-error',
        message: error instanceof Error ? error.message : 'unknown transport error',
      };
    }
  };
}
