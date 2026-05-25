/**
 * Gamification — the router's surface is GET /policies and
 * GET /customers/:id. Directly inserting a PaymentPosted event via
 * the repo is the simplest way to exercise the accrual path, but the
 * router test here focuses on the read paths and policy roundtrip
 * since the evaluate flow is driven by the payments service in prod.
 *
 * A pure-read integration still catches the three things we care
 * about: (1) policy seeded by migrations is resolvable by the
 * gateway's composition root, (2) customer state defaults to `bronze`
 * with score 0 for a never-paid customer, and (3) policy updates
 * persist and bump the version.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getApp, API_BASE } from './helpers/app';
import { getPool, closePool } from './helpers/db-client';
import {
  resetDatabase,
  TEST_TENANT_ID,
  TEST_CUSTOMER_ID,
} from './helpers/db';
import { mintJwt } from './helpers/jwt';

describe('integration: gamification', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    app = await getApp();
    token = mintJwt({ userId: 'user-int-001', tenantId: TEST_TENANT_ID });
  });

  beforeEach(async () => {
    await resetDatabase(getPool());
  });

  afterAll(async () => {
    await closePool();
  });

  it('GET /gamification/policies returns the active reward policy', async () => {
    const res = await request(app)
      .get(`${API_BASE}/gamification/policies`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenantId).toBe(TEST_TENANT_ID);
    expect(res.body.data.onTimePoints).toBe(10);
  });

  it('GET /gamification/customers/:id returns bronze default for untouched customer', async () => {
    const res = await request(app)
      .get(`${API_BASE}/gamification/customers/${TEST_CUSTOMER_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tier).toBe('bronze');
    expect(res.body.data.score).toBe(0);
  });

  it('PUT /gamification/policies updates and bumps version', async () => {
    const res = await request(app)
      .put(`${API_BASE}/gamification/policies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ onTimePoints: 25, earlyPaymentBonusPoints: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.onTimePoints).toBe(25);
    expect(res.body.data.earlyPaymentBonusPoints).toBe(10);
    expect(res.body.data.version).toBeGreaterThan(1);

    const rows = await getPool()`
      SELECT version, on_time_points
      FROM reward_policies
      WHERE tenant_id = ${TEST_TENANT_ID}
      ORDER BY version DESC
      LIMIT 1
    `;
    expect(Number(rows[0]?.on_time_points)).toBe(25);
    expect(Number(rows[0]?.version)).toBeGreaterThan(1);
  });
});
