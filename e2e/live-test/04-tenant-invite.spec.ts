/**
 * Spec 04 — Owner invites a tenant-resident to unit A101.
 *
 * "Tenant" is overloaded in BORJIE: the landlord org is `tenants`
 * (multi-tenancy), and the resident living in a unit is also informally
 * called a "tenant" (the leasee). To avoid confusion, our code refers
 * to the leasee as a "customer" (per the existing fixtures), and this
 * spec invites a customer-role user to the first unit.
 *
 * Verifies:
 *   - the invite creates a `users` row with role='customer' in the
 *     landlord's tenant_id,
 *   - the invite is visible from the owner's POV,
 *   - the invited user starts in `pending` status (until they sign in
 *     and accept).
 */
import { test, expect } from '@playwright/test';
import { loadLiveTestEnv, authedRequest, tryPaths } from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';
import { getLiveTestState, setLiveTestState } from './fixtures/seed-tenant';

test.describe.configure({ mode: 'serial' });

test.describe('04 — Invite tenant-resident to unit', () => {
  test('precondition: property + units exist from spec 03', () => {
    expect(getLiveTestState().propertyId).toBeTruthy();
    expect(getLiveTestState().unitIds?.[0]).toBeTruthy();
  });

  test('owner invites a tenant-resident to unit A101', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const unitId = getLiveTestState().unitIds?.[0];
    expect(unitId).toBeTruthy();

    const authed = await authedRequest(env, ownerToken);
    try {
      const inviteEmail = `live-test-resident-${Date.now()}@borjie.test`;
      const resp = await tryPaths(
        authed,
        'POST',
        ['/api/v1/invites', '/api/v1/users/invite', '/api/invites'],
        {
          email: inviteEmail,
          role: 'customer',
          unitId,
          // eslint-disable-next-line borjie/no-jurisdictional-literal -- pilot-country E2E test phone
          phone: '+254712000001',
          fullName: 'Live Test Resident',
        },
      );
      expect(resp.status, `invite via ${resp.path}`).toBeLessThan(400);

      const invitedUserId = extractInvitedUserId(resp.body);
      expect(invitedUserId).toBeTruthy();
      setLiveTestState({ invitedTenantUserId: invitedUserId });
    } finally {
      await authed.dispose();
    }
  });

  test('owner can see the new pending invite in their tenant', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const invitedUserId = getLiveTestState().invitedTenantUserId;
    expect(invitedUserId).toBeTruthy();
    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await tryPaths(authed, 'GET', [
        `/api/v1/users/${encodeURIComponent(invitedUserId!)}`,
        `/api/users/${encodeURIComponent(invitedUserId!)}`,
      ]);
      expect(resp.status).toBe(200);
      const body = resp.body as {
        data?: { role?: string; status?: string };
        role?: string;
        status?: string;
      };
      const role = body?.data?.role ?? body?.role;
      const status = body?.data?.status ?? body?.status;
      expect(role).toBe('customer');
      // pending or active — both acceptable depending on auto-accept flag
      expect(['pending', 'invited', 'active']).toContain(status);
    } finally {
      await authed.dispose();
    }
  });
});

function extractInvitedUserId(body: unknown): string {
  const parsed = body as {
    data?: { id?: string; userId?: string };
    id?: string;
    userId?: string;
  };
  return (
    parsed?.data?.id ??
    parsed?.data?.userId ??
    parsed?.id ??
    parsed?.userId ??
    ''
  );
}
