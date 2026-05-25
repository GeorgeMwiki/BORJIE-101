/**
 * Storage-adapter wiring regression tests.
 *
 * Proves that when the field-capture-service is built with a
 * `storageAdapter`, every inline-base64 capture lands at
 * `<bucket>/<tenantId>/<captureId>` and tenant B cannot pre-empt
 * tenant A's path. Closes the chain-6 wiring gap from
 * Docs/WIRING_GAPS_2026-05-24.md — before this change, the adapter
 * had ZERO non-self consumers and inline bytes were never persisted
 * to the canonical bucket.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  createInMemoryStorageAdapter,
  tenantScopedPath,
} from '@borjie/storage-adapter';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildApp } from '../index.js';

const VALID_KEY = 'idempotent-test-key-9999';
const TENANT_A = 'tenant-a-uuid';
const TENANT_B = 'tenant-b-uuid';

/**
 * Reads the body's `tenantId` to mint a fake session user so we can
 * exercise both tenants from one app instance. This mirrors the
 * production path where the JWT's `tenant_id` claim drives the storage
 * scope — the body is only used here to pick which session to fake.
 */
function injectFromBodyTenant(
  request: FastifyRequest,
): { userId: string; tenantId: string; role: string } | undefined {
  const body = request.body as { tenantId?: string; surveyorUserId?: string } | null;
  const tenantId = body?.tenantId;
  if (!tenantId) return undefined;
  return {
    userId: body?.surveyorUserId ?? 'test-user',
    tenantId,
    role: 'surveyor',
  };
}

// 8-byte "PNG" stub so the base64 path exercises the upload but the
// EXIF parser bails gracefully.
const TEST_BYTES_BASE64 = Buffer.from('PNG-fake').toString('base64');

describe('field-capture-service — storage-adapter wiring', () => {
  let app: FastifyInstance;
  let adapter: ReturnType<typeof createInMemoryStorageAdapter>;

  beforeEach(async () => {
    adapter = createInMemoryStorageAdapter();
    app = await buildApp({
      storageAdapter: adapter,
      testAuthInjector: injectFromBodyTenant,
    });
  });

  it('photo with inline bytes is persisted under tenantScopedPath', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: TENANT_A,
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(201);

    // The object physically landed under tenantA/<captureId>.
    const objects = await adapter.list('media-photos', `${TENANT_A}/`);
    expect(objects.length).toBe(1);
    expect(objects[0].path.startsWith(`${TENANT_A}/`)).toBe(true);

    // Nothing landed in any other tenant's prefix.
    const tenantBObjects = await adapter.list('media-photos', `${TENANT_B}/`);
    expect(tenantBObjects.length).toBe(0);

    // The capture record carries a storageUri pointing at the
    // tenant-scoped path (no bytesBase64 echoed back).
    const body = res.json();
    expect(body.captures[0].storageUri).toContain(TENANT_A);
    expect(body.captures[0].storageUri).not.toContain(TENANT_B);
  });

  it('video with inline bytes is persisted to media-videos bucket', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/video',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'video',
        surveyorUserId: 'u1',
        tenantId: TENANT_A,
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(201);

    const objects = await adapter.list('media-videos', `${TENANT_A}/`);
    expect(objects.length).toBe(1);
  });

  it('audio with inline bytes is persisted to media-audio bucket', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/audio',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'audio',
        surveyorUserId: 'u1',
        tenantId: TENANT_A,
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(201);

    const objects = await adapter.list('media-audio', `${TENANT_A}/`);
    expect(objects.length).toBe(1);
  });

  it('TENANT ISOLATION: tenant A bytes do not land in tenant B prefix', async () => {
    // Tenant A uploads.
    await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY + '-a' },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: TENANT_A,
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });

    // Tenant B uploads.
    await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY + '-b' },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u2',
        tenantId: TENANT_B,
        capturedLocation: { lat: -1.29, lng: 36.83 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });

    const aObjects = await adapter.list('media-photos', `${TENANT_A}/`);
    const bObjects = await adapter.list('media-photos', `${TENANT_B}/`);
    expect(aObjects.length).toBe(1);
    expect(bObjects.length).toBe(1);

    // No cross-tenant bleed — A's path does NOT start with B's prefix
    // and vice versa.
    expect(aObjects[0].path.startsWith(`${TENANT_A}/`)).toBe(true);
    expect(aObjects[0].path.startsWith(`${TENANT_B}/`)).toBe(false);
    expect(bObjects[0].path.startsWith(`${TENANT_B}/`)).toBe(true);
    expect(bObjects[0].path.startsWith(`${TENANT_A}/`)).toBe(false);
  });

  it('TENANT ISOLATION: forged tenantId in B routes file into B-scoped path (cannot prefix-clobber A)', async () => {
    // First, A uploads a file.
    await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY + '-aa' },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: TENANT_A,
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    const initialACount = (await adapter.list('media-photos', `${TENANT_A}/`)).length;

    // Now B attempts to upload using B's tenantId. Even if the
    // payload tries to convey other tenant identifiers in metadata,
    // the storage path is built from `tenantScopedPath(tenantId, ...)`
    // — so the file MUST land in B's prefix.
    await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY + '-bb' },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u2',
        tenantId: TENANT_B,
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
        metadata: { spoofedTenantId: TENANT_A },
      },
    });

    // A's prefix is unchanged.
    expect((await adapter.list('media-photos', `${TENANT_A}/`)).length).toBe(initialACount);
    // B got their own file.
    expect((await adapter.list('media-photos', `${TENANT_B}/`)).length).toBe(1);
  });

  it('AUTH GATE: rejects with 401 when no session is established', async () => {
    // injectFromBodyTenant returns undefined when body has no tenantId,
    // which mirrors a request that arrives with no JWT bearer at all.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        // No tenantId — the test injector returns undefined → 401.
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_MISSING_TOKEN');
  });

  it('rejects tenantId containing slash (path-traversal guard from tenantScopedPath)', async () => {
    // The session carries the slashed tenantId — the storage helper
    // refuses it. This is defence-in-depth on the storage side; the
    // primary guarantee is that the slashed string can never reach the
    // helper unless the JWT was itself minted with a bogus tenant_id.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: 'tenantA/../tenantB',
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/storage upload failed/);
  });

  it('sync route persists each capture\'s inline bytes to its own object', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/sync',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        surveyorUserId: 'u1',
        tenantId: TENANT_A,
        captures: [
          { kind: 'audio', bytesBase64: TEST_BYTES_BASE64 },
          { kind: 'video', bytesBase64: TEST_BYTES_BASE64 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);

    expect((await adapter.list('media-audio', `${TENANT_A}/`)).length).toBe(1);
    expect((await adapter.list('media-videos', `${TENANT_A}/`)).length).toBe(1);
  });
});

describe('field-capture-service — backward compat WITHOUT adapter', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // No storageAdapter dependency — verifies the legacy path still
    // works exactly as before (inline bytes are hashed but not stored
    // anywhere — caller's responsibility to pre-upload).
    app = await buildApp({ testAuthInjector: injectFromBodyTenant });
  });

  it('photo with inline bytes still succeeds without an adapter wired', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: TENANT_A,
        capturedLocation: { lat: -1.28, lng: 36.82 },
        bytesBase64: TEST_BYTES_BASE64,
      },
    });
    expect(res.statusCode).toBe(201);
    // No storageUri is set — caller didn't supply one and the adapter
    // is absent, so the pipeline records the capture without a blob
    // pointer.
    const body = res.json();
    expect(body.captures[0].storageUri).toBeUndefined();
  });
});

describe('field-capture-service — tenantScopedPath helper smoke', () => {
  it('composes paths used by the storage adapter', () => {
    expect(tenantScopedPath(TENANT_A, 'abc-123')).toBe(`${TENANT_A}/abc-123`);
    expect(tenantScopedPath(TENANT_B, '/abc-123')).toBe(`${TENANT_B}/abc-123`);
  });
});
