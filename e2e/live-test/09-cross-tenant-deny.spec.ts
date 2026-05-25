/**
 * Spec 09 — Cross-tenant deny (the deliberate RLS smoke test).
 *
 * This is the ONLY spec in the live-test suite that EXPECTS a deny.
 * Every other spec asserts a working happy path; here we verify that
 * `otherToken` (a user from an unrelated tenant) cannot see ANY of
 * the resources spec 02-08 created for `ownerToken`.
 *
 * Failure here means RLS is misconfigured — production blocker.
 *
 * Surfaces probed:
 *   - GET /tenants/:id        (tenant from spec 02)
 *   - GET /properties/:id     (property from spec 03)
 *   - GET /units/:id          (unit from spec 03)
 *   - GET /leases/:id         (lease from spec 05)
 *   - GET /payments?leaseId=  (payment from spec 06)
 *   - GET /maintenance-requests/:id (ticket from spec 07)
 *   - GET /brain/traces/:id   (trace from spec 08)
 *
 * Each MUST return 403 or 404 (RLS prefers 404 to leak nothing).
 */
import { test, expect } from '@playwright/test';
import { loadLiveTestEnv, authedRequest, tryPaths } from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';
import { getLiveTestState } from './fixtures/seed-tenant';

test.describe.configure({ mode: 'serial' });

test.describe('09 — Cross-tenant deny (RLS smoke)', () => {
  test('precondition: every resource from specs 02-08 exists', () => {
    const state = getLiveTestState();
    expect(state.tenantId).toBeTruthy();
    expect(state.propertyId).toBeTruthy();
    expect(state.unitIds?.[0]).toBeTruthy();
    expect(state.leaseId).toBeTruthy();
    expect(state.maintenanceTicketId).toBeTruthy();
  });

  test('other tenant CANNOT read our tenant row', async () => {
    await expectDeny(`/api/v1/tenants/${getLiveTestState().tenantId}`);
  });

  test('other tenant CANNOT read our property', async () => {
    await expectDeny(`/api/v1/properties/${getLiveTestState().propertyId}`);
  });

  test('other tenant CANNOT read our unit', async () => {
    await expectDeny(`/api/v1/units/${getLiveTestState().unitIds?.[0]}`);
  });

  test('other tenant CANNOT read our lease', async () => {
    await expectDeny(`/api/v1/leases/${getLiveTestState().leaseId}`);
  });

  test('other tenant gets empty payments list when filtering on our leaseId', async () => {
    const env = loadLiveTestEnv();
    const { otherToken } = readCachedTokens();
    const leaseId = getLiveTestState().leaseId;
    const authed = await authedRequest(env, otherToken);
    try {
      const resp = await tryPaths(authed, 'GET', [
        `/api/v1/payments?leaseId=${encodeURIComponent(leaseId!)}`,
        `/api/payments?leaseId=${encodeURIComponent(leaseId!)}`,
      ]);
      // 200 with empty list OR 403/404 are all acceptable. NEVER a list
      // that contains our payment.
      if (resp.status === 200) {
        const body = resp.body as {
          data?: unknown[];
          items?: unknown[];
        };
        const list = body?.data ?? body?.items ?? [];
        expect(list).toHaveLength(0);
      } else {
        expect([403, 404]).toContain(resp.status);
      }
    } finally {
      await authed.dispose();
    }
  });

  test('other tenant CANNOT read our maintenance ticket', async () => {
    await expectDeny(
      `/api/v1/maintenance-requests/${getLiveTestState().maintenanceTicketId}`,
    );
  });

  test('other tenant CANNOT read our DecisionTrace', async () => {
    const traceId = getLiveTestState().decisionTraceId;
    if (!traceId) {
      test.fixme(true, 'no trace from spec 08 — brain was degraded');
      return;
    }
    await expectDeny(`/api/v1/brain/traces/${traceId}`);
  });
});

async function expectDeny(primaryPath: string): Promise<void> {
  const env = loadLiveTestEnv();
  const { otherToken } = readCachedTokens();
  const authed = await authedRequest(env, otherToken);
  try {
    const fallback = primaryPath.replace('/api/v1/', '/api/');
    const resp = await tryPaths(authed, 'GET', [primaryPath, fallback]);
    expect([403, 404], `${primaryPath} returned ${resp.status}`).toContain(resp.status);
  } finally {
    await authed.dispose();
  }
}
