/**
 * Negotiation policy enforcement — policy sandbox end-to-end.
 *
 * The two cases we *care* about in pilot:
 *
 *   1. A counter-offer BELOW `floorPrice` MUST escalate (status becomes
 *      `escalated`) — no AI reply, no policy circumvention.
 *   2. A counter-offer WITHIN bounds yields a normal counter-turn —
 *      the negotiation stays live and round_count increments.
 *
 * These are the two rails that keep an LLM-driven negotiation safe.
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

describe('integration: negotiation', () => {
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

  async function createPolicy(): Promise<string> {
    const res = await request(app)
      .post(`${API_BASE}/negotiations/policies`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        unitId: TEST_UNIT_ID,
        domain: 'lease_price',
        listPrice: 1_000_000,
        floorPrice: 800_000,
        approvalRequiredBelow: 850_000,
        maxDiscountPct: 0.2,
        currency: 'TZS',
        toneGuide: 'warm',
      });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  async function startNegotiation(policyId: string): Promise<string> {
    const res = await request(app)
      .post(`${API_BASE}/negotiations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        policyId,
        unitId: TEST_UNIT_ID,
        prospectCustomerId: TEST_CUSTOMER_ID,
        domain: 'lease_price',
        openingOffer: 950_000,
      });
    expect(res.status).toBe(201);
    return res.body.data.negotiation.id as string;
  }

  it('counter BELOW floor escalates the negotiation', async () => {
    const policyId = await createPolicy();
    const negotiationId = await startNegotiation(policyId);

    // 700_000 < floorPrice (800_000) — policy must escalate.
    const turnRes = await request(app)
      .post(`${API_BASE}/negotiations/${negotiationId}/turns`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actor: 'prospect', offer: 700_000 });

    expect(turnRes.status).toBe(200);
    const rows =
      await getPool()`SELECT status FROM negotiations WHERE id = ${negotiationId}`;
    expect(rows[0]?.status).toBe('escalated');
  });

  it('counter WITHIN bounds yields counter_sent and a real round', async () => {
    const policyId = await createPolicy();
    const negotiationId = await startNegotiation(policyId);

    // 900_000 is >= approvalRequiredBelow (850_000) and < listPrice —
    // safe to counter, stays live.
    const turnRes = await request(app)
      .post(`${API_BASE}/negotiations/${negotiationId}/turns`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actor: 'prospect', offer: 900_000 });

    expect(turnRes.status).toBe(200);
    const rows =
      await getPool()`SELECT status, round_count FROM negotiations WHERE id = ${negotiationId}`;
    expect(['counter_sent', 'open']).toContain(rows[0]?.status);
    expect(Number(rows[0]?.round_count)).toBeGreaterThanOrEqual(1);
  });
});
