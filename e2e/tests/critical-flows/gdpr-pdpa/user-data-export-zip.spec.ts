/**
 * @gdpr @pdpa @compliance @critical
 *
 * User exercises GDPR Art. 20 / TZ PDPA s.27 right to data portability.
 * Surfaced by .audit/deep-audit-2026-05-20.md as a KE/TZ launch blocker —
 * data-protection rollout requires a verifiable export pipeline.
 *
 * Asserts:
 *   - POST /api/v1/users/me/data-export returns 200 with a download URL
 *     OR streams a ZIP attachment directly.
 *   - The ZIP contains: user profile JSON, payment history CSV,
 *     communication log CSV, document inventory CSV.
 *   - The ZIP does NOT contain any other tenant's row (multi-tenant
 *     isolation must hold even inside the export bundle).
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

test.describe('@gdpr @pdpa @compliance @critical — data export bundle', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('POST /api/v1/users/me/data-export returns a parseable ZIP', async ({
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

    // Agent V — self-service alias now wired at /api/v1/users/me/data-export.
    // The route compiles a DSAR bundle for the authenticated user and returns
    // it as a JSON attachment (or, in the worker-backed path, a downloadUrl).
    const selfExportPath = '/api/v1/users/me/data-export';
    const resp = await request.post(`${API_GATEWAY_URL}${selfExportPath}`, {
      headers: { Authorization: `Bearer ${tenantX.jwt}` },
      failOnStatusCode: false,
    });

    expect(
      [200, 202],
      `expected 200 or 202 from self-export, got ${resp.status()}`,
    ).toContain(resp.status());

    // DA4 strengthening: 202 was previously accepted as a terminal state,
    // which meant a "queued, never completes" worker would silently pass
    // the suite — pilot users would request an export and never get an
    // email. We now resolve 202 by polling the export-status endpoint
    // every 5s for up to 60s. If the worker doesn't complete in that
    // window, FAIL — the SLA the privacy notice promises is "within
    // 24h" but for a fresh self-service export we expect seconds.
    //
    // Three valid contracts now:
    //   (a) 200 with `application/zip`              — synchronous ZIP
    //   (b) 200 with JSON body containing downloadUrl — synchronous + sign
    //   (c) 202 with JSON body containing exportId / jobId — async; poll
    const contentType = resp.headers()['content-type'] ?? '';
    let zipBuffer: Buffer | null = null;

    if (resp.status() === 202) {
      // Async worker path. Body MUST surface a jobId/exportId we can poll.
      const body = (await resp.json()) as {
        success?: boolean;
        data?: { exportId?: string; jobId?: string; statusUrl?: string };
        exportId?: string;
        jobId?: string;
      };
      const jobId =
        body.data?.exportId ??
        body.data?.jobId ??
        body.exportId ??
        body.jobId ??
        '';
      expect(
        jobId,
        '202 response must include an exportId/jobId so the client can poll',
      ).not.toBe('');

      // Candidate status endpoints — the worker may expose any of these
      // depending on whether the route lives under /users/me or /dsar.
      const statusUrl =
        body.data?.statusUrl ??
        `/api/v1/users/me/data-export/${jobId}`;

      const POLL_INTERVAL_MS = 5_000;
      const POLL_TIMEOUT_MS = 60_000;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let finalStatus: number | null = null;
      let finalBody: unknown = null;

      while (Date.now() < deadline) {
        const statusResp = await request.get(`${API_GATEWAY_URL}${statusUrl}`, {
          headers: { Authorization: `Bearer ${tenantX.jwt}` },
          failOnStatusCode: false,
        });
        finalStatus = statusResp.status();
        if (finalStatus === 200) {
          const statusContentType =
            statusResp.headers()['content-type'] ?? '';
          if (statusContentType.includes('application/zip')) {
            zipBuffer = Buffer.from(await statusResp.body());
            break;
          }
          // JSON status body — look for "completed" + downloadUrl.
          finalBody = await statusResp.json();
          const s = (finalBody as { status?: string; state?: string }) ?? {};
          const state = (s.status ?? s.state ?? '').toLowerCase();
          if (state === 'completed' || state === 'ready' || state === 'success') {
            const downloadUrl =
              (finalBody as { downloadUrl?: string; data?: { downloadUrl?: string } })
                .downloadUrl ??
              (finalBody as { data?: { downloadUrl?: string } }).data
                ?.downloadUrl ??
              '';
            if (downloadUrl.startsWith('http')) {
              const dl = await request.get(downloadUrl, {
                headers: { Authorization: `Bearer ${tenantX.jwt}` },
                failOnStatusCode: false,
              });
              expect(dl.status()).toBe(200);
              zipBuffer = Buffer.from(await dl.body());
              break;
            }
          }
          if (state === 'failed' || state === 'error') {
            throw new Error(
              `DSAR worker reported ${state} state during polling: ${JSON.stringify(finalBody)}`,
            );
          }
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      expect(
        zipBuffer,
        `DSAR worker did not complete within ${POLL_TIMEOUT_MS / 1000}s — ` +
          `pilot users would hit "202 queued, no email ever". ` +
          `last status=${finalStatus} body=${JSON.stringify(finalBody)}`,
      ).not.toBeNull();
    } else if (contentType.includes('application/zip')) {
      zipBuffer = Buffer.from(await resp.body());
    } else if (contentType.includes('application/json')) {
      const body = (await resp.json()) as {
        success: boolean;
        data?: { downloadUrl?: string };
      };
      expect(body.success).toBe(true);
      const downloadUrl = body.data?.downloadUrl ?? '';
      expect(downloadUrl).toMatch(/^https?:\/\//);
      const dl = await request.get(downloadUrl, {
        headers: { Authorization: `Bearer ${tenantX.jwt}` },
        failOnStatusCode: false,
      });
      expect(dl.status()).toBe(200);
      zipBuffer = Buffer.from(await dl.body());
    } else {
      throw new Error(`unexpected content-type: ${contentType}`);
    }

    expect(zipBuffer).not.toBeNull();
    expect(zipBuffer!.length).toBeGreaterThan(50);

    // Quick smoke parse: ZIP local file header magic is PK\x03\x04.
    const magic = zipBuffer!.subarray(0, 4).toString('hex');
    expect(magic).toBe('504b0304');

    // Defence-in-depth: scan raw bytes for distinctive tenant-Y name.
    // A correct export bundle for tenant X must never contain tenant Y's
    // distinctive marker.
    const asUtf8 = zipBuffer!.toString('utf8');
    expect(
      asUtf8.includes('TENANT_Y_VILLA_DISTINCTIVE_NAME'),
      'export bundle for tenant X must NOT include tenant-Y data',
    ).toBe(false);

    // Expected member list (Art. 20 + PDPA s.27 minimum bundle).
    const expectedMembers = [
      /profile.*\.json/i,
      /payments?.*\.csv/i,
      /communicat.*\.csv/i,
      /documents?.*\.csv/i,
    ];
    for (const pattern of expectedMembers) {
      expect(
        pattern.test(asUtf8),
        `ZIP central directory should reference ${pattern}`,
      ).toBe(true);
    }
  });
});
