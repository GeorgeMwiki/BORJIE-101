/**
 * Calendar OAuth exchange — Google Calendar + Outlook (Microsoft Graph).
 *
 * Identical authorization-code flow as the email connector; only the
 * scopes differ. We deliberately keep this helper in-package rather
 * than depending on `@borjie/connector-email` so the two connector
 * packages can be installed independently.
 */

import {
  calendarOAuthTokensSchema,
  type CalendarOAuthExchangeRequest,
  type Fetcher,
} from '../types.js';
import type { z } from 'zod';

type ValidatedTokens = z.infer<typeof calendarOAuthTokensSchema>;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_TOKEN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export interface CalendarOAuthExchangeDeps {
  readonly fetcher: Fetcher;
}

export type CalendarOAuthExchangeResult =
  | { readonly kind: 'ok'; readonly tokens: ValidatedTokens }
  | { readonly kind: 'invalid-code'; readonly message: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export function createCalendarOAuthExchange(
  deps: CalendarOAuthExchangeDeps,
): (req: CalendarOAuthExchangeRequest) => Promise<CalendarOAuthExchangeResult> {
  return async (req) => {
    const url =
      req.provider === 'google_calendar' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;
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
        return res.status === 400
          ? { kind: 'invalid-code', message: text || 'invalid_grant' }
          : { kind: 'upstream-error', status: res.status, message: res.statusText };
      }
      const payload = await res.json();
      const parsed = calendarOAuthTokensSchema.safeParse(payload);
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
