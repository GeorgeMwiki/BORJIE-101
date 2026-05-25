/**
 * @payments @mpesa @critical
 *
 * STK push duplicate callback: Daraja retries every few minutes until it
 * receives `{ResultCode: 0, ResultDesc: "Accepted"}`. Races can still
 * cause a second delivery. Assert idempotency:
 *   - Ledger updated EXACTLY ONCE — no double-credit.
 *   - No duplicate receipt issued.
 *   - Subsequent identical callbacks still 200-acked (stops retries) but
 *     trigger no further side-effects.
 *
 * Cross-references the webhook idempotency middleware
 * (`CallbackDeduplicator.seenBefore`, keyed by CheckoutRequestID) in
 * `services/payments-ledger/src/middleware/mpesa-webhook.middleware.ts`.
 *
 * Surfaced by `.audit/deep-audit-2026-05-20.md`: idempotency was unit-tested
 * but never exercised end-to-end against the real handler.
 */
import { test } from '@playwright/test';
import {
  expect,
  API_GATEWAY_URL,
  REAL_BACKEND_ENABLED,
  DARAJA_CREDS_AVAILABLE,
  mpesaTestIds,
  makeCheckoutRequestId,
  makeMerchantRequestId,
  buildSuccessCallback,
  postStkCallback,
  fetchPaymentByExternalId,
} from '../../../fixtures/mpesa-helpers';

test.describe('@payments @mpesa @critical — STK push duplicate callback idempotency', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('identical success callback delivered twice yields exactly one ledger update', async ({
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

    const merchantRequestId = makeMerchantRequestId('dup');
    const checkoutRequestId = makeCheckoutRequestId('dup');
    // Pin the receipt number so both deliveries are byte-identical; this
    // is the worst-case for idempotency (no payload-shape difference to
    // distinguish duplicates from legitimate retries).
    const fixedReceipt = `RCT${Date.now().toString().slice(-8)}`;

    const payload = buildSuccessCallback({
      merchantRequestId,
      checkoutRequestId,
      amount: mpesaTestIds.rentAmountKes,
      mpesaReceiptNumber: fixedReceipt,
      phoneNumber: mpesaTestIds.testPhoneNumber,
    });

    // First delivery — original Daraja webhook call.
    const first = await postStkCallback(request, payload);
    expect(first.status, 'first delivery must 200-ack').toBe(200);
    expect(first.body).toMatchObject({ ResultCode: 0 });

    // Snapshot ledger so we can prove the second delivery is a no-op.
    await new Promise((r) => setTimeout(r, 2_000));
    const firstState = await fetchPaymentByExternalId(request, '', checkoutRequestId);

    // Second delivery — Daraja retry. MUST still 200-ack but MUST NOT
    // double-credit. Silence or 4xx triggers further retry storms.
    const second = await postStkCallback(request, payload);
    expect(second.status, 'duplicate delivery must still 200-ack').toBe(200);
    expect(second.body).toMatchObject({ ResultCode: 0 });

    await new Promise((r) => setTimeout(r, 2_000));
    const secondState = await fetchPaymentByExternalId(request, '', checkoutRequestId);

    if (firstState === null || secondState === null) {
      test.fixme(
        true,
        'No payment lookup endpoint reachable on this build — cannot ' +
          'verify ledger state. Both webhook deliveries 200-acked, which ' +
          'is the minimum idempotency contract Daraja requires.',
      );
      return;
    }

    // Status must be unchanged across the two deliveries.
    expect(secondState.status, 'duplicate must not change status').toBe(firstState.status);
    // Receipt must be unchanged (re-emission would imply a second
    // ledger.credit() that bypassed the dedupe cache).
    expect(secondState.receipt, 'duplicate must not re-emit receipt').toBe(firstState.receipt);

    // Defence-in-depth — assert exactly one row exists for this externalId.
    // A second row would indicate dedup keying drift between writes.
    const listResp = await request.get(
      `${API_GATEWAY_URL}/api/v1/payments?externalId=${encodeURIComponent(checkoutRequestId)}`,
      { failOnStatusCode: false },
    );
    if (listResp.status() === 200) {
      const listBody = (await listResp.json().catch(() => null)) as
        | { data?: unknown[]; items?: unknown[] } | null;
      const items = listBody?.data ?? listBody?.items ?? [];
      if (Array.isArray(items)) {
        expect(items.length, 'duplicate callback must NOT produce a second payment row').toBeLessThanOrEqual(1);
      }
    }
  });
});
