/**
 * Email OAuth exchange — Gmail + Outlook (Microsoft Graph).
 *
 * Provider docs:
 * - Google OAuth 2.0 — https://developers.google.com/identity/protocols/oauth2/web-server (accessed 2026-05-26)
 * - Microsoft identity platform — https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow (accessed 2026-05-26)
 *
 * Both providers issue refresh + access tokens via the same
 * authorization-code grant; only the token endpoint differs.
 */

import {
  type EmailOAuthExchangeRequest,
  type Fetcher,
  emailOAuthTokensSchema,
} from '../types.js';
import type { z } from 'zod';

type ValidatedTokens = z.infer<typeof emailOAuthTokensSchema>;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_TOKEN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export interface EmailOAuthExchangeDeps {
  readonly fetcher: Fetcher;
}

export type EmailOAuthExchangeResult =
  | { readonly kind: 'ok'; readonly tokens: ValidatedTokens }
  | { readonly kind: 'invalid-code'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export function createEmailOAuthExchange(
  deps: EmailOAuthExchangeDeps,
): (req: EmailOAuthExchangeRequest) => Promise<EmailOAuthExchangeResult> {
  return async (req) => {
    const url =
      req.provider === 'gmail' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.code,
      client_id: req.clientId,
      client_secret: req.clientSecret,
      redirect_uri: req.redirectUri,
    }).toString();

    try {
      const res = await deps.fetcher({
        url,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          kind: res.status === 400 ? 'invalid-code' : 'upstream-error',
          ...(res.status === 400
            ? { message: text || 'invalid_grant' }
            : { status: res.status, message: res.statusText }),
        } as EmailOAuthExchangeResult;
      }
      const payload = await res.json();
      const parsed = emailOAuthTokensSchema.safeParse(payload);
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
