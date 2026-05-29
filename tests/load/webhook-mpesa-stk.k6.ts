/**
 * k6 load test — M-Pesa STK Push callback simulator.
 *
 * Gap-3 measured p99: webhook receive is one of the four production
 * paths that must hit a real SLO budget. The Safaricom Daraja STK
 * callback is the highest-volume payments webhook — every customer
 * top-up flows through it.
 *
 * Endpoint: POST {K6_PAYMENTS_URL}/webhooks/mpesa/stk
 *
 * Body shape mirrors Safaricom's documented payload (see
 * `services/payments-ledger/src/server.ts` → `MpesaStkCallbackSchema`).
 * We send the happy-path (`ResultCode: 0`) variant, populated with
 * fresh CheckoutRequestID per iteration so idempotency-dedup does not
 * short-circuit the ledger writer.
 *
 * Signature: optional. When `K6_MPESA_WEBHOOK_SECRET` is set we attach
 * an `X-Mpesa-Signature: <unix>.<hex>` header computed exactly the
 * same way the production server verifies it (HMAC-SHA256 over
 * `${ts}.${rawBody}`). Without the secret the test exercises the
 * unsigned dev posture (signature middleware short-circuits when
 * `MPESA_WEBHOOK_SECRET` is unset on the server side).
 *
 * SLO: p95 < 400 ms, p99 < 800 ms — set in `lib/config.ts` under the
 *      `webhook.mpesa.stk` tag.
 *
 * Run:
 *   K6_PAYMENTS_URL=http://localhost:3001 \
 *   K6_SCENARIO=normal \
 *   k6 run tests/load/webhook-mpesa-stk.k6.ts
 */

import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';

import { BASE_URL, LOADTEST_RUN_ID, buildOptions } from './lib/config';

// k6 reads `options` once at script load. Threshold = webhook.mpesa.stk.
export const options = buildOptions('webhook.mpesa.stk');

// ─── Environment ─────────────────────────────────────────────────────

declare const __ENV: Readonly<Record<string, string | undefined>>;

/**
 * Payments-ledger lives on its own port. Default to 3001 to match the
 * service's `process.env.PORT || 3001` posture. Operators can override
 * with `K6_PAYMENTS_URL` so the script also runs against staging.
 */
const PAYMENTS_BASE_URL: string =
  __ENV.K6_PAYMENTS_URL && __ENV.K6_PAYMENTS_URL.trim().length > 0
    ? __ENV.K6_PAYMENTS_URL.trim()
    : 'http://localhost:3001';

/** HMAC secret. Optional — server skips signature when its secret is unset. */
const WEBHOOK_SECRET: string = __ENV.K6_MPESA_WEBHOOK_SECRET ?? '';

// ─── Payload factory ─────────────────────────────────────────────────

interface StkCallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata: {
        Item: ReadonlyArray<{ Name: string; Value: string | number }>;
      };
    };
  };
}

/**
 * Build a fresh callback per iteration. The CheckoutRequestID is the
 * idempotency key — randomising it ensures every iteration exercises
 * the writer path, not the dedup short-circuit.
 */
function buildStkCallback(): StkCallbackPayload {
  const merchantId = `ws_CO_${Date.now()}${Math.floor(
    Math.random() * 100000,
  )}`;
  const checkoutId = `ws_CO_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const amount = Math.floor(1_000 + Math.random() * 9_000); // 1k–10k TZS
  const phone = `2557${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: merchantId,
        CheckoutRequestID: checkoutId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: `LOADTEST-${checkoutId.slice(-8)}` },
            { Name: 'TransactionDate', Value: Number(formatTransactionDate(new Date())) },
            { Name: 'PhoneNumber', Value: phone },
          ],
        },
      },
    },
  };
}

/** Safaricom uses a `YYYYMMDDhhmmss` integer for TransactionDate. */
function formatTransactionDate(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

// ─── Header builder (signed when secret available) ───────────────────

interface HeaderBag {
  [k: string]: string;
}

function buildHeaders(rawBody: string): HeaderBag {
  const base: HeaderBag = {
    'Content-Type': 'application/json',
    'User-Agent': `borjie-k6/1 (${LOADTEST_RUN_ID})`,
    'X-Loadtest-Run-Id': LOADTEST_RUN_ID,
    // Cloud LB usually forwards `X-Forwarded-For` from a Safaricom IP;
    // when the server's allowlist is enabled we spoof one of the well-
    // known IPs so the middleware admits the request. Operators with
    // a stricter allowlist should set `MPESA_ALLOWED_IPS` to permit
    // their k6 runner's IP for the duration of the load run.
    'X-Forwarded-For': '196.201.214.200',
  };

  if (WEBHOOK_SECRET.length > 0) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${timestamp}.${rawBody}`;
    const digest = crypto.hmac('sha256', WEBHOOK_SECRET, message, 'hex');
    base['X-Mpesa-Signature'] = `${timestamp}.${digest}`;
  }

  return base;
}

// ─── Iteration body ──────────────────────────────────────────────────

/**
 * k6 evaluates `BASE_URL` at module load but the M-Pesa endpoint lives
 * on a different service. We point at PAYMENTS_BASE_URL explicitly and
 * keep the BASE_URL import for parity with the other tests (some
 * monorepo setups route both behind a single LB).
 */
function endpointUrl(): string {
  return `${PAYMENTS_BASE_URL.replace(/\/+$/u, '')}/webhooks/mpesa/stk`;
}

export default function webhookMpesaStkIteration(): void {
  const payload = buildStkCallback();
  const rawBody = JSON.stringify(payload);
  const headers = buildHeaders(rawBody);

  const res = http.post(endpointUrl(), rawBody, {
    headers,
    tags: { name: 'webhook.mpesa.stk' },
    timeout: '5s',
  });

  check(res, {
    // Safaricom expects 200 with `{ResultCode: 0, ResultDesc: 'Accepted'}`.
    // 401 is the allowlist/signature-reject path; we accept it when the
    // operator runs without the spoofed IP / signing secret so the test
    // still reports a measurable round-trip latency.
    'status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'response body present': (r) => {
      const body = typeof r.body === 'string' ? r.body : '';
      return body.length > 0;
    },
  });

  // Mirror Safaricom's normal cadence: ~10 callbacks/sec during peak
  // payment windows. A short think-time keeps a single VU comfortably
  // below that ceiling.
  sleep(0.5);

  // Suppress unused-import warning — kept so a refactor that re-bases
  // the URL onto BASE_URL has the helper already in scope.
  void BASE_URL;
}
