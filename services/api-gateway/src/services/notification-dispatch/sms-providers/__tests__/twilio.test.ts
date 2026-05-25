import { describe, it, expect, vi } from 'vitest';

import {
  createTwilioSmsProvider,
  readTwilioConfigFromEnv,
  type TwilioConfig,
  type TwilioFetch,
} from '../twilio';

const baseInput = {
  tenantId: 'tenant-A',
  recipientAddress: '+254712345678',
  templateKey: 'arrears.reminder',
  locale: 'en',
  payload: { text: 'Rent is due.' },
  idempotencyKey: 'idem-1',
} as const;

function makeOk(body: string): TwilioFetch {
  return vi.fn(async () => ({
    ok: true,
    status: 201,
    text: async () => body,
  }));
}

function makeFail(status: number, body: string): TwilioFetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    text: async () => body,
  }));
}

const TWILIO_OK_BODY = JSON.stringify({
  sid: 'SMxxxxxxxxxxxxxxx',
  status: 'queued',
});

describe('readTwilioConfigFromEnv', () => {
  it('returns null when SID is missing', () => {
    expect(
      readTwilioConfigFromEnv({ TWILIO_AUTH_TOKEN: 'token' })
    ).toBeNull();
  });

  it('returns null when token is missing', () => {
    expect(
      readTwilioConfigFromEnv({ TWILIO_ACCOUNT_SID: 'AC1' })
    ).toBeNull();
  });

  it('reads SID + token + from + whatsapp', () => {
    const cfg = readTwilioConfigFromEnv({
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '+15551234567',
      TWILIO_WHATSAPP_FROM: '+15557654321',
    });
    expect(cfg).toEqual({
      accountSid: 'AC1',
      authToken: 'tok',
      fromNumber: '+15551234567',
      whatsappFrom: '+15557654321',
    });
  });

  it('falls back whatsappFrom to fromNumber when not set', () => {
    const cfg = readTwilioConfigFromEnv({
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '+15551234567',
    });
    expect(cfg?.whatsappFrom).toBe('+15551234567');
  });
});

describe('createTwilioSmsProvider', () => {
  const cfg: TwilioConfig = {
    accountSid: 'AC1',
    authToken: 'sekrettoken',
    fromNumber: '+15551234567',
    whatsappFrom: '+15557654321',
  };

  it('returns not-configured stub when config is null', async () => {
    const provider = createTwilioSmsProvider(null);
    expect(provider.configured).toBe(false);
    const r = await provider.send({ ...baseInput, channel: 'sms' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('provider_not_configured');
    }
  });

  it('sends SMS happy path with E.164 To/From', async () => {
    const fetchImpl = makeOk(TWILIO_OK_BODY);
    const provider = createTwilioSmsProvider(cfg, fetchImpl);
    const r = await provider.send({ ...baseInput, channel: 'sms' });

    expect(r.status).toBe('sent');
    if (r.status === 'sent') {
      expect(r.providerRef).toBe('SMxxxxxxxxxxxxxxx');
      expect(r.provider).toBe('twilio');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('/Accounts/AC1/Messages.json');
    const body = call[1].body as string;
    expect(body).toContain('From=%2B15551234567');
    expect(body).toContain('To=%2B254712345678');
    expect(call[1].headers.Authorization).toMatch(/^Basic /);
    expect(call[1].headers['X-Borjie-Tenant']).toBe('tenant-A');
  });

  it('routes WhatsApp with whatsapp: prefix on To and From', async () => {
    const fetchImpl = makeOk(TWILIO_OK_BODY);
    const provider = createTwilioSmsProvider(cfg, fetchImpl);
    const r = await provider.send({ ...baseInput, channel: 'whatsapp' });

    expect(r.status).toBe('sent');
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1].body as string;
    expect(body).toContain('From=whatsapp%3A%2B15557654321');
    expect(body).toContain('To=whatsapp%3A%2B254712345678');
  });

  it('rejects non-E.164 recipient before HTTP call', async () => {
    const fetchImpl = vi.fn();
    const provider = createTwilioSmsProvider(cfg, fetchImpl as TwilioFetch);
    const r = await provider.send({
      ...baseInput,
      recipientAddress: '0712345678',
      channel: 'sms',
    });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('invalid_msisdn');
      expect(r.retryable).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 4xx to non-retryable failure', async () => {
    const provider = createTwilioSmsProvider(
      cfg,
      makeFail(400, 'bad request')
    );
    const r = await provider.send({ ...baseInput, channel: 'sms' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('twilio_http_400');
      expect(r.retryable).toBe(false);
    }
  });

  it('maps 5xx and 429 to retryable failure', async () => {
    const provider = createTwilioSmsProvider(cfg, makeFail(503, 'unavail'));
    const r = await provider.send({ ...baseInput, channel: 'sms' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.retryable).toBe(true);
    }

    const provider2 = createTwilioSmsProvider(cfg, makeFail(429, 'slow'));
    const r2 = await provider2.send({ ...baseInput, channel: 'sms' });
    expect(r2.status).toBe('failed');
    if (r2.status === 'failed') {
      expect(r2.retryable).toBe(true);
    }
  });

  it('sanitises auth token from error messages', async () => {
    const fetchImpl = makeFail(
      400,
      `error: token sekrettoken leaked here`
    );
    const provider = createTwilioSmsProvider(cfg, fetchImpl);
    const r = await provider.send({ ...baseInput, channel: 'sms' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorMessage).not.toContain('sekrettoken');
      expect(r.errorMessage).toContain('***');
    }
  });

  it('falls back to retryable network error when fetch throws', async () => {
    const fetchImpl: TwilioFetch = vi.fn(async () => {
      throw new Error('ECONNRESET sekrettoken');
    });
    const provider = createTwilioSmsProvider(cfg, fetchImpl);
    const r = await provider.send({ ...baseInput, channel: 'sms' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('twilio_network_error');
      expect(r.retryable).toBe(true);
      expect(r.errorMessage).not.toContain('sekrettoken');
    }
  });

  it('reports provider_not_configured if WhatsApp requested without whatsapp from', async () => {
    const partial: TwilioConfig = { ...cfg, whatsappFrom: null };
    const provider = createTwilioSmsProvider(partial, makeOk(TWILIO_OK_BODY));
    const r = await provider.send({ ...baseInput, channel: 'whatsapp' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('provider_not_configured');
    }
  });
});
