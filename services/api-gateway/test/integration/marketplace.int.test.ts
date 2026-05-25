/**
 * Marketplace listings — real Postgres + real ListingService.
 *
 * What we verify:
 *   - POST /marketplace/listings inserts a row and returns 201.
 *   - GET /marketplace/listings echoes the posted listing.
 *   - A listing owned by tenant A is INVISIBLE to tenant B (the
 *     cross-tenant read MUST return an empty page, never 403 — we
 *     don't want to leak existence).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getApp, API_BASE } from './helpers/app';
import { getPool, closePool } from './helpers/db-client';
import {
  resetDatabase,
  TEST_TENANT_ID,
  OTHER_TENANT_ID,
  TEST_UNIT_ID,
} from './helpers/db';
import { mintJwt } from './helpers/jwt';

describe('integration: marketplace', () => {
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

  function tokenFor(tenantId: string): string {
    return mintJwt({ userId: 'user-int-001', tenantId, role: 'TENANT_ADMIN' });
  }

  it('POST and GET round-trip persists a listing for the posting tenant', async () => {
    const token = tokenFor(TEST_TENANT_ID);

    const createRes = await request(app)
      .post(`${API_BASE}/marketplace/listings`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        unitId: TEST_UNIT_ID,
        listingKind: 'rent',
        headlinePrice: 1_200_000,
        currency: 'TZS',
        publishImmediately: true,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.unitId).toBe(TEST_UNIT_ID);
    expect(createRes.body.data.status).toBe('published');

    const listRes = await request(app)
      .get(`${API_BASE}/marketplace/listings`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    const found = listRes.body.data.find(
      (l: { unitId: string }) => l.unitId === TEST_UNIT_ID
    );
    expect(found).toBeDefined();
    expect(found.headlinePrice).toBe(1_200_000);
  });

  it('cross-tenant GET returns no rows from the other tenant', async () => {
    // Post as tenant A.
    const aToken = tokenFor(TEST_TENANT_ID);
    await request(app)
      .post(`${API_BASE}/marketplace/listings`)
      .set('Authorization', `Bearer ${aToken}`)
      .send({
        unitId: TEST_UNIT_ID,
        listingKind: 'rent',
        headlinePrice: 1_500_000,
        currency: 'TZS',
        publishImmediately: true,
      });

    // Read as tenant B — the repo's tenant_id predicate must hide the row.
    const bToken = tokenFor(OTHER_TENANT_ID);
    const listRes = await request(app)
      .get(`${API_BASE}/marketplace/listings`)
      .set('Authorization', `Bearer ${bToken}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data)).toBe(true);
    expect(listRes.body.data.length).toBe(0);
  });
});
