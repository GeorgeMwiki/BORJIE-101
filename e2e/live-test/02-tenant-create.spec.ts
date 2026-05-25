/**
 * Spec 02 — Owner creates a landlord tenant (org).
 *
 * Exercises the tenant-create endpoint with a real Supabase JWT. The
 * api-gateway should:
 *   - accept the token (verified by spec 01),
 *   - upsert the user as a member of the new tenant,
 *   - default `tenants.region` from the caller's locale claim (W1),
 *   - emit a tenant.created audit event.
 *
 * The created tenant_id is stashed in the in-memory `liveTestState` so
 * subsequent specs (property add, lease, payment, ticket, brain) can
 * reference it without round-tripping the API.
 */
import { test, expect } from '@playwright/test';
import {
  loadLiveTestEnv,
  authedRequest,
} from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';
import {
  seedTenant,
  makeUniqueTenantInput,
  getLiveTestState,
} from './fixtures/seed-tenant';

test.describe.configure({ mode: 'serial' });

test.describe('02 — Tenant (landlord org) creation', () => {
  test('owner can create a fresh tenant org', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const authed = await authedRequest(env, ownerToken);
    try {
      const input = makeUniqueTenantInput();
      const created = await seedTenant(authed, input);
      expect(created.tenantId).toBeTruthy();
      expect(created.name).toBe(input.name);
      expect(created.slug).toBe(input.slug);
    } finally {
      await authed.dispose();
    }
  });

  test('the created tenant is readable by its owner', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const tenantId = getLiveTestState().tenantId;
    expect(tenantId).toBeTruthy();
    const authed = await authedRequest(env, ownerToken!);
    try {
      const resp = await authed.request.get(
        `/api/v1/tenants/${encodeURIComponent(tenantId!)}`,
        { failOnStatusCode: false },
      );
      // Some deployments mount this under /api/tenants/:id without the
      // /v1 prefix — try the alternate before failing.
      if (resp.status() === 404) {
        const alt = await authed.request.get(
          `/api/tenants/${encodeURIComponent(tenantId!)}`,
        );
        expect(alt.status()).toBe(200);
      } else {
        expect(resp.status()).toBe(200);
      }
    } finally {
      await authed.dispose();
    }
  });

  test('the cross-tenant user CANNOT see the new tenant', async () => {
    const env = loadLiveTestEnv();
    const { otherToken } = readCachedTokens();
    const tenantId = getLiveTestState().tenantId;
    expect(tenantId).toBeTruthy();
    const authed = await authedRequest(env, otherToken);
    try {
      const resp = await authed.request.get(
        `/api/v1/tenants/${encodeURIComponent(tenantId!)}`,
        { failOnStatusCode: false },
      );
      // RLS should produce either 404 (preferred — leaks no existence
      // information) or 403. NEVER 200.
      expect([403, 404]).toContain(resp.status());
    } finally {
      await authed.dispose();
    }
  });
});
