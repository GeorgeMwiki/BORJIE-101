/**
 * Safaricom Daraja Mpesa B2C disbursement adapter.
 *
 * Inverse direction to `packages/connectors/src/adapters/mpesa-adapter.ts`,
 * which handles C2B (customer-to-business) STK push collections. This
 * file handles B2C (business-to-customer) payouts — landlord rent
 * remittances, owner-distribution settlements, vendor reimbursements.
 *
 * Daraja flow (synchronous part)
 * ------------------------------
 *  1. POST `/oauth/v1/generate?grant_type=client_credentials` with
 *     HTTP Basic (consumer_key:consumer_secret) — returns
 *     `{access_token, expires_in}` (typically 3599s).
 *  2. POST `/mpesa/b2c/v1/paymentrequest` with
 *     `Authorization: Bearer <token>` and the JSON envelope
 *     documented at https://developer.safaricom.co.ke/APIs/BusinessToCustomer.
 *     The response indicates only that the request was *accepted*; the
 *     actual disbursement result is delivered asynchronously to
 *     `ResultURL`.
 *
 * Async result
 * ------------
 * The real Mpesa B2C result is delivered as a callback to the
 * `ResultURL`. For the worker's purposes we treat a successful
 * acceptance as `'completed'` because (a) the worker stores the
 * Daraja `ConversationID` as the provider_ref, (b) downstream
 * reconciliation will mark the disbursement failed if Daraja's
 * callback says so, and (c) the worker would otherwise leave the
 * outbox row in `pending_retry` indefinitely. This matches the
 * de-facto behaviour of every B2C wrapper we surveyed (Selcom,
 * Cellulant) — the moment the rail accepts the request you treat the
 * row as dispatched, with reconciliation handled out of band.
 *
 * Idempotency
 * -----------
 * Daraja itself does NOT honour `OriginatorConversationID` for
 * dedup at the time of writing, but we still send it so the audit
 * trail correlates the worker's idempotencyKey with Daraja's record.
 * The CAS/outbox in the worker is the actual dedup boundary.
 */

import { randomUUID } from 'crypto';

import type {
  PayoutProvider,
  PayoutProviderInput,
  PayoutProviderResult,
} from '../stub-payout-provider';
import { DEFAULT_HTTP_TIMEOUT_MS, normaliseMsisdn, sanitiseSecrets } from './types';

// ---------------------------------------------------------------------------
// Config + dependency seams
// ---------------------------------------------------------------------------

export type MpesaB2CConfig = {
  /** `sandbox.safaricom.co.ke` or `api.safaricom.co.ke`. No protocol. */
  readonly host: string;
  readonly consumerKey: string;
  readonly consumerSecret: string;
  /** Daraja InitiatorName configured against the B2C shortcode. */
  readonly initiatorName: string;
  /** Pre-encrypted security credential (RSA-encrypted with Daraja public cert). */
  readonly securityCredential: string;
  /** Org B2C paybill / shortcode. */
  readonly shortcode: string;
  readonly queueTimeoutUrl: string;
  readonly resultUrl: string;
  /** Optional command-id override; defaults to `BusinessPayment`. */
  readonly commandId?: 'BusinessPayment' | 'SalaryPayment' | 'PromotionPayment';
  /** Optional remarks template; defaults to `payout {idempotencyKey}`. */
  readonly remarksTemplate?: string;
  /** Optional occasion field. */
  readonly occasion?: string;
  /** Per-call HTTP timeout. Defaults to 15s. */
  readonly timeoutMs?: number;
};

export type MpesaB2CDeps = {
  /** Test seam. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Test seam. Random correlation suffix. */
  readonly correlationSuffix?: () => string;
};

/**
 * In-memory OAuth token cache. Daraja tokens last ~3599s; we refresh
 * 60s before expiry to avoid a fence-post failure. The cache is
 * scoped to a single adapter instance, so two composed adapters
 * cannot accidentally share a token.
 */
type TokenCache = {
  token: string;
  expiresAtMs: number;
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createMpesaB2CAdapter(
  config: MpesaB2CConfig,
  deps: MpesaB2CDeps = {},
): PayoutProvider {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const correlationSuffix = deps.correlationSuffix ?? (() => randomUUID());
  const timeoutMs = config.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const oauthUrl = `https://${config.host}/oauth/v1/generate?grant_type=client_credentials`;
  const b2cUrl = `https://${config.host}/mpesa/b2c/v1/paymentrequest`;
  let tokenCache: TokenCache | null = null;

  async function fetchAccessToken(): Promise<string> {
    if (tokenCache && tokenCache.expiresAtMs > now()) {
      return tokenCache.token;
    }
    const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    let res: Response;
    try {
      res = await fetchImpl(oauthUrl, {
        method: 'GET',
        headers: { Authorization: `Basic ${basic}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(redact(`mpesa_oauth_network_error: ${msg}`));
    }
    if (!res.ok) {
      const body = await safeReadText(res);
      throw new Error(redact(`mpesa_oauth_http_${res.status}: ${body}`));
    }
    const json = (await safeReadJson(res)) as { access_token?: unknown; expires_in?: unknown };
    const token = typeof json.access_token === 'string' ? json.access_token : '';
    if (token.length === 0) {
      throw new Error('mpesa_oauth_no_access_token');
    }
    const expiresInRaw = json.expires_in;
    const expiresInSec = typeof expiresInRaw === 'number'
      ? expiresInRaw
      : typeof expiresInRaw === 'string' && /^[0-9]+$/.test(expiresInRaw)
        ? Number.parseInt(expiresInRaw, 10)
        : 3599;
    // Refresh 60s before actual expiry.
    const refreshSkewMs = 60_000;
    tokenCache = {
      token,
      expiresAtMs: now() + Math.max(0, expiresInSec * 1000 - refreshSkewMs),
    };
    return token;
  }

  async function send(input: PayoutProviderInput): Promise<PayoutProviderResult> {
    const validation = validateInput(input);
    if (validation.kind === 'invalid') {
      return {
        providerRef: `mpesa_validation_${input.idempotencyKey}`,
        status: 'failed',
        failureReason: validation.reason,
      };
    }
    const { msisdn } = validation;

    let token: string;
    try {
      token = await fetchAccessToken();
    } catch (err) {
      return {
        providerRef: `mpesa_oauth_${input.idempotencyKey}`,
        status: 'failed',
        failureReason: redact(err instanceof Error ? err.message : String(err)),
      };
    }

    const originatorConversationId = `${input.idempotencyKey}-${correlationSuffix()}`;
    const remarks = (config.remarksTemplate ?? 'payout {idempotencyKey}').replace(
      '{idempotencyKey}',
      input.idempotencyKey,
    );
    const body = {
      OriginatorConversationID: originatorConversationId,
      InitiatorName: config.initiatorName,
      SecurityCredential: config.securityCredential,
      CommandID: config.commandId ?? 'BusinessPayment',
      Amount: minorToMajor(input.amountMinor),
      PartyA: config.shortcode,
      PartyB: msisdn,
      Remarks: truncate(remarks, 100),
      QueueTimeOutURL: config.queueTimeoutUrl,
      ResultURL: config.resultUrl,
      Occasion: truncate(config.occasion ?? `tenant:${input.tenantId}`, 100),
    };

    let res: Response;
    try {
      res = await fetchImpl(b2cUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        providerRef: `mpesa_network_${originatorConversationId}`,
        status: 'failed',
        failureReason: redact(`mpesa_b2c_network_error: ${msg}`),
      };
    }

    const json = (await safeReadJson(res)) as {
      ConversationID?: unknown;
      OriginatorConversationID?: unknown;
      ResponseCode?: unknown;
      ResponseDescription?: unknown;
      errorCode?: unknown;
      errorMessage?: unknown;
    };
    if (!res.ok) {
      const detail =
        (typeof json.errorMessage === 'string' && json.errorMessage) ||
        (typeof json.ResponseDescription === 'string' && json.ResponseDescription) ||
        `http_${res.status}`;
      return {
        providerRef: `mpesa_http_${originatorConversationId}`,
        status: 'failed',
        failureReason: redact(`mpesa_b2c_http_${res.status}: ${detail}`),
      };
    }
    // Daraja signals success with `ResponseCode === '0'`.
    const responseCode =
      typeof json.ResponseCode === 'string' || typeof json.ResponseCode === 'number'
        ? String(json.ResponseCode)
        : null;
    if (responseCode !== '0') {
      const detail =
        (typeof json.ResponseDescription === 'string' && json.ResponseDescription) ||
        'unknown_response_code';
      return {
        providerRef: `mpesa_rejected_${originatorConversationId}`,
        status: 'failed',
        failureReason: redact(`mpesa_b2c_rejected_${responseCode ?? 'null'}: ${detail}`),
      };
    }
    const conversationId =
      typeof json.ConversationID === 'string' && json.ConversationID.length > 0
        ? json.ConversationID
        : originatorConversationId;
    return {
      providerRef: conversationId,
      status: 'completed',
    };
  }

  function redact(message: string): string {
    return sanitiseSecrets(message, [
      config.consumerKey,
      config.consumerSecret,
      config.securityCredential,
      tokenCache?.token,
    ]);
  }

  return { send };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ValidationResult =
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'valid'; readonly msisdn: string };

function validateInput(input: PayoutProviderInput): ValidationResult {
  if (input.currency !== 'KES') {
    return { kind: 'invalid', reason: `mpesa_b2c_unsupported_currency_${input.currency}` };
  }
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) {
    return { kind: 'invalid', reason: 'mpesa_b2c_invalid_amount' };
  }
  if (!Number.isInteger(input.amountMinor)) {
    return { kind: 'invalid', reason: 'mpesa_b2c_non_integer_amount' };
  }
  // Daraja B2C accepts whole-shilling amounts only.
  if (input.amountMinor % 100 !== 0) {
    return { kind: 'invalid', reason: 'mpesa_b2c_fractional_shilling' };
  }
  const msisdn = normaliseMsisdn(input.destination);
  if (!msisdn) {
    return { kind: 'invalid', reason: 'mpesa_b2c_invalid_msisdn' };
  }
  return { kind: 'valid', msisdn };
}

function minorToMajor(amountMinor: number): number {
  // Daraja expects whole KES (major units). amountMinor is cents.
  return Math.round(amountMinor / 100);
}

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function safeReadJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
