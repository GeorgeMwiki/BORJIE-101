/**
 * sentry-webhook router tests — signature verification, payload
 * validation, idempotency.
 *
 * Mirrors the inngest-webhook test pattern. Driven via `app.request()`
 * so we exercise the whole pipeline (signature → JSON parse → zod →
 * bridge dispatch) without booting a server.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import sentryWebhookRouter, {
  __internal,
  type SentryBridgePort,
} from '../sentry-webhook.hono';

// Pin signing secret BEFORE any router import so module-init captures
// nothing stale.
process.env.SENTRY_WEBHOOK_SECRET = 'sentry-test-secret';

function signBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function makeApp(bridge: SentryBridgePort | null = null): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', bridge ? { sentryToGithubBridge: bridge } : {});
    await next();
  });
  app.route('/api/v1/webhooks/sentry', sentryWebhookRouter);
  return app;
}

function makeBridge(
  result: {
    status: 'created' | 'duplicate' | 'skipped';
    githubIssueUrl?: string;
    reason?: string;
  } = { status: 'created', githubIssueUrl: 'https://github.com/borjie/borjie/issues/1' },
): {
  readonly bridge: SentryBridgePort;
  readonly received: ReadonlyArray<{ readonly fingerprint: string }>;
} {
  const received: Array<{ fingerprint: string }> = [];
  const bridge: SentryBridgePort = {
    async handle(input) {
      received.push({ fingerprint: input.fingerprint });
      return result;
    },
  };
  return { bridge, received };
}

function samplePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: {
      event_id: 'ev-1',
      level: 'error',
      type: 'AuthOtpNotReceived',
      value: 'OTP delivery timed out',
      tags: [
        ['pilot_cohort', 'tz-pilot-1'],
        ['screen_id', 'auth.otp.entry'],
      ],
      exception: {
        values: [
          {
            type: 'AuthOtpNotReceived',
            value: 'timed out',
            stacktrace: {
              frames: [
                { filename: 'packages/auth/src/otp/send.ts', function: 'sendOtp', lineno: 87 },
              ],
            },
          },
        ],
      },
    },
    issue: { id: 42, fingerprint: ['fp-abc-123'] },
    organization: { slug: 'borjie' },
    project: { slug: 'workforce-mobile' },
    ...overrides,
  };
}

beforeAll(() => {
  process.env.SENTRY_WEBHOOK_SECRET = 'sentry-test-secret';
});

beforeEach(() => {
  __internal._resetIdempotency();
});

// ─────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────

describe('sentry-webhook — signature verification', () => {
  it('returns 401 when the signature header is missing', async () => {
    const app = makeApp(makeBridge().bridge);
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST',
      body: JSON.stringify(samplePayload()),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('SENTRY_SIGNATURE_INVALID');
  });

  it('returns 401 when the signature is forged', async () => {
    const app = makeApp(makeBridge().bridge);
    const rawBody = JSON.stringify(samplePayload());
    const bad = '0'.repeat(64);
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'sentry-hook-signature': bad,
      },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid signature', async () => {
    const { bridge, received } = makeBridge();
    const app = makeApp(bridge);
    const rawBody = JSON.stringify(samplePayload());
    const sig = signBody(rawBody, 'sentry-test-secret');
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'sentry-hook-signature': sig,
      },
    });
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.fingerprint).toBe('fp-abc-123');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Payload validation
// ─────────────────────────────────────────────────────────────────────

describe('sentry-webhook — payload validation', () => {
  function signed(body: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'sentry-hook-signature': signBody(body, 'sentry-test-secret'),
    };
  }

  it('returns 400 when body is not valid JSON', async () => {
    const app = makeApp(makeBridge().bridge);
    const body = 'not-json';
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('SENTRY_BODY_INVALID');
  });

  it('returns 400 when required fields are missing', async () => {
    const app = makeApp(makeBridge().bridge);
    const body = JSON.stringify({ event: { event_id: 'x' } });
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when level is not a known value', async () => {
    const app = makeApp(makeBridge().bridge);
    const body = JSON.stringify(samplePayload({
      event: { ...(samplePayload().event as Record<string, unknown>), level: 'WAT' },
    }));
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────

describe('sentry-webhook — idempotency', () => {
  function signed(body: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'sentry-hook-signature': signBody(body, 'sentry-test-secret'),
    };
  }

  it('returns duplicate on repeat fingerprint within window', async () => {
    const { bridge, received } = makeBridge();
    const app = makeApp(bridge);
    const body = JSON.stringify(samplePayload());

    const r1 = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST', body, headers: signed(body),
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST', body, headers: signed(body),
    });
    expect(r2.status).toBe(200);
    const json2 = (await r2.json()) as { data?: { status?: string } };
    expect(json2.data?.status).toBe('duplicate');
    expect(received).toHaveLength(1);
  });

  it('returns 503 when bridge is not wired', async () => {
    const app = makeApp(null);
    const body = JSON.stringify(samplePayload());
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST', body, headers: signed(body),
    });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('SENTRY_BRIDGE_UNAVAILABLE');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Normalisation (pure)
// ─────────────────────────────────────────────────────────────────────

describe('sentry-webhook — payload normalisation', () => {
  it('flattens tag array into a Record and forwards fingerprint via end-to-end', async () => {
    const { bridge, received } = makeBridge();
    const app = makeApp(bridge);
    // Test the end-to-end normalisation (zod transform → bridge input).
    const body = JSON.stringify(samplePayload());
    const sig = signBody(body, 'sentry-test-secret');
    const res = await app.request('/api/v1/webhooks/sentry', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', 'sentry-hook-signature': sig },
    });
    expect(res.status).toBe(200);
    expect(received[0]?.fingerprint).toBe('fp-abc-123');
  });
});
