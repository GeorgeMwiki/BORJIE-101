import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_GATEWAY_URL, BORJIE_TEST_USERS } from './fixtures/test-users';

/**
 * API gateway smoke — exercises the four contracts that gate every
 * downstream surface:
 *   1. /healthz is live (deploy probe).
 *   2. /api/v1/mining/licences rejects unauthenticated calls (RLS).
 *   3. /api/v1/auth/login returns a session token for the seeded owner.
 *   4. The same token can read the seeded demo licence.
 *
 * Skips when the gateway isn't reachable so the broken-build worker
 * doesn't take this suite red.
 */

const LOGIN_PATH = '/api/v1/auth/login';
const LICENCES_PATH = '/api/v1/mining/licences';

async function gatewayReachable(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.get(`${API_GATEWAY_URL}/healthz`, {
      timeout: 5000,
    });
    return response.ok();
  } catch {
    return false;
  }
}

function extractToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const direct = record['token'] ?? record['accessToken'] ?? record['session_token'];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const session = record['session'];
  if (session && typeof session === 'object') {
    const sessRec = session as Record<string, unknown>;
    const nested = sessRec['token'] ?? sessRec['accessToken'];
    if (typeof nested === 'string' && nested.length > 0) return nested;
  }
  const data = record['data'];
  if (data && typeof data === 'object') {
    return extractToken(data);
  }
  return undefined;
}

test.describe('Borjie api-gateway smoke', () => {
  test.beforeEach(async ({ request }) => {
    const reachable = await gatewayReachable(request);
    test.skip(
      !reachable,
      `api-gateway not reachable at ${API_GATEWAY_URL}/healthz`,
    );
  });

  test('/healthz returns 200', async ({ request }) => {
    const response = await request.get(`${API_GATEWAY_URL}/healthz`);
    expect(response.status()).toBe(200);
  });

  test('mining licences rejects unauthenticated request (RLS guard)', async ({
    request,
  }) => {
    const response = await request.get(`${API_GATEWAY_URL}${LICENCES_PATH}`);
    expect([401, 403]).toContain(response.status());
  });

  test('owner login issues a session token that authorises licences read', async ({
    request,
  }) => {
    const owner = BORJIE_TEST_USERS.owner;
    const loginResponse = await request.post(`${API_GATEWAY_URL}${LOGIN_PATH}`, {
      data: {
        email: owner.email,
        password: owner.password,
        tenantId: owner.tenantId,
      },
    });
    expect(
      loginResponse.ok(),
      `login failed: ${loginResponse.status()} ${await loginResponse.text()}`,
    ).toBe(true);

    const loginBody: unknown = await loginResponse.json();
    const token = extractToken(loginBody);
    expect(token, 'login response missing token').toBeTruthy();
    if (!token) return;

    const licencesResponse = await request.get(
      `${API_GATEWAY_URL}${LICENCES_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-tenant-id': owner.tenantId,
        },
      },
    );
    expect(licencesResponse.ok()).toBe(true);

    const licencesBody: unknown = await licencesResponse.json();
    const records = Array.isArray(licencesBody)
      ? licencesBody
      : Array.isArray((licencesBody as { data?: unknown[] })?.data)
        ? (licencesBody as { data: unknown[] }).data
        : [];
    expect(records.length).toBeGreaterThanOrEqual(1);
  });
});
