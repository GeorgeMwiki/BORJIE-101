/**
 * Spec 05 — Owner-or-manager creates a lease for the invited resident.
 *
 * Connects:
 *   - tenant (landlord org, spec 02)
 *   - property + unit-1 (spec 03)
 *   - invited resident (spec 04)
 *
 * The lease establishes the financial relationship: monthly rent +
 * deposit + start/end dates. Subsequent payment + ticket specs key off
 * the leaseId.
 */
import { test, expect } from '@playwright/test';
import { loadLiveTestEnv, authedRequest, tryPaths } from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';
import { getLiveTestState, setLiveTestState } from './fixtures/seed-tenant';

test.describe.configure({ mode: 'serial' });

test.describe('05 — Lease creation', () => {
  test('precondition: invited resident + unit exist', () => {
    expect(getLiveTestState().invitedTenantUserId).toBeTruthy();
    expect(getLiveTestState().unitIds?.[0]).toBeTruthy();
  });

  test('owner creates a lease linking resident → unit', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const state = getLiveTestState();
    const today = new Date();
    const oneYear = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);

    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await tryPaths(
        authed,
        'POST',
        ['/api/v1/leases', '/api/leases'],
        {
          unitId: state.unitIds?.[0],
          customerId: state.invitedTenantUserId,
          startDate: today.toISOString().split('T')[0],
          endDate: oneYear.toISOString().split('T')[0],
          monthlyRent: 45000,
          deposit: 90000,
          status: 'active',
        },
      );
      expect(resp.status, `lease create via ${resp.path}`).toBeLessThan(400);
      const leaseId = extractLeaseId(resp.body);
      expect(leaseId).toBeTruthy();
      setLiveTestState({ leaseId });
    } finally {
      await authed.dispose();
    }
  });

  test('the lease is readable + linked to the right unit and customer', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const state = getLiveTestState();
    expect(state.leaseId).toBeTruthy();

    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await tryPaths(authed, 'GET', [
        `/api/v1/leases/${encodeURIComponent(state.leaseId!)}`,
        `/api/leases/${encodeURIComponent(state.leaseId!)}`,
      ]);
      expect(resp.status).toBe(200);
      const body = resp.body as {
        data?: { unitId?: string; customerId?: string; monthlyRent?: number };
      };
      const lease = body?.data ?? body;
      expect((lease as { unitId?: string }).unitId).toBe(state.unitIds?.[0]);
      expect((lease as { customerId?: string }).customerId).toBe(
        state.invitedTenantUserId,
      );
    } finally {
      await authed.dispose();
    }
  });
});

function extractLeaseId(body: unknown): string {
  const parsed = body as {
    data?: { id?: string; leaseId?: string };
    id?: string;
    leaseId?: string;
  };
  return (
    parsed?.data?.id ??
    parsed?.data?.leaseId ??
    parsed?.id ??
    parsed?.leaseId ??
    ''
  );
}
