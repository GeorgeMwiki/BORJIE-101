import { describe, it, expect, vi } from 'vitest';

import {
  createAfricasTalkingSmsProvider,
  readAfricasTalkingConfigFromEnv,
  type AfricasTalkingConfig,
  type AfricasTalkingFetch,
} from '../africastalking';

const baseInput = {
  tenantId: 'tenant-A',
  recipientAddress: '+254712345678',
  templateKey: 'arrears.reminder',
  locale: 'en',
  payload: { text: 'Rent is due.' },
  idempotencyKey: 'idem-1',
  channel: 'sms',
} as const;

const AT_OK_BODY = JSON.stringify({
  SMSMessageData: {
    Message: 'Sent to 1/1',
    Recipients: [
      {
        statusCode: 101,
        status: 'Success',
        messageId: 'ATXid_abc123',
        cost: 'KES 0.8000',
      },
    ],
  },
});

function makeOk(body: string): AfricasTalkingFetch {
  return vi.fn(async () => ({
    ok: true,
    status: 201,
    text: async () => body,
  }));
}

function makeFail(status: number, body: string): AfricasTalkingFetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    text: async () => body,
  }));
}

describe('readAfricasTalkingConfigFromEnv', () => {
  it('returns null if any required field missing', () => {
    expect(
      readAfricasTalkingConfigFromEnv({
        AT_USERNAME: 'sandbox',
        AT_API_KEY: 'k',
      })
    ).toBeNull();
    expect(
      readAfricasTalkingConfigFromEnv({
        AT_USERNAME: 'sandbox',
        AT_FROM: 'BORJIE',
      })
    ).toBeNull();
  });

  it('reads all three fields', () => {
    const cfg = readAfricasTalkingConfigFromEnv({
      AT_USERNAME: 'sandbox',
      AT_API_KEY: 'atkey',
      AT_FROM: 'BORJIE',
    });
    expect(cfg).toEqual({
      username: 'sandbox',
      apiKey: 'atkey',
      from: 'BORJIE',
    });
  });
});

describe('createAfricasTalkingSmsProvider', () => {
  const cfg: AfricasTalkingConfig = {
    username: 'sandbox',
    apiKey: 'atkey-secret',
    from: 'BORJIE',
  };

  it('returns not-configured stub when null', async () => {
    const provider = createAfricasTalkingSmsProvider(null);
    expect(provider.configured).toBe(false);
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
  });

  it('rejects whatsapp channel as unsupported', async () => {
    const fetchImpl = vi.fn();
    const provider = createAfricasTalkingSmsProvider(
      cfg,
      fetchImpl as AfricasTalkingFetch
    );
    const r = await provider.send({ ...baseInput, channel: 'whatsapp' });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('channel_unsupported');
      expect(r.retryable).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends SMS happy path with apiKey header and form body', async () => {
    const fetchImpl = makeOk(AT_OK_BODY);
    const provider = createAfricasTalkingSmsProvider(cfg, fetchImpl);
    const r = await provider.send(baseInput);

    expect(r.status).toBe('sent');
    if (r.status === 'sent') {
      expect(r.providerRef).toBe('ATXid_abc123');
      expect(r.provider).toBe('africastalking');
    }
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.africastalking.com/version1/messaging');
    expect(call[1].headers.apiKey).toBe('atkey-secret');
    expect(call[1].headers['X-Borjie-Tenant']).toBe('tenant-A');
    const body = call[1].body as string;
    expect(body).toContain('username=sandbox');
    expect(body).toContain('from=BORJIE');
    expect(body).toContain('to=%2B254712345678');
  });

  it('rejects non-E.164 recipient', async () => {
    const fetchImpl = vi.fn();
    const provider = createAfricasTalkingSmsProvider(
      cfg,
      fetchImpl as AfricasTalkingFetch
    );
    const r = await provider.send({
      ...baseInput,
      recipientAddress: '0712345678',
    });
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('invalid_msisdn');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 5xx/429 to retryable failure with sanitised key', async () => {
    const fetchImpl = makeFail(503, 'service down apikey atkey-secret');
    const provider = createAfricasTalkingSmsProvider(cfg, fetchImpl);
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.retryable).toBe(true);
      expect(r.errorMessage).not.toContain('atkey-secret');
      expect(r.errorMessage).toContain('***');
    }
  });

  it('maps recipient status code 401 to non-retryable failure', async () => {
    const failBody = JSON.stringify({
      SMSMessageData: {
        Message: 'Sent to 0/1',
        Recipients: [
          {
            statusCode: 401,
            status: 'RiskHold',
            messageId: '',
          },
        ],
      },
    });
    const provider = createAfricasTalkingSmsProvider(cfg, makeOk(failBody));
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('at_status_401');
      expect(r.retryable).toBe(false);
    }
  });

  it('handles empty / non-JSON response defensively', async () => {
    const provider = createAfricasTalkingSmsProvider(cfg, makeOk('not-json'));
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('at_invalid_json');
    }
  });

  it('falls back to retryable network error and sanitises key', async () => {
    const fetchImpl: AfricasTalkingFetch = vi.fn(async () => {
      throw new Error('ECONNRESET apikey atkey-secret');
    });
    const provider = createAfricasTalkingSmsProvider(cfg, fetchImpl);
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('at_network_error');
      expect(r.retryable).toBe(true);
      expect(r.errorMessage).not.toContain('atkey-secret');
    }
  });
});
