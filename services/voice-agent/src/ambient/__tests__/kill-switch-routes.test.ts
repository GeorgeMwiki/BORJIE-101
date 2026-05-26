import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authMiddleware } from '../../middleware/auth.js';
import { registerKillSwitchRoutes } from '../kill-switch-routes.js';
import { createAmbientWiring, type AmbientWiring } from '../pipeline-wire.js';

const TENANT = 'ks-route-tenant-1';
const ADMIN = '00000000-0000-0000-0000-000000000099';

interface TestHarness {
  readonly app: FastifyInstance;
  readonly wiring: AmbientWiring;
}

async function buildHarness(): Promise<TestHarness> {
  const wiring = createAmbientWiring({
    clock: () => new Date('2026-05-26T08:00:00Z'),
  });
  const app = Fastify({ logger: false });
  authMiddleware(app, {
    testAuthInjector: () => ({
      userId: ADMIN,
      tenantId: TENANT,
      role: 'admin',
    }),
  });
  registerKillSwitchRoutes(app, { wiring });
  await app.ready();
  return { app, wiring };
}

describe('POST /voice/ambient/kill-switch/trigger', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    harness = await buildHarness();
  });
  afterEach(async () => {
    await harness.app.close();
  });

  it('requires target_user_id when scope=user', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/kill-switch/trigger',
      payload: { reason: 'test', scope: 'user' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('triggers org-scope kill switch + writes audit', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/kill-switch/trigger',
      payload: { reason: 'org pause', scope: 'org' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.event.scope).toBe('org');
    expect(body.event.tenant_id).toBe(TENANT);
    expect(body.event.audit_hash).toMatch(/^aud[0-9a-f]+$/);

    const listed = await harness.wiring.killSwitchRepo.listForTenant(TENANT);
    expect(listed).toHaveLength(1);
  });

  it('user-scope trigger with target_user_id flips isActive', async () => {
    const targetUser = '00000000-0000-0000-0000-000000000077';
    const triggerRes = await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/kill-switch/trigger',
      payload: {
        reason: 'user revoked',
        scope: 'user',
        target_user_id: targetUser,
      },
    });
    expect(triggerRes.statusCode).toBe(201);

    const status = await harness.wiring.killSwitch.isActive(
      TENANT,
      targetUser,
    );
    expect(status.active).toBe(true);
  });
});

describe('GET /voice/ambient/kill-switch/active', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    harness = await buildHarness();
  });
  afterEach(async () => {
    await harness.app.close();
  });

  it('returns active=false on a fresh tenant', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/voice/ambient/kill-switch/active',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.active).toBe(false);
  });

  it('returns active=true after a matching trigger', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/kill-switch/trigger',
      payload: { reason: 'pause', scope: 'org' },
    });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/voice/ambient/kill-switch/active',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status.active).toBe(true);
    expect(res.json().status.scope).toBe('org');
  });
});
