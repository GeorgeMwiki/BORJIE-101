/**
 * Slack OAuth v2 — authorisation-code exchange.
 *
 * Per "Slack OAuth v2 install flow"
 * (https://api.slack.com/authentication/oauth-v2, accessed 2026-05-26):
 * the install endpoint accepts the auth code and returns the bot
 * token. We post `application/x-www-form-urlencoded` to
 * `https://slack.com/api/oauth.v2.access`. The connector injects a
 * `Fetcher` so the call is testable offline.
 *
 * The exchange is read-only; it never persists anything. Persistence
 * is the responsibility of `repositories/credentials.ts` and happens
 * AFTER the token plaintext has passed through the `CredentialCipher`
 * boundary.
 */

import {
  type Fetcher,
  type SlackOAuthExchangeRequest,
  type SlackOAuthTokensValidated,
  slackOAuthTokensSchema,
} from '../types.js';

export interface SlackOAuthExchangeDeps {
  readonly fetcher: Fetcher;
}

export type SlackOAuthExchangeResult =
  | { readonly kind: 'ok'; readonly tokens: SlackOAuthTokensValidated }
  | { readonly kind: 'invalid-code'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

const SLACK_OAUTH_URL = 'https://slack.com/api/oauth.v2.access';

export function createSlackOAuthExchange(
  deps: SlackOAuthExchangeDeps,
): (req: SlackOAuthExchangeRequest) => Promise<SlackOAuthExchangeResult> {
  return async (req) => {
    const body = new URLSearchParams({
      code: req.code,
      client_id: req.clientId,
      client_secret: req.clientSecret,
      redirect_uri: req.redirectUri,
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
        return {
          kind: 'upstream-error',
          status: res.status,
          message: res.statusText,
        };
      }
      const payload = (await res.json()) as Record<string, unknown>;
      if (payload['ok'] !== true) {
        return {
          kind: 'invalid-code',
          message:
            typeof payload['error'] === 'string'
              ? payload['error']
              : 'oauth.v2.access ok=false',
        };
      }
      const parsed = slackOAuthTokensSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          kind: 'invalid-code',
          message: `payload shape mismatch: ${parsed.error.message}`,
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
