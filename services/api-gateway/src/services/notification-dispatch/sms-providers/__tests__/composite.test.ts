import { describe, it, expect, vi } from 'vitest';

import {
  createCompositeSmsProvider,
  createCompositeSmsProviderFromEnv,
} from '../composite';
import type {
  SmsProvider,
  SmsProviderInput,
  SmsProviderResult,
} from '../../sms-provider';

const baseInput: SmsProviderInput = {
  tenantId: 'tenant-A',
  recipientAddress: '+254712345678',
  templateKey: 'arrears.reminder',
  locale: 'en',
  payload: { text: 'Rent is due.' },
  idempotencyKey: 'idem-1',
  channel: 'sms',
};

function fakeProvider(
  name: string,
  configured: boolean,
  result: SmsProviderResult = {
    status: 'sent',
    providerRef: `${name}_ref`,
    provider: name,
  }
): SmsProvider & { readonly send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => result);
  return { name, configured, send };
}

describe('createCompositeSmsProvider', () => {
  it('returns failed when no provider is configured for SMS', async () => {
    const composite = createCompositeSmsProvider({
      twilio: null,
      africasTalking: null,
    });
    expect(composite.configured).toBe(false);
    const r = await composite.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('provider_not_configured');
    }
  });

  it('routes WhatsApp to Twilio when configured', async () => {
    const twilio = fakeProvider('twilio', true);
    const at = fakeProvider('africastalking', true);
    const composite = createCompositeSmsProvider({
      twilio,
      africasTalking: at,
    });
    const r = await composite.send({ ...baseInput, channel: 'whatsapp' });
    expect(r.status).toBe('sent');
    expect(twilio.send).toHaveBeenCalledTimes(1);
    expect(at.send).not.toHaveBeenCalled();
  });

  it('refuses WhatsApp when only AT configured', async () => {
    const at = fakeProvider('africastalking', true);
    const composite = createCompositeSmsProvider({
      twilio: null,
      africasTalking: at,
    });
    const r = await composite.send({ ...baseInput, channel: 'whatsapp' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('channel_unsupported');
      expect(r.retryable).toBe(false);
    }
    expect(at.send).not.toHaveBeenCalled();
  });

  it('uses default priority africastalking-first for SMS', async () => {
    const twilio = fakeProvider('twilio', true);
    const at = fakeProvider('africastalking', true);
    const composite = createCompositeSmsProvider({
      twilio,
      africasTalking: at,
    });
    await composite.send(baseInput);
    expect(at.send).toHaveBeenCalledTimes(1);
    expect(twilio.send).not.toHaveBeenCalled();
  });

  it('honours twilio-first priority override', async () => {
    const twilio = fakeProvider('twilio', true);
    const at = fakeProvider('africastalking', true);
    const composite = createCompositeSmsProvider({
      twilio,
      africasTalking: at,
      smsPriority: ['twilio', 'africastalking'],
    });
    await composite.send(baseInput);
    expect(twilio.send).toHaveBeenCalledTimes(1);
    expect(at.send).not.toHaveBeenCalled();
  });

  it('falls through to next provider when first is unconfigured', async () => {
    const twilio = fakeProvider('twilio', false);
    const at = fakeProvider('africastalking', true);
    const composite = createCompositeSmsProvider({
      twilio,
      africasTalking: at,
      smsPriority: ['twilio', 'africastalking'],
    });
    await composite.send(baseInput);
    expect(twilio.send).not.toHaveBeenCalled();
    expect(at.send).toHaveBeenCalledTimes(1);
  });

  it('exposes a name reflecting the configured providers', () => {
    const composite = createCompositeSmsProvider({
      twilio: fakeProvider('twilio', true),
      africasTalking: fakeProvider('africastalking', true),
    });
    expect(composite.name).toContain('africastalking');
    expect(composite.name).toContain('twilio');
  });
});

describe('createCompositeSmsProviderFromEnv', () => {
  it('returns null when no env vars present', () => {
    expect(createCompositeSmsProviderFromEnv({})).toBeNull();
  });

  it('builds composite when only Twilio env present', () => {
    const composite = createCompositeSmsProviderFromEnv({
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '+15551234567',
    });
    expect(composite).not.toBeNull();
    expect(composite?.configured).toBe(true);
  });

  it('builds composite when only AT env present', () => {
    const composite = createCompositeSmsProviderFromEnv({
      AT_USERNAME: 'sandbox',
      AT_API_KEY: 'k',
      AT_FROM: 'BORJIE',
    });
    expect(composite).not.toBeNull();
    expect(composite?.configured).toBe(true);
  });
});
