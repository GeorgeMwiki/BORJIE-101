/**
 * Integration-ish tests for the webhook DLQ admin router.
 *
 * We mount the router on a standalone Hono app and hit it with fetch-shaped
 * Request objects. A valid admin JWT is minted via `generateToken` from the
 * gateway's own auth middleware so `authMiddleware` accepts the call.
 *
 * NOTE: `getJwtSecret()` captures the secret once per process, so do NOT
 * rewrite JWT_SECRET from inside a test — it won't propagate. The ephemeral
 * dev secret (generated on first import) is shared by auth.ts and
 * hono-auth.ts, which is exactly what we need here.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createWebhookDlqRouter } from '../routes/webhook-dlq.router';
import { generateToken } from '../middleware/auth';
import { UserRole } from '../types/user-role';
import type {
  WebhookDeliveryRepository,
  WebhookDeadLetterRecord,
  WebhookDeliveryQueued,
} from '../workers/webhook-retry-worker';

function makeRepo(seed: WebhookDeadLetterRecord[] = []) {
  const state = {
    dlq: [...seed] as WebhookDeadLetterRecord[],
    replayed: [] as { id: string; by: string; replayDeliveryId: string }[],
    attempts: [] as unknown[],
  };
  const repo: WebhookDeliveryRepository = {
    async recordAttempt() {
      /* not exercised here */
    },
    async moveToDeadLetters() {
      /* not exercised here */
    },
    async listDeadLetters(f) {
      const items = f.tenantId
        ? state.dlq.filter((e) => e.tenantId === f.tenantId)
        : state.dlq;
      return items.slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? items.length));
    },
    async getDeadLetter(id) {
      return state.dlq.find((e) => e.id === id) ?? null;
    },
    async markDeadLetterReplayed(id, by, replayDeliveryId) {
      state.replayed.push({ id, by, replayDeliveryId });
    },
  };
  return { state, repo };
}

function adminToken(tenantId = 'tnt-1'): string {
  return generateToken({
    userId: 'admin-1',
    tenantId,
    role: UserRole.TENANT_ADMIN,
    permissions: ['*'],
    propertyAccess: [],
  });
}

function memberToken(): string {
  return generateToken({
    userId: 'user-1',
    tenantId: 'tnt-1',
    role: UserRole.RESIDENT,
    permissions: [],
    propertyAccess: [],
  });
}

function buildApp(deps: {
  repo: WebhookDeliveryRepository;
  requeue: (e: WebhookDeliveryQueued) => Promise<string>;
}) {
  const app = new Hono();
  app.route(
    '/',
    createWebhookDlqRouter({
      repository: deps.repo,
      requeue: deps.requeue,
      now: () => 1_700_000_000_000,
      generateId: () => 'abc123xy',
    })
  );
  return app;
}

function sampleDlq(
  overrides: Partial<WebhookDeadLetterRecord> = {}
): WebhookDeadLetterRecord {
  return {
    id: 'dlq-1',
    deliveryId: 'del-1',
    tenantId: 'tnt-1',
    targetUrl: 'https://example.test/webhook',
    eventType: 'invoice.paid',
    payload: { id: 'inv-1' },
    totalAttempts: 5,
    lastStatusCode: 503,
    lastError: 'upstream timeout',
    firstAttemptAt: new Date('2026-04-01T00:00:00Z'),
    lastAttemptAt: new Date('2026-04-01T00:05:00Z'),
    ...overrides,
  };
}

describe('webhook DLQ router', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const { repo } = makeRepo();
    const app = buildApp({ repo, requeue: async () => 'new-id' });
    const res = await app.request('/api/v1/webhooks/dead-letters');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin roles with 403', async () => {
    const { repo } = makeRepo();
    const app = buildApp({ repo, requeue: async () => 'new-id' });
    const res = await app.request('/api/v1/webhooks/dead-letters', {
      headers: { Authorization: `Bearer ${memberToken()}` },
    });
    expect(res.status).toBe(403);
  });

  it('lists DLQ entries scoped to the caller tenant', async () => {
    const { repo } = makeRepo([
      sampleDlq({ id: 'dlq-a', tenantId: 'tnt-1' }),
      sampleDlq({ id: 'dlq-b', tenantId: 'tnt-other' }),
    ]);
    const app = buildApp({ repo, requeue: async () => 'new-id' });
    const res = await app.request('/api/v1/webhooks/dead-letters', {
      headers: { Authorization: `Bearer ${adminToken('tnt-1')}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: WebhookDeadLetterRecord[];
    };
    expect(body.success).toBe(true);
    expect(body.data.map((e) => e.id)).toEqual(['dlq-a']);
  });

  it('fetches a single DLQ entry by id', async () => {
    const { repo } = makeRepo([sampleDlq()]);
    const app = buildApp({ repo, requeue: async () => 'new-id' });
    const res = await app.request('/api/v1/webhooks/dead-letters/dlq-1', {
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: WebhookDeadLetterRecord };
    expect(body.data.deliveryId).toBe('del-1');
  });

  it('returns 404 when fetching another tenant’s DLQ entry', async () => {
    const { repo } = makeRepo([sampleDlq({ tenantId: 'tnt-other' })]);
    const app = buildApp({ repo, requeue: async () => 'new-id' });
    const res = await app.request('/api/v1/webhooks/dead-letters/dlq-1', {
      headers: { Authorization: `Bearer ${adminToken('tnt-1')}` },
    });
    expect(res.status).toBe(404);
  });

  it('replays a DLQ entry: requeues + marks replayed + returns new deliveryId', async () => {
    const { repo, state } = makeRepo([sampleDlq()]);
    const requeued: WebhookDeliveryQueued[] = [];
    const app = buildApp({
      repo,
      requeue: async (e) => {
        requeued.push(e);
        return e.deliveryId;
      },
    });

    const res = await app.request('/api/v1/webhooks/dead-letters/dlq-1/replay', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; replayDeliveryId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.replayDeliveryId).toMatch(/^del-1-replay-/);
    expect(requeued).toHaveLength(1);
    expect(requeued[0].targetUrl).toBe('https://example.test/webhook');
    expect(requeued[0].payload).toEqual({ id: 'inv-1' });
    expect(state.replayed).toHaveLength(1);
    expect(state.replayed[0].id).toBe('dlq-1');
    expect(state.replayed[0].by).toBe('admin-1');
  });

  it('returns 404 when replaying a non-existent entry', async () => {
    const { repo } = makeRepo();
    const app = buildApp({ repo, requeue: async () => 'x' });
    const res = await app.request('/api/v1/webhooks/dead-letters/missing/replay', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
    expect(res.status).toBe(404);
  });
});
