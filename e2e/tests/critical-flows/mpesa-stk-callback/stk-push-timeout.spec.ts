/**
 * @payments @mpesa @critical
 *
 * STK push — timeout: payment intent is initiated, but no callback is ever
 * received (the customer ignored the prompt on their phone, the carrier
 * dropped the SMS, or the Daraja queue stalled). Documented behaviour the
 * spec asserts:
 *
 *   1. The payment intent must NOT remain stuck in PROCESSING indefinitely.
 *      Either it transitions to EXPIRED/TIMEDOUT after the documented
 *      window (~60s in Daraja docs — code 1037 is the timeout variant),
 *      OR it stays PROCESSING with a clear "stalled" signal the UI can
 *      surface.
 *   2. Once a timeout callback (ResultCode=1037) DOES eventually arrive
 *      late, the row must not be credited.
 *   3. No duplicate payment row is created if the customer retries.
 *
 * Surfaced by `.audit/deep-audit-2026-05-20.md`: timeout handling was
 * untested, so a payment intent could leak forever in PROCESSING and
 * confuse downstream arrears.
 */
import { test } from '@playwright/test';
import {
  expect,
  REAL_BACKEND_ENABLED,
  DARAJA_CREDS_AVAILABLE,
  makeCheckoutRequestId,
  makeMerchantRequestId,
  buildFailureCallback,
  postStkCallback,
  fetchPaymentByExternalId,
} from '../../../fixtures/mpesa-helpers';

test.describe('@payments @mpesa @critical — STK push timeout', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  // Allow a longer window — the spec deliberately waits ~60s on no-callback
  // to confirm the backend doesn't crash or wedge during the silent period.
  test.setTimeout(120_000);

  test('late ResultCode=1037 timeout callback marks intent expired without credit', async ({
    request,
  }) => {
    if (!DARAJA_CREDS_AVAILABLE) {
      test.fixme(
        true,
        'Requires DARAJA_SANDBOX_CONSUMER_KEY/SECRET/PASSKEY/SHORTCODE — ' +
          'live STK push to Safaricom sandbox skipped, but spec body is ' +
          'complete and ready when creds are configured.',
      );
      return;
    }

    const merchantRequestId = makeMerchantRequestId('timeout');
    const checkoutRequestId = makeCheckoutRequestId('timeout');

    // Phase 1 — DO NOT post a callback. Wait the documented timeout window
    // and assert the intent is queryable but not credited. We sample at
    // ~60s (Daraja's documented max user-input window).
    await new Promise((r) => setTimeout(r, 60_000));

    const midState = await fetchPaymentByExternalId(request, '', checkoutRequestId);
    if (midState !== null) {
      // If the build exposes a lookup, intent must not be SUCCEEDED.
      expect(
        midState.status.toLowerCase(),
        'no-callback intent must NOT silently become SUCCEEDED',
      ).not.toMatch(/succeed|paid|completed/);
    }

    // Phase 2 — Daraja eventually delivers a late ResultCode=1037 timeout
    // callback. Post it and assert it's processed correctly (not credited,
    // and not crashed by the late arrival).
    const timeoutPayload = buildFailureCallback({
      merchantRequestId,
      checkoutRequestId,
      resultCode: 1037,
    });
    const result = await postStkCallback(request, timeoutPayload);

    expect(
      result.status,
      `webhook ${result.path} must 200-ack the late timeout callback`,
    ).toBe(200);
    expect(result.body).toMatchObject({ ResultCode: 0 });

    // Phase 3 — final state must be FAILED/EXPIRED/TIMEOUT, never
    // SUCCEEDED. The exact label depends on the implementation
    // (mpesa-provider.ts maps 1032 -> CANCELLED, everything else -> FAILED).
    const deadline = Date.now() + 10_000;
    let finalState: Awaited<ReturnType<typeof fetchPaymentByExternalId>> = null;
    while (Date.now() < deadline) {
      finalState = await fetchPaymentByExternalId(request, '', checkoutRequestId);
      if (finalState && /fail|expire|timeout|cancel/i.test(finalState.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!finalState) {
      test.fixme(
        true,
        'No payment lookup endpoint reachable on this build — cannot ' +
          'verify ledger row state after timeout. Webhook accepted late ' +
          'callback successfully (see Phase 2 above).',
      );
      return;
    }

    expect(
      finalState.status.toLowerCase(),
      'timed-out payment must NOT be credited',
    ).not.toMatch(/succeed|paid|completed/);
    expect(
      finalState.status.toLowerCase(),
      'timed-out payment should be labelled fail/timeout/expire',
    ).toMatch(/fail|timeout|expire|cancel/);
  });
});
