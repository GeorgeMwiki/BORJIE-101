/**
 * Email token refresh — Gmail + Outlook.
 *
 * Google's refresh tokens may rotate on refresh; Microsoft's
 * usually do not. The helper handles both — when the response
 * includes a `refresh_token` we use it; otherwise the caller keeps
 * the existing one.
 *
 * The 5-minute safety margin matches the omnidata auth broker
 * default.
 */

import {
  emailOAuthTokensSchema,
  type EmailProvider,
  type Fetcher,
} from '../types.js';
import { z } from 'zod';

export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_TOKEN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';

const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  token_type: z.literal('Bearer'),
});

export interface RefreshTokenInput {
  readonly provider: EmailProvider;
  readonly refreshToken: string;
  readonly expiresAt: string | null;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly nowIso: string;
}

export type RefreshTokenResult =
  | {
      readonly kind: 'ok';
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly expiresInSec: number;
    }
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
    if (input.expiresAt !== null) {
      const expiresAtMs = Date.parse(input.expiresAt);
      const nowMs = Date.parse(input.nowIso);
      if (!Number.isNaN(expiresAtMs) && !Number.isNaN(nowMs)) {
        if (expiresAtMs - nowMs > TOKEN_REFRESH_MARGIN_MS) {
          return { kind: 'not-yet-due' };
        }
      }
    }

    const url =
      input.provider === 'gmail' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
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
        if (res.status === 400 || res.status === 401) {
          const text = await res.text().catch(() => '');
          return { kind: 'invalid-grant', message: text || 'invalid_grant' };
        }
        return { kind: 'upstream-error', status: res.status, message: res.statusText };
      }
      const payload = await res.json();
      const parsed = refreshResponseSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          kind: 'invalid-grant',
          message: `refresh payload shape mismatch: ${parsed.error.message}`,
        };
      }
      // Google may rotate the refresh token. Use it when present.
      return {
        kind: 'ok',
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token ?? input.refreshToken,
        expiresInSec: parsed.data.expires_in,
      };
    } catch (error) {
      return {
        kind: 'transport-error',
        message: error instanceof Error ? error.message : 'unknown transport error',
      };
    }
  };
}

// Re-export from emailOAuthTokensSchema for callers that need the
// schema shape directly.
export { emailOAuthTokensSchema };
