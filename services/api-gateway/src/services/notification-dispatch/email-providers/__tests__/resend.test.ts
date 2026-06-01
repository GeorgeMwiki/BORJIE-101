/**
 * Tests for the Resend email provider adapter.
 *
 * Mirrors the SendGrid suite: no real network — every test injects a
 * `fetch` spy via `deps`. Each case pins one slice of behaviour:
 * config detection, request shape, status mapping, retry hints, and
 * API-key sanitisation.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createResendEmailProvider,
  readResendConfigFromEnv,
} from '../resend';
import type { EmailProviderInput } from '../../email-provider';

const FAKE_KEY = 're_fakekey-1234567890';

function input(over: Partial<EmailProviderInput> = {}): EmailProviderInput {
  return {
    tenantId: 'tenant-A',
    recipientAddress: 'owner@example.com',
    templateKey: 'arrears.reminder',
    locale: 'en',
    payload: { reminderId: 'rem-1' },
    idempotencyKey: 'idem-1',
    ...over,
  };
}

function ok(id = 're-msg-1'): Response {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function err(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('readResendConfigFromEnv', () => {
  it('returns null when api key is missing', () => {
    expect(
      readResendConfigFromEnv({ RESEND_FROM_EMAIL: 'a@b.io' }),
    ).toBeNull();
  });

  it('returns null when from email is missing', () => {
    expect(
      readResendConfigFromEnv({ RESEND_API_KEY: FAKE_KEY }),
    ).toBeNull();
  });

  it('returns config when both present, including optional fields', () => {
    const cfg = readResendConfigFromEnv({
      RESEND_API_KEY: FAKE_KEY,
      RESEND_FROM_EMAIL: 'from@borjie.io',
      RESEND_FROM_NAME: 'BORJIE',
      RESEND_API_URL: 'https://api.resend.test',
    });
    expect(cfg).toEqual({
      apiKey: FAKE_KEY,
      fromEmail: 'from@borjie.io',
      fromName: 'BORJIE',
      apiBaseUrl: 'https://api.resend.test',
    });
  });
});

describe('createResendEmailProvider', () => {
  it('reports configured = true and provider name', () => {
    const provider = createResendEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'from@borjie.io' },
      { fetch: vi.fn() as unknown as typeof fetch },
    );
    expect(provider.configured).toBe(true);
    expect(provider.name).toBe('resend');
  });

  it('POSTs to /emails with bearer auth + {from,to,subject,html} body', async () => {
    const fetchSpy = vi.fn(async () => ok('re-1'));
    const provider = createResendEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'from@borjie.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['X-Borjie-Tenant-Id']).toBe('tenant-A');
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(['from', 'html', 'subject', 'to']);
    expect(body.from).toBe('from@borjie.io');
    expect(body.to).toBe('owner@example.com');
    expect(body.subject).toBe('BORJIE: arrears.reminder');
    expect(typeof body.html).toBe('string');
    expect(result).toEqual({
      status: 'sent',
      providerRef: 're-1',
      provider: 'resend',
    });
  });

  it('renders "Name <email>" when fromName is set', async () => {
    const fetchSpy = vi.fn(async () => ok());
    const provider = createResendEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'from@borjie.io', fromName: 'BORJIE' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    await provider.send(input());

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.from).toBe('BORJIE <from@borjie.io>');
  });

  it('falls back to a generated providerRef when response id missing', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    const provider = createResendEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('sent');
    if (result.status === 'sent') {
      expect(result.providerRef).toMatch(/^re_/);
    }
  });

  it('maps 401 to non-retryable auth_failed', async () => {
    const fetchSpy = vi.fn(async () => err(401, 'Unauthorized'));
    const provider = createResendEmailProvider(
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
    const provider = createResendEmailProvider(
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
    const provider = createResendEmailProvider(
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
    const provider = createResendEmailProvider(
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
    const provider = createResendEmailProvider(
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
    const provider = createResendEmailProvider(
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
    const provider = createResendEmailProvider(
      { apiKey: FAKE_KEY, fromEmail: 'a@b.io' },
      { fetch: fetchSpy as unknown as typeof fetch },
    );

    await provider.send(input());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
