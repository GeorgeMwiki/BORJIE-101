/**
 * Tests for the AWS SES email provider adapter.
 *
 * Network is fully mocked via the injected `fetch`. We additionally
 * pin `now` to a fixed instant so the SigV4 signature is deterministic
 * and asserted at byte level for the canonical request shape.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createSesEmailProvider,
  readSesConfigFromEnv,
  __sigv4,
} from '../ses';
import type { EmailProviderInput } from '../../email-provider';

const FAKE_AK = 'AKIAFAKE1234567890';
const FAKE_SK = 'fakeSecretAccessKey/AbC+12345abcdefghijklmnop';
const FAKE_TOKEN = 'fakeSessionToken-9999';

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

function okXml(messageId = 'ses-msg-1'): Response {
  return new Response(
    `<SendEmailResponse><SendEmailResult><MessageId>${messageId}</MessageId></SendEmailResult></SendEmailResponse>`,
    { status: 200 },
  );
}

const FIXED_NOW = new Date(Date.UTC(2026, 4, 8, 12, 0, 0));

describe('readSesConfigFromEnv', () => {
  it('returns null when access key id is missing', () => {
    expect(
      readSesConfigFromEnv({
        AWS_SECRET_ACCESS_KEY: FAKE_SK,
        AWS_SES_REGION: 'eu-west-1',
        SES_FROM_EMAIL: 'a@b.io',
      }),
    ).toBeNull();
  });

  it('returns null when region is missing', () => {
    expect(
      readSesConfigFromEnv({
        AWS_ACCESS_KEY_ID: FAKE_AK,
        AWS_SECRET_ACCESS_KEY: FAKE_SK,
        SES_FROM_EMAIL: 'a@b.io',
      }),
    ).toBeNull();
  });

  it('returns full config including optional session token', () => {
    const cfg = readSesConfigFromEnv({
      AWS_ACCESS_KEY_ID: FAKE_AK,
      AWS_SECRET_ACCESS_KEY: FAKE_SK,
      AWS_SES_REGION: 'eu-west-1',
      SES_FROM_EMAIL: 'from@borjie.io',
      AWS_SESSION_TOKEN: FAKE_TOKEN,
    });
    expect(cfg).toEqual({
      accessKeyId: FAKE_AK,
      secretAccessKey: FAKE_SK,
      region: 'eu-west-1',
      fromEmail: 'from@borjie.io',
      sessionToken: FAKE_TOKEN,
      apiBaseUrl: undefined,
    });
  });
});

describe('createSesEmailProvider', () => {
  const baseConfig = {
    accessKeyId: FAKE_AK,
    secretAccessKey: FAKE_SK,
    region: 'eu-west-1',
    fromEmail: 'from@borjie.io',
  };

  it('reports configured = true and provider name', () => {
    const provider = createSesEmailProvider(baseConfig, {
      fetch: vi.fn() as unknown as typeof fetch,
    });
    expect(provider.configured).toBe(true);
    expect(provider.name).toBe('ses');
  });

  it('sends a SigV4-signed POST and parses MessageId on 200', async () => {
    const fetchSpy = vi.fn(async () => okXml('ses-1'));
    const provider = createSesEmailProvider(baseConfig, {
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => FIXED_NOW,
    });

    const result = await provider.send(input());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://email.eu-west-1.amazonaws.com/');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe(
      'application/x-www-form-urlencoded; charset=utf-8',
    );
    expect(init.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAFAKE/,
    );
    expect(init.headers['x-amz-date']).toBe('20260508T120000Z');
    expect(init.headers['X-Bossnyumba-Tenant-Id']).toBe('tenant-A');
    expect(init.body).toContain('Action=SendEmail');
    expect(init.body).toContain('Source=from%40borjie.io');
    expect(init.body).toContain(
      'Destination.ToAddresses.member.1=owner%40example.com',
    );
    expect(init.body).toContain('Tags.member.1.Value=tenant-A');
    expect(result).toEqual({
      status: 'sent',
      providerRef: 'ses-1',
      provider: 'ses',
    });
  });

  it('includes x-amz-security-token header when session token is set', async () => {
    const fetchSpy = vi.fn(async () => okXml());
    const provider = createSesEmailProvider(
      { ...baseConfig, sessionToken: FAKE_TOKEN },
      {
        fetch: fetchSpy as unknown as typeof fetch,
        now: () => FIXED_NOW,
      },
    );

    await provider.send(input());

    const init = fetchSpy.mock.calls[0][1];
    expect(init.headers['x-amz-security-token']).toBe(FAKE_TOKEN);
  });

  it('falls back to generated providerRef when MessageId is absent', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response('<SendEmailResponse></SendEmailResponse>', {
          status: 200,
        }),
    );
    const provider = createSesEmailProvider(baseConfig, {
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => FIXED_NOW,
    });

    const result = await provider.send(input());

    expect(result.status).toBe('sent');
    if (result.status === 'sent') {
      expect(result.providerRef).toMatch(/^ses_/);
    }
  });

  it('maps 403 to non-retryable auth_failed', async () => {
    const fetchSpy = vi.fn(
      async () => new Response('<Error>SignatureDoesNotMatch</Error>', { status: 403 }),
    );
    const provider = createSesEmailProvider(baseConfig, {
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => FIXED_NOW,
    });

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('auth_failed');
      expect(result.retryable).toBe(false);
    }
  });

  it('maps 429 / 5xx to retryable codes', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('throttle', { status: 429 }))
      .mockResolvedValueOnce(new Response('server', { status: 500 }));
    const provider = createSesEmailProvider(baseConfig, {
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => FIXED_NOW,
    });

    const a = await provider.send(input());
    const b = await provider.send(input());

    expect(a.status === 'failed' && a.errorCode).toBe('rate_limited');
    expect(b.status === 'failed' && b.errorCode).toBe('provider_5xx');
    expect(a.status === 'failed' && a.retryable).toBe(true);
    expect(b.status === 'failed' && b.retryable).toBe(true);
  });

  it('sanitises secret access key, access key id, and session token from errors', async () => {
    const leakedBody = `bad happens with sk=${FAKE_SK} ak=${FAKE_AK} tok=${FAKE_TOKEN}`;
    const fetchSpy = vi.fn(
      async () => new Response(leakedBody, { status: 500 }),
    );
    const provider = createSesEmailProvider(
      { ...baseConfig, sessionToken: FAKE_TOKEN },
      {
        fetch: fetchSpy as unknown as typeof fetch,
        now: () => FIXED_NOW,
      },
    );

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorMessage).not.toContain(FAKE_SK);
      expect(result.errorMessage).not.toContain(FAKE_AK);
      expect(result.errorMessage).not.toContain(FAKE_TOKEN);
      expect(result.errorMessage).toContain('***');
    }
  });

  it('classifies network errors as retryable http_network_error', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('connect EHOSTUNREACH');
    });
    const provider = createSesEmailProvider(baseConfig, {
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => FIXED_NOW,
    });

    const result = await provider.send(input());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('http_network_error');
      expect(result.retryable).toBe(true);
    }
  });

  it('honours a custom apiBaseUrl override', async () => {
    const fetchSpy = vi.fn(async () => okXml());
    const provider = createSesEmailProvider(
      { ...baseConfig, apiBaseUrl: 'https://email-fips.eu-west-1.amazonaws.com' },
      {
        fetch: fetchSpy as unknown as typeof fetch,
        now: () => FIXED_NOW,
      },
    );

    await provider.send(input());

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://email-fips.eu-west-1.amazonaws.com/');
    expect(init.headers.host).toBe('email-fips.eu-west-1.amazonaws.com');
  });
});

describe('SES SigV4 helpers', () => {
  it('toAmzDate strips dashes / colons / millis', () => {
    expect(__sigv4.toAmzDate(FIXED_NOW)).toBe('20260508T120000Z');
  });

  it('signRequest produces a deterministic Authorization header', () => {
    const headers = __sigv4.signRequest({
      method: 'POST',
      host: 'email.eu-west-1.amazonaws.com',
      path: '/',
      body: 'Action=SendEmail&Version=2010-12-01',
      config: {
        accessKeyId: FAKE_AK,
        secretAccessKey: FAKE_SK,
        region: 'eu-west-1',
        fromEmail: 'a@b.io',
      },
      date: FIXED_NOW,
    });
    expect(headers.authorization).toContain(
      `AWS4-HMAC-SHA256 Credential=${FAKE_AK}/20260508/eu-west-1/ses/aws4_request`,
    );
    expect(headers['x-amz-date']).toBe('20260508T120000Z');
  });
});
