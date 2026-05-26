/**
 * Microsoft Graph change-notification webhook receiver.
 *
 * Two responsibilities:
 *   1. Echo the `validationToken` query parameter on subscription
 *      validation (within 10 s).
 *   2. Verify the `clientState` field in each delivered notification
 *      matches the secret configured at subscription time. (Optional
 *      HMAC of the encryptedContent is out of scope for v1.)
 *
 * Reference: Microsoft, *Change notifications* —
 * https://learn.microsoft.com/en-us/graph/api/resources/webhooks
 */

import { timingSafeEqual } from 'node:crypto';

export interface ValidationParams {
  readonly query: Readonly<Record<string, string | undefined>>;
}

export interface VerifyClientStateParams {
  readonly clientStateHeader: string;
  readonly secret: string;
}

export type VerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'mismatch' | 'malformed' };

export function tryValidationEcho(params: ValidationParams): string | null {
  const token = params.query.validationToken;
  if (typeof token !== 'string' || token === '') return null;
  return token;
}

export function verifyTeamsClientState(params: VerifyClientStateParams): VerifyOutcome {
  if (params.clientStateHeader === '') return { ok: false, reason: 'malformed' };
  const a = Buffer.from(params.clientStateHeader);
  const b = Buffer.from(params.secret);
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
