/**
 * Twilio has no expiring access tokens — the Account SID + Auth Token
 * pair are long-lived bearer credentials. The "refresh" port here exists
 * only so the OMNI-P1 ConnectorRefresher shape stays uniform across the
 * nine providers; it simply re-asserts the sub-account isolation
 * invariant and returns the current credential.
 */

import { assembleBasicAuth, type BasicAuthResult } from './oauth.js';
import type { TwilioInstall } from '../types.js';

export interface RefreshTokenParams {
  readonly install: TwilioInstall;
  readonly rootAccountSid: string;
}

export interface EncryptedTokenStoragePort {
  readonly load: (params: {
    readonly tenantId: string;
    readonly account: string;
  }) => Promise<{ readonly authToken: string } | null>;
  readonly save: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly authToken: string;
  }) => Promise<void>;
}

export type RefreshOutcome =
  | { readonly kind: 'token'; readonly auth: BasicAuthResult }
  | { readonly kind: 'unconfigured' };

export function refreshAccessToken(params: RefreshTokenParams): RefreshOutcome {
  try {
    const auth = assembleBasicAuth({
      install: params.install,
      rootAccountSid: params.rootAccountSid,
    });
    return { kind: 'token', auth };
  } catch {
    return { kind: 'unconfigured' };
  }
}
