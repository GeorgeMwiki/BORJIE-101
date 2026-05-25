/**
 * Tests for the SendGrid email provider adapter.
 *
 * We never hit the real network — every test injects a `fetch`
 * spy via the `deps` arg. Each case asserts one slice of behaviour:
 * config detection, request shape, status mapping, retry hints, and
 * key sanitisation.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createSendGridEmailProvider,
  readSendGridConfigFromEnv,
} from '../sendgrid';
import type { EmailProviderInput } from '../../email-provider';

const FAKE_KEY = 'SG.fakekey-1234567890';

function input(over: Partial<EmailProviderInput> = {}): EmailProviderInput {
  return {
    tenantId: 'tenant-A',
    recipientAddress: 'owner@example.com',
    templateKey: 'monthly_close.owner_statement_ready',
    locale: 'en',
    payload: { statementId: 'stmt-1' },
    idempotencyKey: 'idem-1',
    ...over,
  };
}

function ok(messageId = 'sg-msg-1'): Response {
  return new Response(null, {
    status: 202,
    headers: { 'x-message-id': messageId },
  });
}

function err(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('readSendGridConfigFromEnv', () => {
  it('returns null when api key is missing', () => {
    expect(
      readSendGridConfigFromEnv({ SENDGRID_FROM_EMAIL: 'a@b.io' }),
    ).toBeNull();
  });

  it('returns null when from email is missing', () => {
    expect(
      readSendGridConfigFromEnv({ SENDGRID_API_KEY: FAKE_KEY }),
    ).toBeNull();
  });

  it('returns config when both present, including optional fields', () => {
    const cfg = readSendGridConfigFromEnv({
      SENDGRID_API_KEY: FAKE_KEY,
      SENDGRID_FROM_EMAIL: 'from@borjie.io',
      SENDGRID_FROM_NAME: 'BORJIE',
      SENDGRID_API_BASE_URL: 'https://api.sendgrid.test',
    });
    expect(cfg).toEqual({
      apiKey: FAKE_KEY,
      fromEmail: 'from@borjie.io',
      fromName: 'BORJIE',
      apiBaseUrl: 'https://api.sendgrid.test',
    });
  });
});

describe('createSendGridEmailProvider', () => {
  it('reports configured = true and provider name', () => {
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'from@borjie.io' },
      { fetch: vi.fn() as unknown as typeof fetch },
    );
    expect(provider.configured).toBe(true);
    expect(provider.name).toBe('sendgrid');
  });

  it('POSTs to /v3/mail/send with bearer auth + tenant header on happy path', async () => {
    const fetchSpy = vi.fn(async () => ok('sg-1'));
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'from@borjie.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(init.headers['X-Bossnyumba-Tenant-Id']).toBe('tenant-A');
    const body = JSON.parse(init.body);
    expect(body.from.email).toBe('from@borjie.io');
    expect(body.personalizations[0].to[0].email).toBe('owner@example.com');
    expect(body.personalizations[0].custom_args.tenant_id).toBe('tenant-A');
    expect(body.personalizations[0].custom_args.idempotency_key).toBe('idem-1');
    expect(result).toEqual({
      status: 'sent',
      providerRef: 'sg-1',
      provider: 'sendgrid',
    });
  });

  it('falls back to a generated providerRef when x-message-id missing', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }));
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('sent');
    if (result.status === 'sent') {
      expect(result.providerRef).toMatch(/^sg_/);
    }
  });

  it('maps 401 to non-retryable auth_failed', async () => {
    const fetchSpy = vi.fn(async () => err(401, 'Unauthorized'));
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('auth_failed');
      expect(result.retryable).toBe(false);
    }
  });

  it('maps 429 to retryable rate_limited', async () => {
    const fetchSpy = vi.fn(async () => err(429, 'too many'));
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('rate_limited');
      expect(result.retryable).toBe(true);
    }
  });

  it('maps 503 to retryable provider_5xx', async () => {
    const fetchSpy = vi.fn(async () => err(503, 'busy'));
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('provider_5xx');
      expect(result.retryable).toBe(true);
    }
  });

  it('sanitises the api key from error bodies', async () => {
    const fetchSpy = vi.fn(async () =>
      err(500, `Internal failure with key ${FAKE_KEY} echoed`),
    );
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorMessage).not.toContain(FAKE_KEY);
      expect(result.errorMessage).toContain('***');
    }
  });

  it('classifies fetch network errors as retryable http_network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('http_network_error');
      expect(result.retryable).toBe(true);
    }
  });

  it('classifies AbortError as http_timeout (retryable)', async () => {
    const fetchSpy = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('http_timeout');
      expect(result.retryable).toBe(true);
    }
  });

  it('passes an AbortSignal so requests time out', async () => {
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeDefined();
      return ok();
    });
    const provider = createSendGridEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    await provider.send(input());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
