/**
 * @cross-tenant @security @critical
 *
 * Direct-URL probe: user A (tenant X) hits /api/v1/properties/${tenantY-property-id}
 * with a valid tenant-X JWT. Must NOT return 200 + tenant-Y data.
 *
 * Surfaced by .audit/deep-audit-2026-05-20.md as a multi-tenant launch
 * blocker — there is currently zero coverage that the resource-fetch layer
 * enforces tenant_id scoping on the WHERE clause.
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@cross-tenant @security @critical — direct-URL tenant-Y resource', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('GET /api/v1/properties/<Y> with tenant-X JWT must NOT return 200', async ({
    tenantX,
    tenantY,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(
        true,
        'tenant-X JWT could not be minted — auth endpoint path unknown for this build',
      );
      return;
    }

    const candidatePaths = [
      `/api/v1/properties/${tenantY.propertyId}`,
      `/api/properties/${tenantY.propertyId}`,
    ];

    let observedStatus: number | null = null;
    for (const path of candidatePaths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        failOnStatusCode: false,
      });
      observedStatus = resp.status();
      // 404 (resource not found from tenant-X's perspective) is the ideal
      // response. 403 (explicit forbidden) is also acceptable. 401 means
      // auth itself failed — surface it but don't conflate with isolation
      // bug. 200 is the launch blocker.
      expect(
        observedStatus,
        `${path} must NOT leak tenant-Y data to tenant-X (got ${observedStatus})`,
      ).not.toBe(200);
      // DA4 strengthening: a 5xx with a leaked stack trace would have
      // passed the bare `!= 200` check above. Reject 5xx explicitly —
      // a correctly-isolating gateway returns 404 or 403, never 500.
      // Helps catch debug-mode handlers that echo the SQL or stack.
      expect(
        observedStatus,
        `${path} returned 5xx — gateway must not leak server errors on isolation probes (got ${observedStatus})`,
      ).toBeLessThan(500);

      // Defence-in-depth #1: the response body must not contain tenant-Y's
      // distinctive marker. A 404 that echoes the requested row id is fine;
      // a 500 that dumps the row payload is the leak we're hunting.
      const body = await resp.text();
      expect(
        body,
        `${path} response body must not contain tenant-Y distinctive name`,
      ).not.toContain(tenantY.distinctiveName);

      // Defence-in-depth #2: even error bodies must not contain auth
      // material. A leaked /etc/passwd-style key/value would slip past
      // the distinctive-name check. The regex matches the most common
      // accidental fields a verbose error handler dumps.
      expect(
        body,
        `${path} response body must not contain credential-shaped keys (password/token/secret)`,
      ).not.toMatch(/password\s*[:=]|token\s*[:=]|secret\s*[:=]/i);
    }

    expect(
      observedStatus,
      'at least one candidate path must have been probed',
    ).not.toBeNull();
  });

  test('control: GET /api/v1/properties/<X> with tenant-X JWT returns 200', async ({
    tenantX,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }
    const candidatePaths = [
      `/api/v1/properties/${tenantX.propertyId}`,
      `/api/properties/${tenantX.propertyId}`,
    ];
    let succeeded = false;
    for (const path of candidatePaths) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        failOnStatusCode: false,
      });
      if (resp.status() === 200) {
        succeeded = true;
        break;
      }
    }
    expect(
      succeeded,
      'tenant-X must be able to read its OWN property (control baseline) — ' +
        'if false, the isolation suite is meaningless',
    ).toBe(true);
  });
});
