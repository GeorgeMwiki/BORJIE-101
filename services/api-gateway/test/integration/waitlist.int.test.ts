/**
 * Waitlist integration — join/list/leave lifecycle backed by the
 * Postgres unit_waitlists table.
 *
 * The critical behaviour we're asserting is that `leave` flips the
 * status to `opted_out` and persists a reason — an auditable opt-out
 * is what lets us honour "don't contact me" preferences downstream.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getApp, API_BASE } from './helpers/app';
import { getPool, closePool } from './helpers/db-client';
import {
  resetDatabase,
  TEST_TENANT_ID,
  TEST_UNIT_ID,
  TEST_CUSTOMER_ID,
} from './helpers/db';
import { mintJwt } from './helpers/jwt';

describe('integration: waitlist', () => {
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

  it('join -> list -> leave preserves opt_out reason', async () => {
    const token = mintJwt({
      userId: 'user-int-001',
      tenantId: TEST_TENANT_ID,
    });

    // Join.
    const joinRes = await request(app)
      .post(`${API_BASE}/waitlist/units/${TEST_UNIT_ID}/join`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: TEST_CUSTOMER_ID,
        priority: 100,
        source: 'enquiry',
        preferredChannels: ['sms', 'email'],
      });

    expect(joinRes.status).toBe(201);
    expect(joinRes.body.success).toBe(true);
    const waitlistId = joinRes.body.data.id;
    expect(typeof waitlistId).toBe('string');

    // List — must include the newly joined entry.
    const listRes = await request(app)
      .get(`${API_BASE}/waitlist/units/${TEST_UNIT_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    const found = listRes.body.data.find(
      (w: { id: string }) => w.id === waitlistId
    );
    expect(found).toBeDefined();
    expect(found.status).toBe('active');

    // Leave with a reason.
    const leaveRes = await request(app)
      .post(`${API_BASE}/waitlist/${waitlistId}/leave`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'found another place' });
    expect(leaveRes.status).toBe(200);

    // Verify the opt-out was persisted.
    const rows =
      await getPool()`SELECT status, opt_out_reason FROM unit_waitlists WHERE id = ${waitlistId}`;
    expect(rows[0]?.status).toBe('opted_out');
    expect(rows[0]?.opt_out_reason).toBe('found another place');
  });
});
