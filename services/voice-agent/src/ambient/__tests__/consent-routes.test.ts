import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authMiddleware } from '../../middleware/auth.js';
import { registerConsentRoutes } from '../consent-routes.js';
import { createAmbientWiring, type AmbientWiring } from '../pipeline-wire.js';

const TENANT = 'route-tenant-1';
const USER = '00000000-0000-0000-0000-000000000001';

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
      userId: USER,
      tenantId: TENANT,
      role: 'admin',
    }),
  });
  registerConsentRoutes(app, { wiring });
  await app.ready();
  return { app, wiring };
}

describe('POST /voice/ambient/consent/grant', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    harness = await buildHarness();
  });
  afterEach(async () => {
    await harness.app.close();
  });

  it('rejects invalid body with 400', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/consent/grant',
      payload: { channel: 'something-bogus' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('grants consent + returns the row + persists', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/consent/grant',
      payload: { channel: 'voice_call', sentiment_consent: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.consent.consent_state).toBe('granted');
    expect(body.consent.tenant_id).toBe(TENANT);
    expect(body.consent.user_id).toBe(USER);
    expect(body.consent.channel).toBe('voice_call');
    expect(body.consent.sentiment_consent).toBe(true);

    const stored = await harness.wiring.consentsRepo.get(
      TENANT,
      USER,
      'voice_call',
    );
    expect(stored?.consent_state).toBe('granted');
  });
});

describe('POST /voice/ambient/consent/revoke', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    harness = await buildHarness();
  });
  afterEach(async () => {
    await harness.app.close();
  });

  it('revokes after grant', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/consent/grant',
      payload: { channel: 'chat' },
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/consent/revoke',
      payload: { channel: 'chat' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().consent.consent_state).toBe('revoked');
  });
});

describe('GET /voice/ambient/consent/check', () => {
  let harness: TestHarness;
  beforeEach(async () => {
    harness = await buildHarness();
  });
  afterEach(async () => {
    await harness.app.close();
  });

  it('returns may_listen=false for not-set channels', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/voice/ambient/consent/check?channel=sms',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.may_listen).toBe(false);
    expect(res.json().result.effective_state).toBe('not-set');
  });

  it('returns may_listen=true after grant', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/voice/ambient/consent/grant',
      payload: { channel: 'chat' },
    });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/voice/ambient/consent/check?channel=chat',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.may_listen).toBe(true);
    expect(res.json().result.effective_state).toBe('granted');
  });

  it('rejects invalid channel query', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/voice/ambient/consent/check?channel=nope',
    });
    expect(res.statusCode).toBe(400);
  });
});
