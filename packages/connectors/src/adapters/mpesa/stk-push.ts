/**
 * M-Pesa Daraja 3.0 — STK Push (Lipa-na-M-Pesa Online).
 *
 * The rent-collection flow: landlord (or scheduler) calls `initiateStkPush`,
 * Daraja sends a USSD prompt to the tenant's handset, tenant enters M-Pesa
 * PIN, Safaricom debits the wallet, then POSTs `stkCallback` to our
 * webhook (see `webhook-handlers.ts`).
 *
 * The function returns the synchronous Daraja ack (contains
 * `CheckoutRequestID` — the linker between this call and the eventual
 * callback). Persist this ID before doing anything else so the callback
 * can match.
 */

import type { ConnectorOutcome } from '../../base-connector.js';
import type { MpesaClient } from './mpesa-client.js';
import {
  StkPushInputSchema,
  StkPushOutputSchema,
  type StkPushInput,
  type StkPushOutput,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers — pure, no IO
// ─────────────────────────────────────────────────────────────────────

/**
 * Daraja STK Push expects timestamp `YYYYMMDDHHMMSS` in EAT (UTC+3).
 */
export function isoTimestampEAT(clock: () => number): string {
  const nowMs = clock() + 3 * 60 * 60 * 1000;
  const d = new Date(nowMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

/**
 * Daraja expects `2547XXXXXXXX` (no `+`, country-code prefixed). Accepts
 * +254, 254, or 0-prefixed local input and normalises.
 */
export function normaliseMsisdn(raw: string): string {
  const cleaned = raw.replace(/^\+/, '');
  if (cleaned.startsWith('0')) return `254${cleaned.slice(1)}`;
  if (cleaned.startsWith('7') || cleaned.startsWith('1')) return `254${cleaned}`;
  return cleaned;
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/**
 * The Daraja "Password" field — `base64(shortCode + passKey + timestamp)`.
 */
export function buildStkPushPassword(
  shortCode: string,
  passKey: string,
  timestamp: string,
): string {
  return base64(`${shortCode}${passKey}${timestamp}`);
}

/**
 * Resolve the callback URL: caller override wins, otherwise default to
 * `${callbackBaseUrl}/webhooks/mpesa/stk`.
 */
export function resolveCallbackUrl(
  callbackBaseUrl: string,
  override?: string,
): string {
  if (override) return override;
  return `${callbackBaseUrl.replace(/\/+$/, '')}/webhooks/mpesa/stk`;
}

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface InitiateStkPushDeps {
  readonly client: MpesaClient;
  readonly clock?: () => number;
}

/**
 * Initiate a Daraja STK Push (rent collection). Validates input via Zod,
 * computes the Daraja `Password` field per spec, normalises the MSISDN,
 * then POSTs `/mpesa/stkpush/v1/processrequest`.
 *
 * Returns the synchronous Daraja ack. The actionable receipt arrives later
 * via `stkCallback` — see `decodeStkCallback` in `webhook-handlers.ts`.
 */
export async function initiateStkPush(
  deps: InitiateStkPushDeps,
  args: StkPushInput,
  idempotencyKey?: string,
): Promise<ConnectorOutcome<StkPushOutput>> {
  const parsed = StkPushInputSchema.safeParse(args);
  if (!parsed.success) {
    return { kind: 'validation-failed', issue: parsed.error.message };
  }
  const clock = deps.clock ?? Date.now;
  const { credentials, connector } = deps.client;

  const ts = isoTimestampEAT(clock);
  const password = buildStkPushPassword(
    credentials.shortCode,
    credentials.passKey,
    ts,
  );
  const phone = normaliseMsisdn(parsed.data.msisdn);
  const callbackUrl = resolveCallbackUrl(
    credentials.callbackBaseUrl,
    parsed.data.callbackUrl,
  );

  return connector.call<unknown, StkPushOutput>({
    path: '/mpesa/stkpush/v1/processrequest',
    method: 'POST',
    body: {
      BusinessShortCode: credentials.shortCode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: parsed.data.amount,
      PartyA: phone,
      PartyB: credentials.shortCode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: parsed.data.accountReference,
      TransactionDesc: parsed.data.transactionDesc,
    },
    outputSchema: StkPushOutputSchema,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  });
}
