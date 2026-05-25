/**
 * @cross-tenant @security @critical
 *
 * Expired-JWT probe: tampered/expired tenant-X JWT must be rejected with
 * 401/403, AND the refresh endpoint must never mint a token for a
 * different tenant.
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@cross-tenant @security @critical — expired JWT handling', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('expired tenant-X JWT is rejected with 401/403', async ({
    tenantX,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }
    // Forge an exp-in-the-past payload. The signature won't re-validate
    // either, so rejection on signature OR exp is acceptable (both = 401).
    const expired = forgeExpiredJwt(tenantX.jwt);
    const paths = ['/api/v1/properties', '/api/properties'];
    for (const path of paths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${expired}` },
        failOnStatusCode: false,
      });
      expect(
        [401, 403],
        `${path} must reject expired/tampered JWT (got ${resp.status()})`,
      ).toContain(resp.status());
    }
  });

  test('refresh flow does NOT issue cross-tenant token', async ({
    tenantX,
    tenantY,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }

    // Cross-tenant refresh attack: present a (still valid) tenant-X token
    // but ask the refresh endpoint for a tenant-Y context.
    for (const path of ['/api/v1/auth/refresh', '/api/auth/refresh']) {
      const resp = await request.post(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        data: { tenantId: tenantY.tenantId, refreshToken: tenantX.jwt },
        failOnStatusCode: false,
      });
      if (resp.status() === 404) continue;
      if (resp.status() >= 400) continue; // 4xx refusal is correct
      const body = (await resp.json().catch(() => null)) as
        | { token?: string; data?: { token?: string; accessToken?: string } }
        | null;
      const newToken =
        body?.token ?? body?.data?.token ?? body?.data?.accessToken ?? '';
      const claim = decodeJwtPayload(newToken);
      const tid =
        (claim?.tid as string | undefined) ??
        (claim?.tenantId as string | undefined) ??
        (claim?.tenant_id as string | undefined) ??
        '';
      expect(
        tid,
        `refresh must NEVER mint token for tenant ${tenantY.tenantId}`,
      ).not.toBe(tenantY.tenantId);
    }
  });
});

function forgeExpiredJwt(original: string): string {
  const parts = original.split('.');
  if (parts.length !== 3) return original;
  const payload = decodeJwtPayload(original) ?? {};
  const tampered = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) - 3600,
    iat: Math.floor(Date.now() / 1000) - 7200,
  };
  const encoded = base64UrlEncode(JSON.stringify(tampered));
  // Re-use original signature — gateway will reject on signature mismatch,
  // which is the same security outcome.
  return `${parts[0]}.${encoded}.${parts[2]}`;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
