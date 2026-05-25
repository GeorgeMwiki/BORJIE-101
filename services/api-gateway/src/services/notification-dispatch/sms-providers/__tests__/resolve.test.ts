import { describe, it, expect } from 'vitest';

import { resolveSmsProviderFromEnv } from '../../sms-provider';

describe('resolveSmsProviderFromEnv', () => {
  it('falls back to stub when no env vars set', () => {
    const provider = resolveSmsProviderFromEnv({});
    expect(provider.name).toBe('stub-sms');
    expect(provider.configured).toBe(false);
  });

  it('returns composite when Twilio configured', () => {
    const provider = resolveSmsProviderFromEnv({
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '+15551234567',
    });
    expect(provider.name).toContain('twilio');
    expect(provider.configured).toBe(true);
  });

  it('returns composite when Africa Talking configured', () => {
    const provider = resolveSmsProviderFromEnv({
      AT_USERNAME: 'sandbox',
      AT_API_KEY: 'k',
      AT_FROM: 'BORJIE',
    });
    expect(provider.name).toContain('africastalking');
    expect(provider.configured).toBe(true);
  });
});
