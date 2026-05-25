/**
 * Live-test teardown. Called by spec 10 (and as a globalTeardown fallback).
 *
 * Strategy: delete the tenant via the api-gateway's owner-self-service
 * delete endpoint (which we built for GDPR/PDPA RTBF — see Wave 2 V). The
 * server cascade then drops properties, units, leases, payments, audit
 * events, and Brain decision-trace rows that reference the tenant.
 *
 * If the gateway's RTBF endpoint is not reachable (404), we fall back to
 * calling Supabase's admin user-delete via the service-role key. That is
 * the ONLY place in the live-test suite that touches the service-role
 * key, and it ONLY runs in teardown so a leaked credential at most
 * deletes a test user.
 *
 * Errors during cleanup are warnings, not failures — we never want
 * teardown to mask a genuine spec failure earlier in the run.
 */
import { tryPaths, type AuthedRequest, loadLiveTestEnv } from './tenant-context';
import { getLiveTestState } from './seed-tenant';
import { request as playwrightRequest } from '@playwright/test';

export interface CleanupResult {
  tenantDeleted: boolean;
  cascadeChecked: boolean;
  warnings: readonly string[];
}

export async function cleanupLiveTest(
  authed: AuthedRequest,
): Promise<CleanupResult> {
  const warnings: string[] = [];
  const state = getLiveTestState();
  const tenantId = state.tenantId;

  if (!tenantId) {
    return {
      tenantDeleted: false,
      cascadeChecked: false,
      warnings: ['No tenantId in state — nothing to clean up.'],
    };
  }

  // 1) RTBF endpoint — preferred path.
  const rtbfResp = await tryPaths(
    authed,
    'DELETE',
    [
      `/api/v1/tenants/${encodeURIComponent(tenantId)}`,
      `/api/v1/gdpr/tenants/${encodeURIComponent(tenantId)}`,
      `/api/gdpr/tenants/${encodeURIComponent(tenantId)}`,
    ],
  ).catch((err) => {
    warnings.push(`RTBF call threw: ${String(err)}`);
    return { status: 0, body: null, path: '' };
  });

  const tenantDeleted = rtbfResp.status >= 200 && rtbfResp.status < 300;
  if (!tenantDeleted) {
    warnings.push(
      `RTBF endpoint returned ${rtbfResp.status} via ${rtbfResp.path} — cascade may not have fired.`,
    );
  }

  // 2) Cascade sanity-check — GET on the tenant should now 404.
  const cascadeProbe = await tryPaths(
    authed,
    'GET',
    [
      `/api/v1/tenants/${encodeURIComponent(tenantId)}`,
      `/api/tenants/${encodeURIComponent(tenantId)}`,
    ],
  ).catch(() => null);
  const cascadeChecked = cascadeProbe !== null;
  if (cascadeChecked && cascadeProbe.status !== 404) {
    warnings.push(
      `Cascade probe: tenant still readable after delete (status ${cascadeProbe.status}).`,
    );
  }

  return { tenantDeleted, cascadeChecked, warnings: Object.freeze(warnings) };
}

/**
 * Service-role fallback — delete the bootstrap test user from Supabase
 * Auth. Only used when the gateway RTBF path failed.
 *
 * SECURITY: this function reads SUPABASE_SERVICE_ROLE_KEY. It is intended
 * to run ONLY in the teardown phase, after every spec has completed. The
 * key must NEVER be read from a browser-facing context.
 */
export async function adminDeleteUser(userId: string): Promise<void> {
  const env = loadLiveTestEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    throw new Error(
      'adminDeleteUser: SUPABASE_SERVICE_ROLE_KEY not set (server-only secret).',
    );
  }
  const ctx = await playwrightRequest.newContext();
  try {
    const resp = await ctx.delete(
      `${env.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        failOnStatusCode: false,
      },
    );
    if (!resp.ok() && resp.status() !== 404) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `adminDeleteUser ${userId}: ${resp.status()} ${body.slice(0, 200)}`,
      );
    }
  } finally {
    await ctx.dispose();
  }
}
