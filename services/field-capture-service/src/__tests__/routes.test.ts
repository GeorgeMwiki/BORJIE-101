import { describe, expect, it, beforeEach } from 'vitest';
import { buildApp } from '../index.js';
import { createInMemoryCaptureStore } from '@borjie/geo-intelligence';
import type { FastifyInstance } from 'fastify';

const VALID_KEY = 'idempotent-test-key-9999';
const TENANT_T1 = 't1';
const SESSION_USER_U1 = { userId: 'u1', tenantId: TENANT_T1, role: 'surveyor' };

/** Default test auth injector — every test route gets the same authenticated user. */
const defaultInjector = () => SESSION_USER_U1;

describe('field-capture-service — health + metrics', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp({ testAuthInjector: defaultInjector });
  });

  it('healthz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'field-capture-service' });
  });

  it('readyz returns ready', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', service: 'field-capture-service' });
  });

  it('metrics endpoint serves text', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });
});

describe('POST /v1/field/capture/photo', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp({ testAuthInjector: defaultInjector });
  });

  it('rejects when idempotency-key header missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      payload: { kind: 'photo', surveyorUserId: 'u1', tenantId: 't1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/idempotency-key/);
  });

  it('rejects malformed body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a photo with explicit GPS location', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: 't1',
        capturedLocation: { lat: -1.28, lng: 36.82 },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.captures[0].kind).toBe('photo');
    expect(body.captures[0].status).toBe('processed');
  });

  it('rejects a photo without GPS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/photo',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'photo',
        surveyorUserId: 'u1',
        tenantId: 't1',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.captures[0].status).toBe('rejected');
  });
});

describe('POST /v1/field/capture/video|audio|inspection', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp({ testAuthInjector: defaultInjector });
  });

  it('video accepts a storageUri', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/video',
      headers: { 'idempotency-key': VALID_KEY },
      payload: { kind: 'video', surveyorUserId: 'u1', tenantId: 't1', storageUri: 's3://video' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().captures[0].kind).toBe('video');
  });

  it('audio accepts a storageUri without GPS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/audio',
      headers: { 'idempotency-key': VALID_KEY },
      payload: { kind: 'audio', surveyorUserId: 'u1', tenantId: 't1', storageUri: 's3://audio' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().captures[0].kind).toBe('audio');
  });

  it('inspection accepts a checklist metadata blob', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/inspection',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        kind: 'inspection',
        surveyorUserId: 'u1',
        tenantId: 't1',
        metadata: { roomsChecked: 3, issuesFound: ['leak'] },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().captures[0].kind).toBe('inspection');
  });
});

describe('POST /v1/field/capture/sync', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp({ testAuthInjector: defaultInjector });
  });

  it('accepts a batch and returns counts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/sync',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        surveyorUserId: 'u1',
        tenantId: 't1',
        captures: [
          { kind: 'audio' },
          { kind: 'inspection', metadata: { foo: 1 } },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().accepted).toBe(2);
  });

  it('rejects empty captures', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/capture/sync',
      headers: { 'idempotency-key': VALID_KEY },
      payload: { surveyorUserId: 'u1', tenantId: 't1', captures: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /v1/field/queue/:surveyorId', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof createInMemoryCaptureStore>;
  beforeEach(async () => {
    store = createInMemoryCaptureStore();
    app = await buildApp({ store, testAuthInjector: defaultInjector });
  });

  it('returns empty queue when no captures', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/field/queue/u1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().queued).toEqual([]);
  });

  it('returns processed captures after submission', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/field/capture/audio',
      headers: { 'idempotency-key': VALID_KEY },
      payload: { kind: 'audio', surveyorUserId: 'u1', tenantId: 't1' },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/field/queue/u1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed.length).toBe(1);
  });
});

describe('POST /v1/field/parcels/:id/polygon', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp({ testAuthInjector: defaultInjector });
  });

  it('accepts a closed polygon', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/parcels/parcel-1/polygon',
      headers: { 'idempotency-key': VALID_KEY },
      payload: {
        surveyorUserId: 'u1',
        tenantId: 't1',
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
    expect(res.json().parcelId).toBe('parcel-1');
  });

  it('rejects without idempotency key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/field/parcels/parcel-1/polygon',
      payload: { surveyorUserId: 'u1', tenantId: 't1', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } },
    });
    expect(res.statusCode).toBe(400);
  });
});
