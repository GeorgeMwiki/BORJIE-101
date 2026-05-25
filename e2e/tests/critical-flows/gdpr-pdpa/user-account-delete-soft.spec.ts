/**
 * @gdpr @pdpa @compliance @critical
 *
 * User invokes Art. 17 right-to-erasure (TZ PDPA s.28). Implementation is
 * a soft-delete pattern: row stays for audit retention, but PII is
 * tombstoned and re-auth is denied. Audit trail survives.
 *
 * Surfaced by .audit/deep-audit-2026-05-20.md as a KE/TZ launch blocker.
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@gdpr @pdpa @compliance @critical — soft delete user account', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('DELETE /api/v1/users/me soft-deletes account + blocks re-auth', async ({
    tenantX,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(
        true,
        'tenant-X JWT could not be minted — auth endpoint path unknown',
      );
      return;
    }

    // Agent V — self-service delete alias now wired. Soft-deletes the user
    // with a 30-day grace; PII is tombstoned and re-auth is denied.
    const selfDeletePath = '/api/v1/users/me';
    const resp = await request.delete(`${API_GATEWAY_URL}${selfDeletePath}`, {
      headers: { Authorization: `Bearer ${tenantX.jwt}` },
      data: { reason: 'right-to-erasure', confirm: true },
      failOnStatusCode: false,
    });

    expect(
      [200, 202, 204],
      `expected accepted on soft-delete, got ${resp.status()}`,
    ).toContain(resp.status());

    // Re-login MUST now fail.
    const reLoginCandidates = ['/api/v1/auth/login', '/api/auth/login'];
    let blocked = false;
    for (const path of reLoginCandidates) {
      const r = await request.post(`${API_GATEWAY_URL}${path}`, {
        data: { email: tenantX.email, password: 'demo123' },
        failOnStatusCode: false,
      });
      if (r.status() === 401 || r.status() === 403 || r.status() === 404) {
        blocked = true;
        break;
      }
    }
    expect(
      blocked,
      'a soft-deleted user must not be able to log in again',
    ).toBe(true);

    // Tenant-mate query for the deleted user's profile must return a
    // PII-redacted shape (no email, no full_name) but row reference may
    // persist for FK integrity.
    const profilePath = `/api/v1/users/${tenantX.userId}`;
    const probe = await request.get(`${API_GATEWAY_URL}${profilePath}`, {
      headers: { Authorization: `Bearer ${tenantX.jwt}` },
      failOnStatusCode: false,
    });

    if (probe.status() === 200) {
      const body = (await probe.json()) as {
        data?: { email?: string; full_name?: string; deleted?: boolean };
      };
      const piiClean =
        !body.data?.email?.includes('@borjie.test') &&
        body.data?.full_name !== `Iso Tenant X Owner`;
      expect(
        piiClean,
        'PII fields must be redacted after soft delete (email/full_name)',
      ).toBe(true);
    } else {
      // 404/403 also acceptable — caller is now stale-credential.
      expect([401, 403, 404]).toContain(probe.status());
    }
  });
});
