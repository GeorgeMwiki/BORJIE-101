/**
 * @cross-tenant @security @critical
 *
 * Search-result isolation: when user A (tenant X) searches for a string
 * that appears in tenant Y's records, no tenant-Y rows must surface. The
 * distinctive name (TENANT_Y_VILLA_DISTINCTIVE_NAME) is seeded into a
 * tenant-Y property so a literal substring match would expose any
 * forgotten WHERE tenant_id filter.
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@cross-tenant @security @critical — search isolation', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('properties search via tenant-X JWT must not surface tenant-Y rows', async ({
    tenantX,
    tenantY,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }

    const searchPaths = [
      `/api/v1/properties?q=${encodeURIComponent(tenantY.distinctiveName)}`,
      `/api/v1/properties/search?q=${encodeURIComponent(tenantY.distinctiveName)}`,
      `/api/properties?q=${encodeURIComponent(tenantY.distinctiveName)}`,
      `/api/search?q=${encodeURIComponent(tenantY.distinctiveName)}`,
    ];

    let probed = false;
    for (const path of searchPaths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        failOnStatusCode: false,
      });
      if (resp.status() >= 500 || resp.status() === 404) continue;
      probed = true;
      const body = await resp.text();
      // Even a 200 response is fine PROVIDED the body has zero tenant-Y
      // matches. The distinctive name is unique-per-tenant so any
      // occurrence is a leak.
      expect(
        body,
        `${path}: search must not return tenant-Y rows for tenant-X user`,
      ).not.toContain(tenantY.distinctiveName);
      // Belt-and-braces: also ensure tenant-Y's IDs don't appear.
      expect(body).not.toContain(tenantY.propertyId);
      expect(body).not.toContain(tenantY.tenantId);
    }

    if (!probed) {
      test.fixme(
        true,
        'No search endpoint responded with <500 — cannot validate isolation',
      );
    }
  });

  test('control: searching for tenant-X distinctive name returns at least one row', async ({
    tenantX,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }
    const path = `/api/v1/properties?q=${encodeURIComponent(tenantX.distinctiveName)}`;
    const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
      headers: { Authorization: `Bearer ${tenantX.jwt}` },
      failOnStatusCode: false,
    });
    if (resp.status() === 404) {
      test.fixme(true, 'search endpoint not yet shipped on this build');
      return;
    }
    const body = await resp.text();
    expect(
      body,
      'tenant-X must be able to find its OWN distinctive-name property',
    ).toContain(tenantX.distinctiveName);
  });
});
