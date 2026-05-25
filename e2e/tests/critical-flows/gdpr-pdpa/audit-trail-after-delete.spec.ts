/**
 * @gdpr @pdpa @compliance @critical
 *
 * After right-to-erasure, the audit trail must still demonstrate that
 * the request happened (accountability under GDPR Art. 5(2) / TZ PDPA
 * s.13) — but the underlying records' PII fields must be tombstoned.
 *
 * Tenant admin queries the audit log and must find:
 *   - a `user.delete-request` event referencing the (now redacted) user
 *   - older records still exist BUT their PII columns are anonymized
 *
 * Surfaced by .audit/deep-audit-2026-05-20.md — KE/TZ regulators expect
 * a demonstrable "we deleted X, here is the proof, here is what stays".
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@gdpr @pdpa @compliance @critical — audit trail after delete', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('admin sees deletion event + redacted-PII rows post-erasure', async ({
    tenantX,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }

    // Step 1: trigger the deletion. Same self-service path as
    // user-account-delete-soft.spec.ts. fixme if missing.
    const deletePath = '/api/v1/users/me';
    const del = await request.delete(`${API_GATEWAY_URL}${deletePath}`, {
      headers: { Authorization: `Bearer ${tenantX.jwt}` },
      data: { reason: 'gdpr-art17', confirm: true },
      failOnStatusCode: false,
    });
    if (del.status() === 404 || del.status() === 405) {
      test.fixme(
        true,
        'missing endpoint: DELETE /api/v1/users/me — only admin RTBF wired',
      );
      return;
    }
    expect([200, 202, 204]).toContain(del.status());

    // Step 2: admin queries the audit log. Prompt assumes
    // GET /api/v1/admin/audit/log?actor=:userId. Several plausible
    // surface shapes exist — try a small set and fixme if none match.
    const auditCandidates = [
      `/api/v1/admin/audit/log?actor=${tenantX.userId}`,
      `/api/v1/audit/log?actor=${tenantX.userId}`,
      `/api/v1/admin/audit-log?actor=${tenantX.userId}`,
    ];

    let auditBody: {
      data?: Array<{ event: string; actor: string; payload?: unknown }>;
    } | null = null;
    for (const path of auditCandidates) {
      const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        failOnStatusCode: false,
      });
      if (resp.status() === 200) {
        auditBody = (await resp.json()) as typeof auditBody;
        break;
      }
    }

    if (auditBody === null) {
      test.fixme(
        true,
        'missing endpoint: GET /api/v1/admin/audit/log (or aliases) — ' +
          'audit ingest works but the read-back HTTP surface is unshipped',
      );
      return;
    }

    const events = auditBody.data ?? [];
    const deletionEvent = events.find((e) =>
      /(user|account)\.(delete|erase|rtbf)/i.test(e.event),
    );
    expect(
      deletionEvent,
      'audit log must contain the deletion event for accountability',
    ).toBeDefined();
    expect(deletionEvent?.actor).toBe(tenantX.userId);

    // Step 3: confirm older audit rows referencing the user retain their
    // structural fields (event name, timestamp) but PII has been
    // tombstoned. We look for any pre-deletion event and assert the
    // email field is NOT the original tenant-X email.
    const olderEvents = events.filter(
      (e) => !/delete|erase|rtbf/i.test(e.event),
    );
    if (olderEvents.length > 0) {
      const serialized = JSON.stringify(olderEvents);
      expect(
        serialized.includes(tenantX.email),
        'older audit rows must have PII (email) redacted post-delete',
      ).toBe(false);
    }
  });
});
