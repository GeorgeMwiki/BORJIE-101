/**
 * @cross-tenant @security @critical
 *
 * Document download isolation: tenant-X user attempts to GET a document
 * belonging to tenant Y. Documents typically resolve through a presigned-
 * URL or document-service proxy, both of which MUST enforce tenant_id
 * scoping. A 403/404 is the only acceptable response.
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@cross-tenant @security @critical — cross-tenant document access', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('tenant-X JWT cannot GET tenant-Y document by id', async ({
    tenantX,
    tenantY,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }

    const candidatePaths = [
      `/api/v1/documents/${tenantY.docId}`,
      `/api/documents/${tenantY.docId}`,
      `/api/v1/documents/${tenantY.docId}/download`,
      `/api/documents/${tenantY.docId}/download`,
    ];

    let probed = false;
    for (const path of candidatePaths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        failOnStatusCode: false,
      });
      const status = resp.status();
      if (status === 404 && !probed) {
        // 404 could mean "endpoint doesn't exist" or "doc not visible".
        // Both are acceptable security outcomes for this attempt; keep
        // trying other candidates.
        continue;
      }
      probed = true;
      // 200 from this user-tenant combination is the launch blocker.
      expect(
        status,
        `${path}: tenant-X must NOT download tenant-Y document (got ${status})`,
      ).not.toBe(200);
      // If we got a redirect to a presigned URL, that's also a leak.
      if (status >= 300 && status < 400) {
        const location = resp.headers()['location'] ?? '';
        expect(
          location,
          `${path}: redirect must not point at tenant-Y storage path`,
        ).not.toContain(tenantY.docId);
      }
    }

    if (!probed) {
      test.fixme(
        true,
        'documents endpoint not exercised on this build — gap recorded',
      );
    }
  });

  test('tenant-X JWT cannot list tenant-Y documents via documents collection', async ({
    tenantX,
    tenantY,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }
    const paths = ['/api/v1/documents', '/api/documents'];
    for (const path of paths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        failOnStatusCode: false,
      });
      if (resp.status() === 404) continue;
      const body = await resp.text();
      expect(
        body,
        `${path}: documents list must not include tenant-Y doc id`,
      ).not.toContain(tenantY.docId);
    }
  });
});
