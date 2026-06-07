import { describe, it, expect, vi } from 'vitest';

import {
  createExpoPushProvider,
  readExpoConfigFromEnv,
  type ExpoConfig,
} from '../expo';
import {
  createPushProviderFromEnv,
  createCompositePushProvider,
} from '../composite';
import {
  createStubPushProvider,
  resolvePushProviderFromEnv,
} from '../../push-provider';
import type { PushProviderInput } from '../types';

const baseInput: PushProviderInput = {
  tenantId: 'tenant-A',
  pushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  templateKey: 'arrears.reminder',
  locale: 'en',
  payload: { title: 'Royalty due', body: 'Your royalty filing is due.' },
  idempotencyKey: 'idem-1',
};

function makeResponse(status: number, body: string): typeof fetch {
  return vi.fn(async () => ({
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

const OK_TICKET = JSON.stringify({
  data: [{ status: 'ok', id: 'receipt-123' }],
});

describe('readExpoConfigFromEnv', () => {
  it('returns a config with null token when EXPO_ACCESS_TOKEN unset', () => {
    expect(readExpoConfigFromEnv({})).toEqual({ accessToken: null });
  });

  it('reads EXPO_ACCESS_TOKEN + EXPO_PUSH_API_URL', () => {
    const cfg = readExpoConfigFromEnv({
      EXPO_ACCESS_TOKEN: 'tok',
      EXPO_PUSH_API_URL: 'https://example.test/send',
    });
    expect(cfg).toEqual({
      accessToken: 'tok',
      apiUrl: 'https://example.test/send',
    });
  });
});

describe('createExpoPushProvider', () => {
  const cfg: ExpoConfig = { accessToken: 'sekret-token' };

  it('sends on a 200 ok ticket and returns the receipt id', async () => {
    const fetchImpl = makeResponse(200, OK_TICKET);
    const provider = createExpoPushProvider(cfg, { fetch: fetchImpl });
    const r = await provider.send(baseInput);

    expect(r.status).toBe('sent');
    if (r.status === 'sent') {
      expect(r.providerRef).toBe('receipt-123');
      expect(r.provider).toBe('expo');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://exp.host/--/api/v2/push/send');
    const init = call[1] as { headers: Record<string, string>; body: string };
    expect(init.headers.authorization).toBe('Bearer sekret-token');
    expect(init.headers['X-Borjie-Tenant-Id']).toBe('tenant-A');
    const sentBody = JSON.parse(init.body) as { to: string; title: string };
    expect(sentBody.to).toBe(baseInput.pushToken);
    expect(sentBody.title).toBe('Royalty due');
  });

  it('omits the Authorization header when no access token is set', async () => {
    const fetchImpl = makeResponse(200, OK_TICKET);
    const provider = createExpoPushProvider(
      { accessToken: null },
      { fetch: fetchImpl },
    );
    const r = await provider.send(baseInput);
    expect(r.status).toBe('sent');
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = call[1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBeUndefined();
  });

  it('maps a 5xx HTTP response to a retryable failure', async () => {
    const provider = createExpoPushProvider(cfg, {
      fetch: makeResponse(503, 'service unavailable'),
    });
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('provider_5xx');
      expect(r.retryable).toBe(true);
    }
  });

  it('maps a 429 HTTP response to a retryable failure', async () => {
    const provider = createExpoPushProvider(cfg, {
      fetch: makeResponse(429, 'slow down'),
    });
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('rate_limited');
      expect(r.retryable).toBe(true);
    }
  });

  it('maps a non-429 4xx HTTP response to a non-retryable failure', async () => {
    const provider = createExpoPushProvider(cfg, {
      fetch: makeResponse(400, 'bad request'),
    });
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('invalid_request');
      expect(r.retryable).toBe(false);
    }
  });

  it('maps a DeviceNotRegistered ticket to a non-retryable failure', async () => {
    const body = JSON.stringify({
      data: [
        {
          status: 'error',
          message: 'token is not registered',
          details: { error: 'DeviceNotRegistered' },
        },
      ],
    });
    const provider = createExpoPushProvider(cfg, {
      fetch: makeResponse(200, body),
    });
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('device_not_registered');
      expect(r.retryable).toBe(false);
    }
  });

  it('maps an InvalidCredentials ticket to a non-retryable failure', async () => {
    const body = JSON.stringify({
      data: [
        {
          status: 'error',
          message: 'bad creds',
          details: { error: 'InvalidCredentials' },
        },
      ],
    });
    const provider = createExpoPushProvider(cfg, {
      fetch: makeResponse(200, body),
    });
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('auth_failed');
      expect(r.retryable).toBe(false);
    }
  });

  it('maps a MessageRateExceeded ticket to a retryable failure', async () => {
    const body = JSON.stringify({
      data: [
        {
          status: 'error',
          message: 'rate exceeded',
          details: { error: 'MessageRateExceeded' },
        },
      ],
    });
    const provider = createExpoPushProvider(cfg, {
      fetch: makeResponse(200, body),
    });
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('rate_limited');
      expect(r.retryable).toBe(true);
    }
  });

  it('falls back to a retryable network error when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET sekret-token leaked');
    }) as unknown as typeof fetch;
    const provider = createExpoPushProvider(cfg, { fetch: fetchImpl });
    const r = await provider.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('http_network_error');
      expect(r.retryable).toBe(true);
      expect(r.errorMessage).not.toContain('sekret-token');
      expect(r.errorMessage).toContain('***');
    }
  });
});

describe('createCompositePushProvider / createPushProviderFromEnv', () => {
  it('configured=false path returns non-retryable provider_not_configured without calling fetch (PUSH_DISABLED)', async () => {
    // createPushProviderFromEnv returns null when push is disabled.
    expect(createPushProviderFromEnv({ PUSH_DISABLED: 'true' })).toBeNull();

    // The composite built with a disabled (null) Expo rail short-circuits
    // before any HTTP call.
    const composite = createCompositePushProvider({ expo: null });
    expect(composite.configured).toBe(false);
    const r = await composite.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('provider_not_configured');
      expect(r.retryable).toBe(false);
    }
  });

  it('is configured (attempt-capable) by default even without an access token', () => {
    const composite = createPushProviderFromEnv({});
    expect(composite).not.toBeNull();
    expect(composite?.configured).toBe(true);
    expect(composite?.name).toContain('expo');
  });

  it('delegates to the Expo rail when enabled', async () => {
    const fetchImpl = makeResponse(200, OK_TICKET);
    const composite = createPushProviderFromEnv(
      { EXPO_ACCESS_TOKEN: 'tok' },
      { fetch: fetchImpl },
    );
    const r = await composite!.send(baseInput);
    expect(r.status).toBe('sent');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('push-provider seam (stub + resolve)', () => {
  it('stub returns non-retryable provider_not_configured without fetch', async () => {
    const stub = createStubPushProvider();
    expect(stub.configured).toBe(false);
    const r = await stub.send(baseInput);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('provider_not_configured');
      expect(r.retryable).toBe(false);
    }
  });

  it('resolvePushProviderFromEnv falls back to the stub when PUSH_DISABLED', () => {
    const provider = resolvePushProviderFromEnv({ PUSH_DISABLED: 'true' });
    expect(provider.configured).toBe(false);
    expect(provider.name).toBe('stub-push');
  });

  it('resolvePushProviderFromEnv returns the composite when enabled', () => {
    const provider = resolvePushProviderFromEnv({});
    expect(provider.configured).toBe(true);
    expect(provider.name).toContain('expo');
  });
});
