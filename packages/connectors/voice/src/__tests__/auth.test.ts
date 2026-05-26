/**
 * Twilio Voice sub-account isolation + basic-auth tests.
 *
 * Critical invariant: the connector REFUSES to operate with the root
 * Twilio account SID — voice TPS / billing MUST be partitioned from
 * the SMS notifier in services/wave-resilience-manager.
 */

import { describe, it, expect } from 'vitest';

import { assembleBasicAuth, SubAccountIsolationError } from '../auth/oauth.js';
import { refreshAccessToken } from '../auth/token-refresh.js';
import type { TwilioInstall } from '../types.js';

const ROOT_SID = 'AC' + '0'.repeat(30);
const SUB_SID = 'AC' + '1'.repeat(30);

function makeInstall(over: Partial<TwilioInstall> = {}): TwilioInstall {
  return {
    tenantId: 'tenant-mwikila',
    account: SUB_SID,
    authToken: 'sub-account-auth-token',
    ...over,
  };
}

describe('voice/auth', () => {
  it('assembles HTTP Basic Authorization header for a valid sub-account', () => {
    const result = assembleBasicAuth({ install: makeInstall(), rootAccountSid: ROOT_SID });
    expect(result.authorization).toMatch(/^Basic /);
    expect(result.subAccountSid).toBe(SUB_SID);
    const decoded = Buffer.from(result.authorization.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe(`${SUB_SID}:sub-account-auth-token`);
  });

  it('REFUSES the root account SID (would share voice TPS with SMS notifier)', () => {
    expect(() =>
      assembleBasicAuth({ install: makeInstall({ account: ROOT_SID }), rootAccountSid: ROOT_SID }),
    ).toThrow(SubAccountIsolationError);
  });

  it('REFUSES an empty / unconfigured sub-account', () => {
    expect(() =>
      assembleBasicAuth({ install: makeInstall({ account: '' }), rootAccountSid: ROOT_SID }),
    ).toThrow(SubAccountIsolationError);
    expect(() =>
      assembleBasicAuth({ install: makeInstall({ authToken: '' }), rootAccountSid: ROOT_SID }),
    ).toThrow(SubAccountIsolationError);
  });

  it('REFUSES a sub-account SID that does not look like AC… (length ≥ 20)', () => {
    expect(() =>
      assembleBasicAuth({ install: makeInstall({ account: 'BAD123' }), rootAccountSid: ROOT_SID }),
    ).toThrow(SubAccountIsolationError);
  });

  it('refreshAccessToken returns unconfigured when isolation fails (does not crash poller)', () => {
    const out = refreshAccessToken({
      install: makeInstall({ account: ROOT_SID }),
      rootAccountSid: ROOT_SID,
    });
    expect(out.kind).toBe('unconfigured');
  });

  it('refreshAccessToken returns a token when isolation holds', () => {
    const out = refreshAccessToken({ install: makeInstall(), rootAccountSid: ROOT_SID });
    expect(out.kind).toBe('token');
    if (out.kind === 'token') expect(out.auth.subAccountSid).toBe(SUB_SID);
  });
});
