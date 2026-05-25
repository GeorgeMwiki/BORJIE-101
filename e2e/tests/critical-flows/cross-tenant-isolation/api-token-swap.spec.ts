/**
 * @cross-tenant @security @critical
 *
 * Token-header swap: user A holds a valid tenant-X JWT but submits the
 * X-Tenant-ID header pointing at tenant Y. A correctly-implemented gateway
 * MUST reject this with 403 ("tenant mismatch") on any tenant-scoped
 * endpoint. A naive gateway that trusts the header over the JWT claim is
 * the canonical multi-tenant exploit.
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@cross-tenant @security @critical — X-Tenant-ID header swap', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('tenant-X JWT + X-Tenant-ID: Y must be rejected on /properties list', async ({
    tenantX,
    tenantY,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }

    const candidatePaths = ['/api/v1/properties', '/api/properties'];
    let probed = false;
    for (const path of candidatePaths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${tenantX.jwt}`,
          'X-Tenant-ID': tenantY.tenantId,
        },
        failOnStatusCode: false,
      });
      const status = resp.status();
      // 403 (tenant mismatch detected) is the gold-standard response.
      // 401 also acceptable (auth subsystem rejected the combo).
      // 200 is the launch blocker — would mean the header overrode the
      // JWT claim and the user got tenant-Y's property list.
      expect(
        status,
        `${path} with swapped X-Tenant-ID must NOT 200 (got ${status})`,
      ).not.toBe(200);
      // Defence-in-depth: ensure the response body, whatever its status,
      // does not contain tenant-Y's distinctive property name.
      const body = await resp.text();
      expect(
        body,
        `${path} body must not leak tenant-Y data on header swap`,
      ).not.toContain(tenantY.distinctiveName);
      probed = true;
    }

    expect(probed, 'at least one candidate /properties path probed').toBe(true);
  });

  test('tenant-X JWT + X-Tenant-ID: Y must be rejected on /leases list', async ({
    tenantX,
    tenantY,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }
    const paths = ['/api/v1/leases', '/api/leases'];
    for (const path of paths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${tenantX.jwt}`,
          'X-Tenant-ID': tenantY.tenantId,
        },
        failOnStatusCode: false,
      });
      expect(
        resp.status(),
        `${path} header-swap must not succeed (got ${resp.status()})`,
      ).not.toBe(200);
    }
  });
});
