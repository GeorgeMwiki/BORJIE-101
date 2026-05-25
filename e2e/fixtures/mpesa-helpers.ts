/**
 * M-Pesa Daraja STK callback fixtures for the
 * `e2e/tests/critical-flows/mpesa-stk-callback/` suite.
 *
 * Surfaced by `.audit/deep-audit-2026-05-20.md` as a missing-critical-flow:
 * existing payment specs mock at the gateway boundary and never exercise the
 * webhook contract the Daraja sandbox will hit. These helpers build realistic
 * STK callback payloads that match Safaricom's documented shape:
 *
 *   POST /webhooks/mpesa/stk
 *   {
 *     "Body": {
 *       "stkCallback": {
 *         "MerchantRequestID": "…",
 *         "CheckoutRequestID": "ws_CO_…",
 *         "ResultCode": 0,           // 0 = success; 1032 = user cancelled;
 *                                    // 1037 = timeout; 1 = insufficient funds
 *         "ResultDesc": "…",
 *         "CallbackMetadata": { "Item": [{Name, Value}, …] }   // success only
 *       }
 *     }
 *   }
 *
 * The Daraja sandbox itself is not invoked from CI (it requires the
 * `MPESA_CONSUMER_KEY` / `MPESA_PASSKEY` org credentials we deliberately do
 * not ship). Instead the specs POST a synthetic callback at our webhook
 * endpoint — production-faithful for the receive-and-process path, which is
 * what the audit flagged as untested.
 *
 * Stable IDs intentionally distinct from `dual-tenant-fixtures.ts` so this
 * suite can run in parallel with the cross-tenant isolation suite without
 * row collision.
 */
import type { APIRequestContext } from '@playwright/test';

// ============================================================================
// ENV / GATE
// ============================================================================

export const API_GATEWAY_URL =
  process.env.API_GATEWAY_URL ?? 'http://localhost:4000';

/**
 * The webhook endpoint can be mounted on either the api-gateway (when the
 * payments-ledger is in-process) or a sibling `payments-ledger` service.
 * We probe both so the suite works against either deployment topology.
 */
export const WEBHOOK_BASE_URL =
  process.env.PAYMENTS_LEDGER_URL ?? API_GATEWAY_URL;

export const REAL_BACKEND_ENABLED =
  process.env.E2E_ENABLE_REAL_BACKEND === '1';

/**
 * Daraja sandbox credentials are needed only for the *initial* STK push
 * (BusinessShortCode, Passkey, ConsumerKey, ConsumerSecret). When unset,
 * specs use `test.fixme()` to skip the live-push portion but still exercise
 * the callback receive path with a synthetic CheckoutRequestID.
 */
export const DARAJA_CREDS_AVAILABLE =
  !!process.env.DARAJA_SANDBOX_CONSUMER_KEY &&
  !!process.env.DARAJA_SANDBOX_CONSUMER_SECRET &&
  !!process.env.DARAJA_SANDBOX_PASSKEY &&
  !!process.env.DARAJA_SANDBOX_SHORTCODE;

// ============================================================================
// STABLE TEST IDS
// ============================================================================

export const mpesaTestIds = {
  tenantId: 'tnt_mpesa_e2e',
  userId: 'usr_mpesa_e2e',
  email: 'mpesa-e2e@borjie.test',
  propertyId: 'prp_mpesa_e2e',
  unitId: 'unt_mpesa_e2e',
  invoiceId: 'inv_mpesa_e2e',
  // eslint-disable-next-line borjie/no-jurisdictional-literal -- KE pilot E2E test phone (Safaricom sandbox range)
  testPhoneNumber: '254708374149',
  rentAmountKes: 5000,
} as const;

// ============================================================================
// CALLBACK PAYLOAD BUILDERS
// ============================================================================

/** Generate a checkoutRequestId in Safaricom's documented format. */
export function makeCheckoutRequestId(suffix?: string): string {
  const stamp = Date.now().toString(36);
  return `ws_CO_${stamp}${suffix ? `_${suffix}` : ''}`;
}

/** Generate a merchantRequestId in Safaricom's documented format. */
export function makeMerchantRequestId(suffix?: string): string {
  const stamp = Date.now().toString();
  return `${stamp.slice(0, 5)}-${stamp.slice(5, 10)}-${suffix ?? '1'}`;
}

interface SuccessCallbackOpts {
  merchantRequestId: string;
  checkoutRequestId: string;
  amount: number;
  mpesaReceiptNumber?: string;
  phoneNumber?: string;
}

/** Build a ResultCode=0 (success) callback per Daraja docs. */
export function buildSuccessCallback(opts: SuccessCallbackOpts) {
  const txDate = Number(
    new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  );
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: opts.merchantRequestId,
        CheckoutRequestID: opts.checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: opts.amount },
            {
              Name: 'MpesaReceiptNumber',
              Value: opts.mpesaReceiptNumber ?? `RCT${Date.now().toString().slice(-8)}`,
            },
            { Name: 'TransactionDate', Value: txDate },
            { Name: 'PhoneNumber', Value: opts.phoneNumber ?? mpesaTestIds.testPhoneNumber },
          ],
        },
      },
    },
  };
}

interface FailureCallbackOpts {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number; // 1032 = user cancelled; 1037 = timeout; 1 = insufficient funds
  resultDesc?: string;
}

/** Build a non-zero ResultCode (cancelled/timeout/failed) callback. */
export function buildFailureCallback(opts: FailureCallbackOpts) {
  const defaultDesc: Record<number, string> = {
    1: 'The balance is insufficient for the transaction.',
    1032: 'Request cancelled by user.',
    1037: 'DS timeout user cannot be reached.',
    2001: 'The initiator information is invalid.',
  };
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: opts.merchantRequestId,
        CheckoutRequestID: opts.checkoutRequestId,
        ResultCode: opts.resultCode,
        ResultDesc: opts.resultDesc ?? defaultDesc[opts.resultCode] ?? 'Failed.',
        // No CallbackMetadata on failure per Daraja docs.
      },
    },
  };
}

// ============================================================================
// WEBHOOK POSTER
// ============================================================================

/**
 * Candidate webhook paths. The api-gateway and payments-ledger have mounted
 * this endpoint under both `/webhooks/mpesa/stk` and
 * `/api/v1/payments/webhook/mpesa` over the project's history; we try both
 * so the suite survives a remount.
 */
export const STK_WEBHOOK_PATHS = [
  '/webhooks/mpesa/stk',
  '/api/v1/payments/webhook/mpesa',
] as const;

interface PostCallbackResult {
  status: number;
  body: unknown;
  path: string;
}

/**
 * POST a callback payload to whichever STK webhook path responds with a
 * non-404. Returns the first non-404 attempt; throws if every candidate
 * returns 404.
 */
export async function postStkCallback(
  request: APIRequestContext,
  payload: unknown,
  options: { extraHeaders?: Record<string, string> } = {}
): Promise<PostCallbackResult> {
  let last: PostCallbackResult | null = null;
  for (const path of STK_WEBHOOK_PATHS) {
    const resp = await request.post(`${WEBHOOK_BASE_URL}${path}`, {
      headers: { 'content-type': 'application/json', ...options.extraHeaders },
      data: payload,
      failOnStatusCode: false,
    });
    const status = resp.status();
    const body = await resp.json().catch(() => null);
    last = { status, body, path };
    if (status !== 404) return last;
  }
  if (!last) {
    throw new Error('postStkCallback: no STK webhook path was reachable');
  }
  return last;
}

// ============================================================================
// LEDGER PROBE
// ============================================================================

/**
 * Best-effort fetch of payment status by CheckoutRequestID (the externalId).
 * Returns the parsed body when the api-gateway exposes a lookup endpoint;
 * returns null when no such endpoint is reachable (suite then falls back to
 * polling /api/v1/payments).
 */
export async function fetchPaymentByExternalId(
  request: APIRequestContext,
  jwt: string,
  externalId: string
): Promise<{ status: string; receipt?: string } | null> {
  const candidates = [
    `/api/v1/payments?externalId=${encodeURIComponent(externalId)}`,
    `/api/v1/payments/by-external/${encodeURIComponent(externalId)}`,
    `/api/payments?externalId=${encodeURIComponent(externalId)}`,
  ];
  for (const path of candidates) {
    const resp = await request.get(`${API_GATEWAY_URL}${path}`, {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      failOnStatusCode: false,
    });
    if (resp.status() === 404 || resp.status() >= 500) continue;
    const body = (await resp.json().catch(() => null)) as {
      data?: { status?: string; receipt?: string; receiptUrl?: string };
      items?: Array<{ status?: string; receipt?: string; receiptUrl?: string }>;
    } | null;
    if (!body) continue;
    const item = body.data ?? body.items?.[0] ?? null;
    if (item && typeof item.status === 'string') {
      return {
        status: item.status,
        receipt: item.receipt ?? item.receiptUrl,
      };
    }
  }
  return null;
}

export { expect } from '@playwright/test';
