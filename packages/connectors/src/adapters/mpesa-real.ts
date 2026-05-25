/**
 * M-Pesa Daraja v2.0 real adapter — production-grade client for Safaricom
 * (Kenya) and Vodacom (Tanzania) Daraja public APIs.
 *
 * Coverage:
 *   - OAuth `/oauth/v1/generate?grant_type=client_credentials` with token caching
 *     (Daraja issues a Bearer good for `expires_in` seconds, typically 3599).
 *   - STK Push `/mpesa/stkpush/v1/processrequest` (Lipa na M-Pesa Online).
 *   - C2B register URL `/mpesa/c2b/v2/registerurl`.
 *   - C2B callback parsing (helper, since the callback is a webhook the
 *     server receives — we expose a parser).
 *   - B2C payout `/mpesa/b2c/v3/paymentrequest`.
 *   - Transaction status `/mpesa/transactionstatus/v1/query`.
 *   - Account balance `/mpesa/accountbalance/v1/query`.
 *
 * Sandbox vs production: `MPESA_ENV=sandbox|production` selects the
 * default base URL when none is supplied (`https://sandbox.safaricom.co.ke`
 * vs `https://api.safaricom.co.ke`). Callers may override.
 *
 * Discipline: wraps every outbound call through `createBaseConnector`,
 * inheriting rate-limit / circuit-breaker / retry / audit. No raw fetch
 * leaks into call paths. Token cache lives inside the adapter closure
 * (per-adapter-instance) and is invalidated on 401.
 *
 * Tests inject `fetch`; no real network calls in CI.
 */

import { z } from 'zod';
import {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type ConnectorEventSink,
  type ConnectorOutcome,
} from '../base-connector.js';

// ─────────────────────────────────────────────────────────────────────
// Environment + credentials
// ─────────────────────────────────────────────────────────────────────

export type MpesaEnv = 'sandbox' | 'production';

const BASE_URLS: Readonly<Record<MpesaEnv, string>> = Object.freeze({
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
});

export interface MpesaRealCredentials {
  readonly consumerKey: string;
  readonly consumerSecret: string;
  /** Short code (paybill / till). Required for STK + C2B + B2C. */
  readonly shortCode: string;
  /** STK push pass-key (Lipa na M-Pesa). Required for STK push. */
  readonly passKey?: string;
  /** Initiator name — required by B2C / status / balance. */
  readonly initiatorName?: string;
  /**
   * Security credential — RSA-encrypted password generated per Daraja
   * docs. Required by B2C / status / balance. Callers compute this
   * out-of-band (typically once per cert rotation) and pass it in.
   */
  readonly securityCredential?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Schemas — STK push
// ─────────────────────────────────────────────────────────────────────

const E164_OR_LOCAL = /^(?:\+?254|0)?[17]\d{8}$/;

export const StkPushInputSchema = z.object({
  amount: z.number().int().positive(),
  msisdn: z.string().regex(E164_OR_LOCAL),
  accountReference: z.string().min(1).max(12),
  transactionDesc: z.string().min(1).max(13),
  callbackUrl: z.string().url(),
});
export type StkPushInput = z.infer<typeof StkPushInputSchema>;

export const StkPushOutputSchema = z.object({
  MerchantRequestID: z.string(),
  CheckoutRequestID: z.string(),
  ResponseCode: z.string(),
  ResponseDescription: z.string(),
  CustomerMessage: z.string().optional(),
});
export type StkPushOutput = z.infer<typeof StkPushOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Schemas — C2B
// ─────────────────────────────────────────────────────────────────────

export const C2bRegisterUrlInputSchema = z.object({
  responseType: z.enum(['Completed', 'Cancelled']),
  confirmationUrl: z.string().url(),
  validationUrl: z.string().url(),
});
export type C2bRegisterUrlInput = z.infer<typeof C2bRegisterUrlInputSchema>;

export const C2bRegisterUrlOutputSchema = z.object({
  OriginatorCoversationID: z.string().optional(),
  ResponseCode: z.string().optional(),
  ResponseDescription: z.string(),
});
export type C2bRegisterUrlOutput = z.infer<typeof C2bRegisterUrlOutputSchema>;

/** C2B confirmation webhook payload as parsed from the Daraja callback POST. */
export const C2bCallbackPayloadSchema = z.object({
  TransactionType: z.string().optional(),
  TransID: z.string(),
  TransTime: z.string(),
  TransAmount: z.string(),
  BusinessShortCode: z.string(),
  BillRefNumber: z.string().optional(),
  InvoiceNumber: z.string().optional(),
  OrgAccountBalance: z.string().optional(),
  ThirdPartyTransID: z.string().optional(),
  MSISDN: z.string(),
  FirstName: z.string().optional(),
  MiddleName: z.string().optional(),
  LastName: z.string().optional(),
});
export type C2bCallbackPayload = z.infer<typeof C2bCallbackPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────
// Schemas — B2C
// ─────────────────────────────────────────────────────────────────────

export const B2cInputSchema = z.object({
  amount: z.number().int().positive(),
  msisdn: z.string().regex(E164_OR_LOCAL),
  commandId: z
    .enum(['SalaryPayment', 'BusinessPayment', 'PromotionPayment'])
    .default('BusinessPayment'),
  remarks: z.string().min(1).max(100),
  occasion: z.string().max(100).optional(),
  queueTimeoutUrl: z.string().url(),
  resultUrl: z.string().url(),
});
export type B2cInput = z.infer<typeof B2cInputSchema>;

export const B2cOutputSchema = z.object({
  ConversationID: z.string(),
  OriginatorConversationID: z.string(),
  ResponseCode: z.string(),
  ResponseDescription: z.string(),
});
export type B2cOutput = z.infer<typeof B2cOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Schemas — Transaction status + balance
// ─────────────────────────────────────────────────────────────────────

export const TransactionStatusInputSchema = z.object({
  transactionId: z.string().min(1),
  remarks: z.string().min(1).max(100).default('status'),
  occasion: z.string().max(100).optional(),
  queueTimeoutUrl: z.string().url(),
  resultUrl: z.string().url(),
});
export type TransactionStatusInput = z.infer<typeof TransactionStatusInputSchema>;

export const TransactionStatusOutputSchema = z.object({
  ConversationID: z.string(),
  OriginatorConversationID: z.string(),
  ResponseCode: z.string(),
  ResponseDescription: z.string(),
});
export type TransactionStatusOutput = z.infer<typeof TransactionStatusOutputSchema>;

export const AccountBalanceInputSchema = z.object({
  remarks: z.string().min(1).max(100).default('balance'),
  queueTimeoutUrl: z.string().url(),
  resultUrl: z.string().url(),
});
export type AccountBalanceInput = z.infer<typeof AccountBalanceInputSchema>;

export const AccountBalanceOutputSchema = TransactionStatusOutputSchema;
export type AccountBalanceOutput = z.infer<typeof AccountBalanceOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

export interface MpesaRealAdapterDeps {
  readonly env?: MpesaEnv;
  /** Override the base URL. Wins over `env`. */
  readonly baseUrl?: string;
  readonly credentials: MpesaRealCredentials;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface MpesaRealAdapter {
  readonly connector: BaseConnector;
  readonly env: MpesaEnv;
  stkPush(args: StkPushInput, idempotencyKey?: string): Promise<ConnectorOutcome<StkPushOutput>>;
  registerC2bUrl(args: C2bRegisterUrlInput): Promise<ConnectorOutcome<C2bRegisterUrlOutput>>;
  /** Parse a Daraja C2B confirmation webhook body. Pure — no IO. */
  parseC2bCallback(rawBody: unknown): { ok: true; data: C2bCallbackPayload } | { ok: false; issue: string };
  payB2c(args: B2cInput, idempotencyKey?: string): Promise<ConnectorOutcome<B2cOutput>>;
  queryTransactionStatus(
    args: TransactionStatusInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<TransactionStatusOutput>>;
  queryAccountBalance(
    args: AccountBalanceInput,
  ): Promise<ConnectorOutcome<AccountBalanceOutput>>;
  /** Diagnostic — expose the cached-token expiry epoch ms (or null). */
  tokenExpiryMs(): number | null;
}

/**
 * Cached OAuth bearer. Lives inside the closure of one adapter instance
 * so adapters in different tenants do not share tokens.
 */
interface TokenCacheState {
  token: string | null;
  expiresAtMs: number;
}

function isoTimestamp(clock: () => number): string {
  // Daraja STK push expects YYYYMMDDHHMMSS in EAT (UTC+3). We compute in
  // UTC then add 3h offset.
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

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function normaliseMsisdn(raw: string): string {
  // Daraja expects 2547xxxxxxxx (no '+', leading country code 254).
  const cleaned = raw.replace(/^\+/, '');
  if (cleaned.startsWith('0')) return `254${cleaned.slice(1)}`;
  if (cleaned.startsWith('7') || cleaned.startsWith('1')) return `254${cleaned}`;
  return cleaned;
}

export function createMpesaRealAdapter(deps: MpesaRealAdapterDeps): MpesaRealAdapter {
  const env: MpesaEnv = deps.env ?? 'sandbox';
  const baseUrl = deps.baseUrl ?? BASE_URLS[env];
  const credentials = deps.credentials;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const clock = deps.clock ?? Date.now;

  if (!fetchImpl) {
    throw new Error('createMpesaRealAdapter: no fetch implementation available');
  }
  if (!credentials.consumerKey || !credentials.consumerSecret) {
    throw new Error(
      'createMpesaRealAdapter: consumerKey and consumerSecret are required',
    );
  }

  const tokenCache: TokenCacheState = { token: null, expiresAtMs: 0 };

  // HIGH-4 (audit .audit/post-pr90-api-mcp-bug-sweep.md): The OAuth
  // fetch used to bypass connector.call() — no audit on token-issuance,
  // making the "which tenant's OAuth was active when" trail invisible.
  // Route /oauth/v1/generate through a dedicated no-auth connector so
  // the rate-limit/circuit-breaker/audit apply.
  const oauthConnector = createBaseConnector({
    config: {
      id: 'mpesa-real-oauth',
      displayName: `M-Pesa Daraja oauth (${env})`,
      baseUrl,
      rateLimit: { rpm: 30, burst: 5 },
      circuitBreaker: { errorThreshold: 4, halfOpenAfterMs: 60_000 },
      retry: { maxAttempts: 1, initialDelayMs: 250 },
      timeoutMs: 12_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function fetchToken(): Promise<string> {
    const credPair = base64(`${credentials.consumerKey}:${credentials.consumerSecret}`);
    const outcome = await oauthConnector.call<
      undefined,
      { access_token?: string; expires_in?: string | number }
    >({
      path: '/oauth/v1/generate',
      method: 'GET',
      query: { grant_type: 'client_credentials' },
      headers: {
        Authorization: `Basic ${credPair}`,
        Accept: 'application/json',
      },
    });
    if (outcome.kind !== 'ok') {
      throw new Error(`mpesa-real: oauth ${outcome.kind}`);
    }
    const body = outcome.data;
    if (!body.access_token) {
      throw new Error('mpesa-real: oauth response missing access_token');
    }
    const lifetimeSec = Number(body.expires_in ?? 3599);
    // Refresh 60s before expiry to avoid race.
    tokenCache.token = body.access_token;
    tokenCache.expiresAtMs = clock() + Math.max(60, lifetimeSec - 60) * 1000;
    return body.access_token;
  }

  async function getToken(): Promise<string> {
    if (tokenCache.token && clock() < tokenCache.expiresAtMs) {
      return tokenCache.token;
    }
    return fetchToken();
  }

  function invalidateToken(): void {
    tokenCache.token = null;
    tokenCache.expiresAtMs = 0;
  }

  const connector = createBaseConnector({
    config: {
      id: 'mpesa-real',
      displayName: `M-Pesa Daraja (${env})`,
      baseUrl,
      auth: {
        kind: 'oauth2',
        accessTokenProvider: getToken,
        refresh: async () => {
          invalidateToken();
          await fetchToken();
        },
      },
      rateLimit: { rpm: 600, burst: 60 },
      circuitBreaker: { errorThreshold: 5, halfOpenAfterMs: 30_000 },
      retry: { maxAttempts: 3, initialDelayMs: 250 },
      timeoutMs: 12_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  // ───── STK push
  async function stkPush(
    args: StkPushInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<StkPushOutput>> {
    const parsed = StkPushInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    if (!credentials.passKey) {
      return { kind: 'unconfigured', reason: 'passKey required for STK push' };
    }
    const ts = isoTimestamp(clock);
    const password = base64(`${credentials.shortCode}${credentials.passKey}${ts}`);
    const phone = normaliseMsisdn(parsed.data.msisdn);

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
        CallBackURL: parsed.data.callbackUrl,
        AccountReference: parsed.data.accountReference,
        TransactionDesc: parsed.data.transactionDesc,
      },
      outputSchema: StkPushOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  // ───── C2B
  async function registerC2bUrl(
    args: C2bRegisterUrlInput,
  ): Promise<ConnectorOutcome<C2bRegisterUrlOutput>> {
    const parsed = C2bRegisterUrlInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    return connector.call<unknown, C2bRegisterUrlOutput>({
      path: '/mpesa/c2b/v2/registerurl',
      method: 'POST',
      body: {
        ShortCode: credentials.shortCode,
        ResponseType: parsed.data.responseType,
        ConfirmationURL: parsed.data.confirmationUrl,
        ValidationURL: parsed.data.validationUrl,
      },
      outputSchema: C2bRegisterUrlOutputSchema,
    });
  }

  function parseC2bCallback(
    rawBody: unknown,
  ): { ok: true; data: C2bCallbackPayload } | { ok: false; issue: string } {
    const parsed = C2bCallbackPayloadSchema.safeParse(rawBody);
    if (!parsed.success) return { ok: false, issue: parsed.error.message };
    return { ok: true, data: parsed.data };
  }

  // ───── B2C
  async function payB2c(
    args: B2cInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<B2cOutput>> {
    const parsed = B2cInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    if (!credentials.initiatorName || !credentials.securityCredential) {
      return {
        kind: 'unconfigured',
        reason: 'initiatorName + securityCredential required for B2C',
      };
    }
    const phone = normaliseMsisdn(parsed.data.msisdn);
    const body: Record<string, unknown> = {
      InitiatorName: credentials.initiatorName,
      SecurityCredential: credentials.securityCredential,
      CommandID: parsed.data.commandId,
      Amount: parsed.data.amount,
      PartyA: credentials.shortCode,
      PartyB: phone,
      Remarks: parsed.data.remarks,
      QueueTimeOutURL: parsed.data.queueTimeoutUrl,
      ResultURL: parsed.data.resultUrl,
    };
    if (parsed.data.occasion !== undefined) body['Occasion'] = parsed.data.occasion;
    return connector.call<unknown, B2cOutput>({
      path: '/mpesa/b2c/v3/paymentrequest',
      method: 'POST',
      body,
      outputSchema: B2cOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  // ───── Transaction status
  async function queryTransactionStatus(
    args: TransactionStatusInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<TransactionStatusOutput>> {
    const parsed = TransactionStatusInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    if (!credentials.initiatorName || !credentials.securityCredential) {
      return {
        kind: 'unconfigured',
        reason: 'initiatorName + securityCredential required for transaction-status',
      };
    }
    const body: Record<string, unknown> = {
      Initiator: credentials.initiatorName,
      SecurityCredential: credentials.securityCredential,
      CommandID: 'TransactionStatusQuery',
      TransactionID: parsed.data.transactionId,
      PartyA: credentials.shortCode,
      IdentifierType: '4',
      Remarks: parsed.data.remarks,
      QueueTimeOutURL: parsed.data.queueTimeoutUrl,
      ResultURL: parsed.data.resultUrl,
    };
    if (parsed.data.occasion !== undefined) body['Occasion'] = parsed.data.occasion;
    return connector.call<unknown, TransactionStatusOutput>({
      path: '/mpesa/transactionstatus/v1/query',
      method: 'POST',
      body,
      outputSchema: TransactionStatusOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  // ───── Account balance
  async function queryAccountBalance(
    args: AccountBalanceInput,
  ): Promise<ConnectorOutcome<AccountBalanceOutput>> {
    const parsed = AccountBalanceInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    if (!credentials.initiatorName || !credentials.securityCredential) {
      return {
        kind: 'unconfigured',
        reason: 'initiatorName + securityCredential required for account-balance',
      };
    }
    return connector.call<unknown, AccountBalanceOutput>({
      path: '/mpesa/accountbalance/v1/query',
      method: 'POST',
      body: {
        Initiator: credentials.initiatorName,
        SecurityCredential: credentials.securityCredential,
        CommandID: 'AccountBalance',
        PartyA: credentials.shortCode,
        IdentifierType: '4',
        Remarks: parsed.data.remarks,
        QueueTimeOutURL: parsed.data.queueTimeoutUrl,
        ResultURL: parsed.data.resultUrl,
      },
      outputSchema: AccountBalanceOutputSchema,
    });
  }

  return {
    connector,
    env,
    stkPush,
    registerC2bUrl,
    parseC2bCallback,
    payB2c,
    queryTransactionStatus,
    queryAccountBalance,
    tokenExpiryMs: () => (tokenCache.token ? tokenCache.expiresAtMs : null),
  };
}
