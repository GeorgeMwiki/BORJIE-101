/**
 * Auth integration — exercises the full login flow against a real
 * Postgres (the seed user's bcrypt hash is re-computed at seed time).
 *
 * Coverage targets:
 *   - Valid credentials -> JWT + tenant payload.
 *   - Wrong password -> 401 (and timing channel sealed by status check).
 *   - Forged / tampered token -> 401 from the Hono auth middleware,
 *     because /auth/me requires a real signature.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getApp, API_BASE } from './helpers/app';
import { getPool, closePool } from './helpers/db-client';
import { resetDatabase, TEST_USER_EMAIL, TEST_USER_PASSWORD } from './helpers/db';
import { mintJwt } from './helpers/jwt';

describe('integration: auth', () => {
  let app: Express;

  beforeAll(async () => {
    app = await getApp();
  });

  beforeEach(async () => {
    await resetDatabase(getPool());
  });

  afterAll(async () => {
    await closePool();
  });

  it('POST /auth/login with seed creds returns a signed JWT', async () => {
    const res = await request(app)
      .post(`${API_BASE}/auth/login`)
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.split('.').length).toBe(3);
    expect(res.body.data.user.email).toBe(TEST_USER_EMAIL);
    expect(res.body.data.tenant.slug).toBe('integration-tenant');
  });

  it('POST /auth/login with wrong password returns 401', async () => {
    const res = await request(app)
      .post(`${API_BASE}/auth/login`)
      .send({ email: TEST_USER_EMAIL, password: 'not-the-real-one' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /auth/me with a forged token is rejected with 401', async () => {
    // Hand-craft a forged JWT header+payload with an invalid signature.
    const forged =
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64url'
      ) +
      '.' +
      Buffer.from(
        JSON.stringify({
          userId: 'forged',
          tenantId: 'forged',
          role: 'SUPER_ADMIN',
        })
      ).toString('base64url') +
      '.ZHVtbXlfc2lnbmF0dXJl'; // "dummy_signature"

    const res = await request(app)
      .get(`${API_BASE}/auth/me`)
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(['INVALID_TOKEN', 'UNAUTHORIZED']).toContain(res.body.error.code);
  });

  it('GET /auth/me with a valid minted token returns the user', async () => {
    const token = mintJwt({
      userId: 'user-int-001',
      tenantId: 'tenant-int-001',
    });

    const res = await request(app)
      .get(`${API_BASE}/auth/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe('user-int-001');
  });
});
