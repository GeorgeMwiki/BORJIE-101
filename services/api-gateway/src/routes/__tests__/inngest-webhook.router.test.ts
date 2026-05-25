/**
 * inngest-webhook router tests — signature, dispatch, body validation,
 * idempotency replay.
 *
 * The router is unit-tested against a stub `InngestRuntime`. Hono is
 * driven via `app.request()` so we exercise the whole pipeline
 * (signature header → body parse → runtime dispatch) without booting
 * a server.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import inngestWebhookRouter, {
  __internal,
  type InngestRuntime,
} from '../inngest-webhook.router';

// Pin signing key BEFORE any router import so module-init captures
// nothing stale.
process.env.INNGEST_SIGNING_KEY = 'inngest-test-signing-key';

function sign(rawBody: string, secret: string, ts: number): string {
  const hex = createHmac('sha256', secret).update(`${ts}${rawBody}`).digest('hex');
  return `t=${ts}&s=${hex}`;
}

function makeApp(runtime: InngestRuntime | null = null): Hono {
  const app = new Hono();
  // Synthetic services context — production middleware sets this.
  app.use('*', async (c, next) => {
    c.set('services', runtime ? { inngestRuntime: runtime } : {});
    await next();
  });
  app.route('/api/v1/inngest', inngestWebhookRouter);
  return app;
}

function makeRuntime(): {
  readonly runtime: InngestRuntime;
  readonly received: ReadonlyArray<{
    name: string;
    data: Record<string, unknown>;
    id?: string;
  }>;
} {
  const received: Array<{ name: string; data: Record<string, unknown>; id?: string }> = [];
  const runtime: InngestRuntime = {
    async handle(event) {
      received.push({ name: event.name, data: event.data, id: event.id });
      return { ok: true, result: { handled: event.name } };
    },
  };
  return { runtime, received };
}

beforeAll(() => {
  process.env.INNGEST_SIGNING_KEY = 'inngest-test-signing-key';
});

beforeEach(() => {
  __internal._resetIdempotency();
});

describe('inngest-webhook — signature verification', () => {
  it('returns 401 when the signature header is missing', async () => {
    const app = makeApp(makeRuntime().runtime);
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body: JSON.stringify({ name: 'agency/run.requested', data: { x: 1 } }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('INNGEST_SIGNATURE_INVALID');
  });

  it('returns 401 when the signature is forged', async () => {
    const app = makeApp(makeRuntime().runtime);
    const rawBody = JSON.stringify({ name: 'agency/run.requested', data: { x: 1 } });
    const ts = Math.floor(Date.now() / 1000);
    const bad = `t=${ts}&s=${'0'.repeat(64)}`;
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-inngest-signature': bad,
      },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp (>5min skew)', async () => {
    const app = makeApp(makeRuntime().runtime);
    const rawBody = JSON.stringify({ name: 'agency/run.requested', data: { x: 1 } });
    const stale = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min ago
    const sig = sign(rawBody, 'inngest-test-signing-key', stale);
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-inngest-signature': sig,
      },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid signature within the time window', async () => {
    const { runtime, received } = makeRuntime();
    const app = makeApp(runtime);
    const rawBody = JSON.stringify({
      name: 'agency/run.requested',
      data: { tenantId: 't1', goalId: 'g1' },
      id: 'evt-1',
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(rawBody, 'inngest-test-signing-key', ts);
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-inngest-signature': sig,
      },
    });
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.name).toBe('agency/run.requested');
    expect(received[0]?.data.tenantId).toBe('t1');
  });
});

describe('inngest-webhook — body validation', () => {
  function signed(body: string): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000);
    return {
      'content-type': 'application/json',
      'x-inngest-signature': sign(body, 'inngest-test-signing-key', ts),
    };
  }

  it('returns 400 when the body is not JSON', async () => {
    const app = makeApp(makeRuntime().runtime);
    const body = 'not-json';
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('INNGEST_BODY_INVALID');
  });

  it('returns 400 when event.name is missing', async () => {
    const app = makeApp(makeRuntime().runtime);
    const body = JSON.stringify({ data: { x: 1 } });
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when event.data is not an object', async () => {
    const app = makeApp(makeRuntime().runtime);
    const body = JSON.stringify({ name: 'agency/run.requested', data: [1, 2] });
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(400);
  });
});

describe('inngest-webhook — runtime + idempotency', () => {
  function signed(body: string): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000);
    return {
      'content-type': 'application/json',
      'x-inngest-signature': sign(body, 'inngest-test-signing-key', ts),
    };
  }

  it('returns 503 when the runtime is not wired', async () => {
    const app = makeApp(null);
    const body = JSON.stringify({
      name: 'agency/run.requested',
      data: { tenantId: 't1', goalId: 'g1' },
    });
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(503);
  });

  it('dispatches valid events to the runtime', async () => {
    const { runtime, received } = makeRuntime();
    const app = makeApp(runtime);
    const body = JSON.stringify({
      name: 'agency/run.requested',
      data: { tenantId: 't1', goalId: 'g1' },
      id: 'evt-X',
    });
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe('evt-X');
  });

  it('replays of the same event-id are short-circuited with 409', async () => {
    const { runtime, received } = makeRuntime();
    const app = makeApp(runtime);
    const body = JSON.stringify({
      name: 'agency/run.requested',
      data: { tenantId: 't1', goalId: 'g1' },
      id: 'replay-evt',
    });
    const first = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(first.status).toBe(200);
    const second = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(second.status).toBe(409);
    expect(received).toHaveLength(1);
  });

  it('surfaces dispatcher errors as 500', async () => {
    const runtime: InngestRuntime = {
      async handle() {
        throw new Error('runtime exploded');
      },
    };
    const app = makeApp(runtime);
    const body = JSON.stringify({
      name: 'agency/run.requested',
      data: { tenantId: 't1', goalId: 'g1' },
    });
    const res = await app.request('/api/v1/inngest', {
      method: 'POST',
      body,
      headers: signed(body),
    });
    expect(res.status).toBe(500);
  });
});
