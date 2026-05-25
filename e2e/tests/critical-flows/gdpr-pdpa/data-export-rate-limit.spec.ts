/**
 * @gdpr @pdpa @compliance @critical
 *
 * Data-export endpoint must be rate-limited. Bundles are expensive
 * (ZIP packing, multi-table SELECT) so a malicious or buggy client
 * hammering the endpoint can DOS the controller. RFC 6585 §4 expects
 * 429 with a friendly Retry-After hint.
 *
 * Surfaced by .audit/deep-audit-2026-05-20.md — the in-memory bucket
 * exists in dsar.router but the self-service alias has not inherited it.
 */
import {
  test,
  expect,
  REAL_BACKEND_ENABLED,
  API_GATEWAY_URL,
} from '../../../fixtures/dual-tenant-fixtures';

const BURST_SIZE = 5;
const WINDOW_MS = 60_000;

test.describe('@gdpr @pdpa @compliance @critical — data export rate limit', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test(`burst of ${BURST_SIZE} export calls in 1 minute → at most 2 succeed`, async ({
    tenantX,
    request,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }

    const exportPath = '/api/v1/users/me/data-export';

    // Pre-flight probe: if endpoint is missing, fixme rather than spam.
    const preflight = await request.post(`${API_GATEWAY_URL}${exportPath}`, {
      headers: { Authorization: `Bearer ${tenantX.jwt}` },
      failOnStatusCode: false,
    });
    if (preflight.status() === 404) {
      test.fixme(
        true,
        'missing endpoint: POST /api/v1/users/me/data-export (self-service ' +
          'alias). Rate limit exists on /api/v1/dsar/:subjectId/export.',
      );
      return;
    }

    const start = Date.now();
    const statuses: number[] = [preflight.status()];

    // Fire BURST_SIZE-1 more requests as fast as possible, inside the window.
    const remaining = BURST_SIZE - 1;
    const responses = await Promise.all(
      Array.from({ length: remaining }, () =>
        request.post(`${API_GATEWAY_URL}${exportPath}`, {
          headers: { Authorization: `Bearer ${tenantX.jwt}` },
          failOnStatusCode: false,
        }),
      ),
    );
    for (const r of responses) statuses.push(r.status());

    const elapsed = Date.now() - start;
    expect(
      elapsed,
      'all requests must fit inside the rate-limit window',
    ).toBeLessThan(WINDOW_MS);

    const successCount = statuses.filter(
      (s) => s === 200 || s === 202,
    ).length;
    const throttledCount = statuses.filter((s) => s === 429).length;

    expect(
      successCount,
      `at most 2 of ${BURST_SIZE} bursts may succeed (got ${successCount})`,
    ).toBeLessThanOrEqual(2);
    expect(
      throttledCount,
      `at least 1 of ${BURST_SIZE} bursts must be 429 (got ${throttledCount})`,
    ).toBeGreaterThanOrEqual(1);

    // Friendly-message contract: 429 response body must carry a
    // human-readable hint, NOT a stack trace.
    const throttledResp = responses.find((r) => r.status() === 429);
    if (throttledResp) {
      const body = await throttledResp.text();
      expect(
        body,
        '429 body must be JSON with a friendly message',
      ).toMatch(/rate.?limit|retry|too many|429/i);
      // Retry-After header is RFC-recommended.
      const retryAfter = throttledResp.headers()['retry-after'];
      if (retryAfter !== undefined) {
        expect(retryAfter).toMatch(/^\d+/);
      }
    }
  });
});
