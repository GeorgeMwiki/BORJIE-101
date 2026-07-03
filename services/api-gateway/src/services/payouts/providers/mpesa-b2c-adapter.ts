/**
 * Safaricom Daraja Mpesa B2C disbursement adapter.
 *
 * Inverse direction to `packages/connectors/src/adapters/mpesa-adapter.ts`,
 * which handles C2B (customer-to-business) STK push collections. This
 * file handles B2C (business-to-customer) payouts — estate-owner
 * distribution settlements, owner royalty remittances, vendor
 * reimbursements.
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
 * Idempotency (DOUBLE-PAY BARRIER — read before touching)
 * -------------------------------------------------------
 * The dangerous scenario: a B2C POST DEBITS Safaricom but its RESPONSE
 * times out (the `catch` at the fetch below). The worker treats that as a
 * failure and re-dispatches on the next tick. If the wire key changed
 * between attempts, Safaricom sees two DISTINCT requests and debits TWICE.
 *
 * Barrier 1 — DETERMINISTIC wire key. `OriginatorConversationID` is derived
 * SOLELY from `input.idempotencyKey` (no random suffix). A retry re-sends
 * the EXACT SAME `OriginatorConversationID`, so any dedup Daraja does
 * perform can catch it, and — critically — our own pre-send status probe
 * (barrier 2) can recognise the prior attempt.
 *
 * Barrier 2 — PRE-SEND TRANSACTION-STATUS GUARD. Daraja historically did
 * NOT dedup on `OriginatorConversationID`, so a deterministic key ALONE is
 * necessary but not sufficient. Before every B2C POST we query Daraja's
 * Transaction Status API keyed by this deterministic `OriginatorConversationID`:
 * if a prior attempt already reached Safaricom (found / still processing),
 * we DO NOT re-POST — we return the original as completed. Only when the
 * status query is DEFINITIVELY "no such transaction" do we send. The probe
 * is enabled only when the org's transaction-status result URLs are
 * configured (`transactionStatus`); without them the guard cannot run and
 * the deterministic key + the worker CAS are the remaining barrier — the
 * config comment on `transactionStatus` documents that trade-off.
 *
 * The worker CAS / outbox (pending→processing, terminal-status pick) is the
 * OUTER dedup boundary for concurrent replicas; these two barriers close the
 * INNER "same row, timed-out response, re-dispatched" window that CAS alone
 * cannot (the row is legitimately back in `pending`).
 */

import { createHash } from 'crypto';

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
  /**
   * Transaction-Status API config (double-pay barrier 2). When present, the
   * adapter probes Daraja's `/mpesa/transactionstatus/v1/query` keyed by the
   * DETERMINISTIC `OriginatorConversationID` BEFORE every B2C POST, so a
   * retry of a request whose response timed out does NOT debit twice. When
   * ABSENT the probe is skipped and the deterministic wire key + the worker
   * CAS are the remaining barrier (a retry after a timed-out response can, in
   * the worst case, re-debit — configure this to close that window).
   */
  readonly transactionStatus?: {
    /** Daraja InitiatorName authorised for the Transaction Status API. */
    readonly initiatorName: string;
    /** Pre-encrypted security credential for the status initiator. */
    readonly securityCredential: string;
    /** Party (shortcode) whose transactions are queried. */
    readonly partyA: string;
    /** Identifier type for PartyA (4 = shortcode). */
    readonly identifierType?: '1' | '2' | '4';
    readonly queueTimeoutUrl: string;
    readonly resultUrl: string;
  };
};

export type MpesaB2CDeps = {
  /** Test seam. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam. Defaults to `Date.now`. */
  readonly now?: () => number;
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
  const timeoutMs = config.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const oauthUrl = `https://${config.host}/oauth/v1/generate?grant_type=client_credentials`;
  const b2cUrl = `https://${config.host}/mpesa/b2c/v1/paymentrequest`;
  const txnStatusUrl = `https://${config.host}/mpesa/transactionstatus/v1/query`;
  let tokenCache: TokenCache | null = null;

  /**
   * DETERMINISTIC wire idempotency key (double-pay barrier 1). Derived
   * SOLELY from `input.idempotencyKey` so a retry re-sends the SAME
   * `OriginatorConversationID`. Daraja caps `OriginatorConversationID` at 128
   * chars: when the key is short we pass it through verbatim (so operators can
   * eyeball the correlation in the Daraja portal); when it would overflow we
   * fall back to a stable SHA-256 hash of the key (still deterministic — the
   * SAME key always yields the SAME id). NEVER random.
   */
  function originatorConversationIdFor(idempotencyKey: string): string {
    const MAX_LEN = 128;
    if (idempotencyKey.length <= MAX_LEN) return idempotencyKey;
    const digest = createHash('sha256').update(idempotencyKey).digest('hex');
    return `oci-${digest}`;
  }

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

  /**
   * Pre-send double-pay guard (barrier 2). Queries Daraja's Transaction
   * Status API keyed by the DETERMINISTIC `OriginatorConversationID`. Returns:
   *   - `disabled`     — no transaction-status config; caller proceeds to POST
   *                      (deterministic key + worker CAS remain the barrier).
   *   - `not_sent`     — Daraja definitively has no such transaction; SAFE to POST.
   *   - `already_sent` — a prior attempt reached Safaricom; caller must NOT
   *                      re-POST (returns the original as completed).
   *   - `inconclusive` — the probe itself failed (network / HTTP / unparseable);
   *                      caller must NOT POST (fail-closed; retry next tick).
   *
   * The status API is asynchronous by nature (the definitive result lands on
   * the ResultURL), but the SYNCHRONOUS acceptance envelope distinguishes
   * "accepted for query" (ResponseCode '0') from a hard "invalid request".
   * Daraja returns an errorCode/`ResponseCode` indicating the Originator
   * ConversationID is unknown when nothing matches — we treat only that
   * explicit not-found signal as `not_sent`. Anything ambiguous is
   * `inconclusive` (never a silent send).
   */
  async function checkPriorAttempt(
    token: string,
    originatorConversationId: string,
  ): Promise<
    | { kind: 'disabled' }
    | { kind: 'not_sent' }
    | { kind: 'already_sent'; providerRef: string }
    | { kind: 'inconclusive'; reason: string }
  > {
    const ts = config.transactionStatus;
    if (!ts) return { kind: 'disabled' };

    const body = {
      Initiator: ts.initiatorName,
      SecurityCredential: ts.securityCredential,
      CommandID: 'TransactionStatusQuery',
      OriginatorConversationID: originatorConversationId,
      PartyA: ts.partyA,
      IdentifierType: ts.identifierType ?? '4',
      ResultURL: ts.resultUrl,
      QueueTimeOutURL: ts.queueTimeoutUrl,
      Remarks: 'predispatch-dedup-probe',
      Occasion: 'predispatch-dedup-probe',
    };

    let res: Response;
    try {
      res = await fetchImpl(txnStatusUrl, {
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
      return { kind: 'inconclusive', reason: redact(`network: ${msg}`) };
    }

    const json = (await safeReadJson(res)) as {
      ResponseCode?: unknown;
      ResponseDescription?: unknown;
      errorCode?: unknown;
      errorMessage?: unknown;
      OriginatorConversationID?: unknown;
    };

    // An explicit "no such transaction" is the only signal that makes a POST
    // safe. Daraja surfaces it as an errorMessage/description mentioning the
    // OriginatorConversationID is not found. Everything else is treated as a
    // possible in-flight / completed prior attempt (already_sent) EXCEPT a
    // hard transport error (inconclusive above).
    const description =
      (typeof json.ResponseDescription === 'string' && json.ResponseDescription) ||
      (typeof json.errorMessage === 'string' && json.errorMessage) ||
      '';
    const notFound = /not\s*found|does\s*not\s*exist|no\s*such|invalid originator/i.test(
      description,
    );
    if (!res.ok) {
      // A 4xx that clearly says "unknown OriginatorConversationID" ⇒ never sent.
      if (notFound) return { kind: 'not_sent' };
      return {
        kind: 'inconclusive',
        reason: redact(`http_${res.status}: ${description || 'unparseable'}`),
      };
    }
    if (notFound) return { kind: 'not_sent' };

    const responseCode =
      typeof json.ResponseCode === 'string' || typeof json.ResponseCode === 'number'
        ? String(json.ResponseCode)
        : null;
    // ResponseCode '0' = the query was ACCEPTED, meaning Daraja recognised the
    // OriginatorConversationID — a prior attempt exists. Do NOT re-POST.
    if (responseCode === '0') {
      return {
        kind: 'already_sent',
        providerRef: `mpesa_prior_${originatorConversationId}`,
      };
    }
    return {
      kind: 'inconclusive',
      reason: redact(
        `unrecognised_status_response_${responseCode ?? 'null'}: ${description}`,
      ),
    };
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

    // DETERMINISTIC wire key (barrier 1): a retry re-sends the SAME id.
    const originatorConversationId = originatorConversationIdFor(
      input.idempotencyKey,
    );

    // PRE-SEND STATUS GUARD (barrier 2): if this OriginatorConversationID
    // already reached Safaricom on a prior attempt (whose response we never
    // saw), DO NOT re-POST — that would debit twice. Only proceed to POST when
    // the probe is disabled (unconfigured) OR definitively reports the txn was
    // never seen. A probe that ERRORS is treated as inconclusive → we do NOT
    // send (fail-closed on the money-out path; the worker retries next tick).
    const guard = await checkPriorAttempt(token, originatorConversationId);
    if (guard.kind === 'already_sent') {
      return {
        providerRef: guard.providerRef,
        status: 'completed',
      };
    }
    if (guard.kind === 'inconclusive') {
      return {
        providerRef: `mpesa_status_probe_${originatorConversationId}`,
        status: 'failed',
        failureReason: redact(
          `mpesa_b2c_status_probe_inconclusive: ${guard.reason}`,
        ),
      };
    }

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
      // The POST left this process — we CANNOT know whether Safaricom received
      // and debited it (a timeout / dropped response is exactly the ambiguous
      // case). Return INDETERMINATE, never `failed`: the worker routes this to a
      // non-retryable reconciliation state so we never auto-re-POST a payment
      // that may already have debited (Daraja does not dedup on the wire key).
      // A configured Transaction-Status probe (barrier 2) resolves such rows on
      // the next attempt; without it a human reconciles via the Daraja portal.
      const msg = err instanceof Error ? err.message : String(err);
      return {
        providerRef: `mpesa_network_${originatorConversationId}`,
        status: 'indeterminate',
        failureReason: redact(`mpesa_b2c_network_error_indeterminate: ${msg}`),
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
      // 4xx = Daraja REJECTED the request before queueing (bad auth / malformed)
      // → definitely not debited → safe to retry. 5xx = server-side error AFTER
      // the request was received → it may already have been queued → INDETERMINATE
      // (never auto-re-POST). Only the 4xx path is a plain retryable failure.
      const indeterminate = res.status >= 500;
      return {
        providerRef: `mpesa_http_${originatorConversationId}`,
        status: indeterminate ? 'indeterminate' : 'failed',
        failureReason: redact(
          `mpesa_b2c_http_${res.status}${indeterminate ? '_indeterminate' : ''}: ${detail}`,
        ),
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
