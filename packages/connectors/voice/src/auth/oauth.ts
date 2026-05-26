/**
 * Twilio "auth" — Account-SID + Auth-Token HTTP Basic.
 *
 * Twilio has no OAuth flow for the REST API (per docs). The connector's
 * `auth.oauth.ts` module is named for OMNI-P1 shape consistency but
 * its job is simply to assemble the Authorization header for HTTP
 * Basic auth, and to verify that the sub-account SID provided is
 * distinct from the root account SID — the security boundary that
 * partitions voice TPS / billing from the SMS notifier.
 *
 * Reference: Twilio, *Voice REST API — Call resource* —
 * https://www.twilio.com/docs/voice/api/call-resource
 * Twilio, *Sub-accounts* —
 * https://www.twilio.com/docs/iam/api/subaccounts
 */

import type { TwilioInstall } from '../types.js';

export interface BasicAuthResult {
  readonly authorization: string;
  readonly subAccountSid: string;
}

export interface AssembleAuthParams {
  readonly install: TwilioInstall;
  /** The root TWILIO_ACCOUNT_SID. Must be different from `install.account`. */
  readonly rootAccountSid: string;
}

export class SubAccountIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubAccountIsolationError';
  }
}

export function assembleBasicAuth(params: AssembleAuthParams): BasicAuthResult {
  if (params.install.account === '' || params.install.authToken === '') {
    throw new SubAccountIsolationError('Twilio Voice sub-account SID / auth token not configured');
  }
  if (params.install.account === params.rootAccountSid) {
    throw new SubAccountIsolationError(
      'Twilio Voice connector MUST use a sub-account SID distinct from the root account; otherwise voice TPS would share quota with the SMS notifier in wave-resilience-manager',
    );
  }
  if (!params.install.account.startsWith('AC') || params.install.account.length < 20) {
    throw new SubAccountIsolationError(
      `Twilio Voice sub-account SID must look like 'AC…' (length ≥ 20); got '${params.install.account.slice(0, 4)}…'`,
    );
  }
  const basic = Buffer.from(
    `${params.install.account}:${params.install.authToken}`,
  ).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    subAccountSid: params.install.account,
  };
}
