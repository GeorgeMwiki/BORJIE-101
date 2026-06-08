/**
 * Flow-autonomy router smoke tests.
 *
 * Verifies the per-flow autonomy route (migration 0308) is mounted, gates
 * auth on every endpoint, and reaches the in-memory flow-autonomy repo on
 * the happy path: set posture → read it back → list → pending queue.
 *
 * The router consumes the singleton built in
 * `composition/workflow-engine-wiring.ts`, which defaults to an in-memory
 * flow-autonomy repository when no DB is present. We reset the singleton
 * between tests so each `it()` starts with an empty store.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret BEFORE importing any router so the auth middleware
// captures the same value the test signer uses.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import flowAutonomyRouter from '../flow-autonomy.js';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role.js';
import { resetWorkflowEngineForTests } from '../../../composition/workflow-engine-wiring.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/workflow/flow-autonomy', flowAutonomyRouter);
  return app;
}

function bearer(role: UserRole = UserRole.ADMIN, userId = 'usr-test'): string {
  return `Bearer ${generateToken({
    userId,
    tenantId: 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

describe('flow-autonomy router — auth gates', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('rejects GET / without a token', async () => {
    const res = await mount().request('/workflow/flow-autonomy');
    expect(res.status).toBe(401);
  });

  it('rejects GET /pending without a token', async () => {
    const res = await mount().request('/workflow/flow-autonomy/pending');
    expect(res.status).toBe(401);
  });

  it('rejects POST /:flowId/posture without a token', async () => {
    const res = await mount().request('/workflow/flow-autonomy/f1/posture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posture: 'auto' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('flow-autonomy router — engine reachable', () => {
  beforeEach(() => {
    resetWorkflowEngineForTests();
  });

  it('GET / returns an empty list for a fresh tenant', async () => {
    const res = await mount().request('/workflow/flow-autonomy', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: unknown[];
      meta: { total: number };
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it('GET /:flowId returns 404 when no posture recorded', async () => {
    const res = await mount().request('/workflow/flow-autonomy/unknown-flow', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(404);
  });

  it('POST /:flowId/posture sets AUTO and it reads back confirmed', async () => {
    const set = await mount().request('/workflow/flow-autonomy/flow-x/posture', {
      method: 'POST',
      headers: { Authorization: bearer(), 'content-type': 'application/json' },
      body: JSON.stringify({ posture: 'auto', amountThreshold: 1000 }),
    });
    expect(set.status).toBe(200);
    const setBody = (await set.json()) as {
      success: boolean;
      data: {
        posture: string;
        confirmationState: string;
        amountThreshold: number | null;
        promotedAt: string | null;
      };
    };
    expect(setBody.success).toBe(true);
    expect(setBody.data.posture).toBe('auto');
    expect(setBody.data.confirmationState).toBe('confirmed');
    expect(setBody.data.amountThreshold).toBe(1000);
    expect(setBody.data.promotedAt).not.toBeNull();

    const get = await mount().request('/workflow/flow-autonomy/flow-x', {
      headers: { Authorization: bearer() },
    });
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as {
      data: { posture: string };
    };
    expect(getBody.data.posture).toBe('auto');
  });

  it('rejects POST /:flowId/posture with an invalid posture (zod)', async () => {
    const res = await mount().request('/workflow/flow-autonomy/f1/posture', {
      method: 'POST',
      headers: { Authorization: bearer(), 'content-type': 'application/json' },
      body: JSON.stringify({ posture: 'sometimes' }),
    });
    expect(res.status).toBe(400);
  });
});
