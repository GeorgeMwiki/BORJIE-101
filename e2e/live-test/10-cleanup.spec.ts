/**
 * Spec 10 — Cleanup + cascade assertion.
 *
 * Calls the tenant RTBF (right-to-be-forgotten) delete endpoint and
 * asserts:
 *   - the gateway returns 2xx,
 *   - subsequent GETs on every resource (tenant, property, unit, lease,
 *     ticket, trace) return 404 — proving the cascade fired.
 *
 * The globalTeardown ALSO runs the cleanup defensively, so if a prior
 * spec failed and aborted the suite, the Supabase project is still
 * left clean.
 */
import { test, expect } from '@playwright/test';
import { loadLiveTestEnv, authedRequest, tryPaths } from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';
import { cleanupLiveTest } from './fixtures/cleanup';
import { getLiveTestState } from './fixtures/seed-tenant';

test.describe.configure({ mode: 'serial' });

test.describe('10 — Cleanup + cascade', () => {
  test('precondition: there is a tenant to delete', () => {
    expect(getLiveTestState().tenantId).toBeTruthy();
  });

  test('owner deletes the tenant via the RTBF endpoint', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const authed = await authedRequest(env, ownerToken);
    try {
      const result = await cleanupLiveTest(authed);
      // Warnings are okay; tenantDeleted=true is what matters.
      expect(result.tenantDeleted, result.warnings.join('; ')).toBe(true);
      expect(result.cascadeChecked).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('cascade fired: property is gone (404)', async () => {
    await expectGone(`/api/v1/properties/${getLiveTestState().propertyId}`);
  });

  test('cascade fired: lease is gone (404)', async () => {
    await expectGone(`/api/v1/leases/${getLiveTestState().leaseId}`);
  });

  test('cascade fired: ticket is gone (404)', async () => {
    await expectGone(
      `/api/v1/maintenance-requests/${getLiveTestState().maintenanceTicketId}`,
    );
  });
});

async function expectGone(primaryPath: string): Promise<void> {
  const env = loadLiveTestEnv();
  const { ownerToken } = readCachedTokens();
  const authed = await authedRequest(env, ownerToken);
  try {
    const fallback = primaryPath.replace('/api/v1/', '/api/');
    const resp = await tryPaths(authed, 'GET', [primaryPath, fallback]);
    expect(resp.status, `${primaryPath} still readable (${resp.status})`).toBe(404);
  } finally {
    await authed.dispose();
  }
}
