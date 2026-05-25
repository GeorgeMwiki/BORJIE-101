/**
 * Health endpoints must stay trivial — they're the liveness probe k8s
 * hits every 10s. If either /health or /healthz ever returns non-200
 * with a booted DB we page; catching it in CI is cheaper.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getApp } from './helpers/app';
import { closePool } from './helpers/db-client';

describe('integration: health', () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  afterAll(async () => {
    await closePool();
  });

  it('GET /health returns 200 with service payload', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'api-gateway',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('GET /healthz returns 200 (k8s-style alias)', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
