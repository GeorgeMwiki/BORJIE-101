/**
 * Spec 03 — Owner adds their first property + 4 units.
 *
 * Builds on spec 02's tenant. The property + units are created through
 * the api-gateway under the owner's tenant context, so the gateway
 * rebinds the `app.tenant_id` GUC and the RLS policies on `properties`
 * and `units` (migrations 0155/0156) fire on every insert + select.
 */
import { test, expect } from '@playwright/test';
import {
  loadLiveTestEnv,
  authedRequest,
} from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';
import { seedProperty } from './fixtures/seed-property';
import { getLiveTestState } from './fixtures/seed-tenant';

test.describe.configure({ mode: 'serial' });

test.describe('03 — Property + 4 units', () => {
  test('precondition: tenant exists from spec 02', () => {
    expect(getLiveTestState().tenantId).toBeTruthy();
  });

  test('owner creates a property with 4 units', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const authed = await authedRequest(env, ownerToken);
    try {
      const result = await seedProperty(authed);
      expect(result.propertyId).toBeTruthy();
      expect(result.unitIds).toHaveLength(4);
      // unit ids should be unique
      expect(new Set(result.unitIds).size).toBe(4);
    } finally {
      await authed.dispose();
    }
  });

  test('owner can list their units (all 4 visible)', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const propertyId = getLiveTestState().propertyId;
    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await authed.request.get(
        `/api/v1/units?propertyId=${encodeURIComponent(propertyId!)}`,
        { failOnStatusCode: false },
      );
      // Some builds expose the units under the property resource directly.
      let units: unknown[];
      if (resp.status() === 404) {
        const alt = await authed.request.get(
          `/api/v1/properties/${encodeURIComponent(propertyId!)}/units`,
        );
        expect(alt.status()).toBe(200);
        const altBody = (await alt.json()) as {
          data?: unknown[];
          items?: unknown[];
        };
        units = altBody.data ?? altBody.items ?? [];
      } else {
        expect(resp.status()).toBe(200);
        const body = (await resp.json()) as {
          data?: unknown[];
          items?: unknown[];
        };
        units = body.data ?? body.items ?? [];
      }
      expect(units.length).toBeGreaterThanOrEqual(4);
    } finally {
      await authed.dispose();
    }
  });
});
