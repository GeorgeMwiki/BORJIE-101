/**
 * JWT auth gate + session-derived tenantId tests.
 *
 * P40 follow-up — proves:
 *   1. Routes refuse to run without a session (401)
 *   2. Public probes (/healthz, /readyz, /metrics) skip the gate
 *   3. tenantId in request body is IGNORED — session value wins
 *   4. Cross-tenant attempt (body says X, session says Y) emits a
 *      security event and persists to Y, never X.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index.js';
import { resetSecretCacheForTests } from '../middleware/auth.js';
import { createInMemoryStorageAdapter } from '@borjie/storage-adapter';
import {
  setSecurityEventSink,
  resetSecurityEventSink,
  type SecurityEvent,
} from '@borjie/observability';

const VALID_KEY = 'idempotent-test-key-9999';
const SESSION_TENANT = 'session-tenant-uuid';
const ATTACKER_TENANT = 'attacker-tenant-uuid';
const TEST_BYTES_BASE64 = Buffer.from('PNG-fake').toString('base64');

const sessionUser = {
  userId: 'session-user-1',
  tenantId: SESSION_TENANT,
  role: 'surveyor',
};
const sessionInjector = (): typeof sessionUser => sessionUser;

describe('field-capture-service — auth gate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // No testAuthInjector — exercises the real JWT path. The secret is
    // set so the gate runs to completion (request will fail because the
    // token isn't valid, not because the secret is missing).
    process.env.SUPABASE_JWT_SECRET = 'test-secret-at-least-ten-chars';
    resetSecretCacheForTests();
    app = await buildApp({});
  });

  afterEach(() => {
    delete process.env.SUPABASE_JWT_SECRET;
    resetSecretCacheForTests();
  });

  it('public probes bypass the gate (no token required)', async () => {
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
  });

  it('authenticated routes reject requests without a Bearer token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: { kind: 'photo', surveyorUserId: 'u1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_MISSING_TOKEN');
  });

  it('authenticated routes reject malformed Bearer tokens (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: {
        'idempotency-key': VALID_KEY,
        authorization: 'Bearer not-a-real-jwt',
      },
      payload: { kind: 'photo', surveyorUserId: 'u1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_INVALID_TOKEN');
  });
});

describe('field-capture-service — tenantId comes from session, not body', () => {
  let app: FastifyInstance;
  let adapter: ReturnType<typeof createInMemoryStorageAdapter>;
  let capturedEvents: SecurityEvent[];

  beforeEach(async () => {
    adapter = createInMemoryStorageAdapter();
    capturedEvents = [];
    setSecurityEventSink((evt) => {
      capturedEvents.push(evt);
    });
    app = await buildApp({
      storageAdapter: adapter,
      testAuthInjector: sessionInjector,
    });
  });

  afterEach(() => {
    resetSecurityEventSink();
  });

  it('CROSS-TENANT ATTEMPT: body says attacker tenant, session wins', async () => {
    // The body tries to drive uploads into ATTACKER_TENANT's prefix.
    // The session belongs to SESSION_TENANT. The file MUST land under
    // SESSION_TENANT and a tenant_mismatch security event MUST fire.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: ATTACKER_TENANT, // ← ignored
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(201);

    const sessionObjs = await adapter.list('media-photos', `${SESSION_TENANT}/`);
    const attackerObjs = await adapter.list('media-photos', `${ATTACKER_TENANT}/`);
    expect(sessionObjs.length).toBe(1);
    expect(attackerObjs.length).toBe(0);

    // A tenant_mismatch event was recorded.
    const mismatchEvent = capturedEvents.find((e) =>
      e.action.endsWith('.tenant_mismatch'),
    );
    expect(mismatchEvent).toBeDefined();
    expect(mismatchEvent?.severity).toBe('warn');
    expect(mismatchEvent?.tenantId).toBe(SESSION_TENANT);
    expect(mismatchEvent?.actorId).toBe(sessionUser.userId);
    const detail = mismatchEvent?.detail as {
      bodyTenantId?: string;
      sessionTenantId?: string;
    };
    expect(detail?.bodyTenantId).toBe(ATTACKER_TENANT);
    expect(detail?.sessionTenantId).toBe(SESSION_TENANT);
  });

  it('omitting body tenantId works — session is authoritative', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        // No tenantId — session value should still work.
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(201);
    const sessionObjs = await adapter.list('media-photos', `${SESSION_TENANT}/`);
    expect(sessionObjs.length).toBe(1);
    // No mismatch event — body didn't supply a value.
    expect(
      capturedEvents.find((e) => e.action.endsWith('.tenant_mismatch')),
    ).toBeUndefined();
  });

  it('matching body tenantId emits no security event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: SESSION_TENANT, // matches session
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(
      capturedEvents.find((e) => e.action.endsWith('.tenant_mismatch')),
    ).toBeUndefined();
  });

  it('sync route also rejects cross-tenant body tenantId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/sync',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        surveyorUserId: 'u1',
        tenantId: ATTACKER_TENANT, // ← ignored, session wins
        captures: [{ kind: 'audio', bytesBase64: TEST_BYTES_BASE64 }],
      },
    });
    expect(res.statusCode).toBe(202);
    expect((await adapter.list('media-audio', `${SESSION_TENANT}/`)).length).toBe(1);
    expect((await adapter.list('media-audio', `${ATTACKER_TENANT}/`)).length).toBe(0);
    const mismatchEvent = capturedEvents.find((e) =>
      e.action === 'field.capture.sync.tenant_mismatch',
    );
    expect(mismatchEvent).toBeDefined();
  });

  it('polygon route uses session tenant for parcel records', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/parcels/parcel-x/polygon',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        surveyorUserId: 'u1',
        tenantId: ATTACKER_TENANT, // ← ignored, session wins
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [36.82, -1.28],
            [36.83, -1.28],
            [36.83, -1.27],
            [36.82, -1.27],
            [36.82, -1.28],
          ]],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const mismatchEvent = capturedEvents.find((e) =>
      e.action === 'field.parcel.polygon.tenant_mismatch',
    );
    expect(mismatchEvent).toBeDefined();
    expect(mismatchEvent?.tenantId).toBe(SESSION_TENANT);
  });
});
