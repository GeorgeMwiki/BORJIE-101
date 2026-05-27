/**
 * M-Pesa Daraja client (real + mock).
 *
 * Wave PAY-1 / Pilot-pre: payment adapters must work end-to-end without
 * real Safaricom credentials. The unified `IMpesaClient` describes the
 * full Daraja STK-push + B2C surface our adapter needs. Two backends
 * implement it:
 *
 *   - {@link LiveMpesaClient}     – calls api.safaricom.co.ke /
 *     sandbox.safaricom.co.ke when `MPESA_LIVE_KEYS_PRESENT === 'true'`.
 *   - {@link MockMpesaClient}     – default. Deterministic responses,
 *     queues async webhook callbacks via a small in-process delivery
 *     queue so integration tests can exercise the full request →
 *     callback → ledger path without network.
 *
 * Swap by env var only — no callsite changes required. The factory
 * {@link createMpesaClient} returns the correct instance.
 *
 * SECURITY NOTES
 *   - No secrets in source. Reads `MPESA_CONSUMER_KEY` etc only inside
 *     {@link LiveMpesaClient}.
 *   - All errors thrown are operational (Error with explicit message).
 *     No silent fallback to mock when live mode is requested.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { logger } from '../../logger.js';

// ---------------------------------------------------------------------------
// Public surface (request/response shapes mirroring Daraja)
// ---------------------------------------------------------------------------

export interface StkPushRequest {
  readonly businessShortCode: string;
  readonly amount: number;
  readonly phoneNumber: string;
  readonly accountReference: string;
  readonly transactionDesc: string;
  readonly callbackUrl: string;
}

export interface StkPushResponse {
  readonly merchantRequestId: string;
  readonly checkoutRequestId: string;
  readonly responseCode: string;
  readonly responseDescription: string;
  readonly customerMessage: string;
}

export interface StkQueryResponse {
  readonly resultCode: string;
  readonly resultDesc: string;
  readonly merchantRequestId: string;
  readonly checkoutRequestId: string;
}

export interface B2CRequest {
  readonly amount: number;
  readonly partyA: string;
  readonly partyB: string;
  readonly remarks: string;
  readonly resultUrl: string;
  readonly queueTimeOutUrl: string;
}

export interface B2CResponse {
  readonly conversationId: string;
  readonly originatorConversationId: string;
  readonly responseCode: string;
  readonly responseDescription: string;
}

/**
 * Daraja callback shape (subset). Live mode receives this via webhook
 * POST; mock mode generates it from the in-process delivery queue.
 */
export interface StkCallbackPayload {
  readonly Body: {
    readonly stkCallback: {
      readonly MerchantRequestID: string;
      readonly CheckoutRequestID: string;
      readonly ResultCode: number;
      readonly ResultDesc: string;
      readonly CallbackMetadata?: {
        readonly Item: ReadonlyArray<{ readonly Name: string; readonly Value?: string | number }>;
      };
    };
  };
}

export interface IMpesaClient {
  readonly mode: 'live' | 'mock';
  stkPush(req: StkPushRequest): Promise<StkPushResponse>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResponse>;
  b2c(req: B2CRequest): Promise<B2CResponse>;
}

// ---------------------------------------------------------------------------
// Live client (real Daraja API)
// ---------------------------------------------------------------------------

export interface LiveMpesaConfig {
  readonly consumerKey: string;
  readonly consumerSecret: string;
  readonly shortCode: string;
  readonly passKey: string;
  readonly environment: 'sandbox' | 'production';
}

function nowTimestamp(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
}

function generateStkPassword(shortCode: string, passKey: string, timestamp: string): string {
  return Buffer.from(`${shortCode}${passKey}${timestamp}`).toString('base64');
}

export class LiveMpesaClient implements IMpesaClient {
  readonly mode = 'live' as const;

  private readonly config: LiveMpesaConfig;
  private readonly baseUrl: string;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(config: LiveMpesaConfig) {
    this.config = config;
    this.baseUrl =
      config.environment === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.value;
    }
    const auth = Buffer.from(
      `${this.config.consumerKey}:${this.config.consumerSecret}`,
    ).toString('base64');
    const response = await fetch(
      `${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      { method: 'GET', headers: { Authorization: `Basic ${auth}` } },
    );
    if (!response.ok) {
      throw new Error(`M-Pesa auth failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { access_token: string; expires_in: string };
    const expiresInRaw = parseInt(String(data.expires_in), 10);
    const expiresInSec =
      Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : 3600;
    this.cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + expiresInSec * 1000 - 60_000,
    };
    return this.cachedToken.value;
  }

  async stkPush(req: StkPushRequest): Promise<StkPushResponse> {
    const token = await this.getAccessToken();
    const timestamp = nowTimestamp();
    const password = generateStkPassword(this.config.shortCode, this.config.passKey, timestamp);
    const body = {
      BusinessShortCode: req.businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(req.amount),
      PartyA: req.phoneNumber,
      PartyB: req.businessShortCode,
      PhoneNumber: req.phoneNumber,
      CallBackURL: req.callbackUrl,
      AccountReference: req.accountReference,
      TransactionDesc: req.transactionDesc,
    };
    const response = await fetch(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
      CustomerMessage?: string;
      errorMessage?: string;
    };
    if (!response.ok || data.ResponseCode !== '0') {
      throw new Error(
        `M-Pesa STK push failed: ${data.errorMessage ?? data.ResponseDescription ?? response.statusText}`,
      );
    }
    return {
      merchantRequestId: data.MerchantRequestID!,
      checkoutRequestId: data.CheckoutRequestID!,
      responseCode: data.ResponseCode!,
      responseDescription: data.ResponseDescription ?? '',
      customerMessage: data.CustomerMessage ?? '',
    };
  }

  async stkQuery(checkoutRequestId: string): Promise<StkQueryResponse> {
    const token = await this.getAccessToken();
    const timestamp = nowTimestamp();
    const password = generateStkPassword(this.config.shortCode, this.config.passKey, timestamp);
    const response = await fetch(`${this.baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: this.config.shortCode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });
    const data = (await response.json()) as {
      ResultCode?: string;
      ResultDesc?: string;
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
    };
    return {
      resultCode: data.ResultCode ?? 'UNKNOWN',
      resultDesc: data.ResultDesc ?? '',
      merchantRequestId: data.MerchantRequestID ?? '',
      checkoutRequestId: data.CheckoutRequestID ?? checkoutRequestId,
    };
  }

  async b2c(req: B2CRequest): Promise<B2CResponse> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}/mpesa/b2c/v1/paymentrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        InitiatorName: 'BORJIE',
        CommandID: 'BusinessPayment',
        Amount: Math.round(req.amount),
        PartyA: req.partyA,
        PartyB: req.partyB,
        Remarks: req.remarks,
        QueueTimeOutURL: req.queueTimeOutUrl,
        ResultURL: req.resultUrl,
      }),
    });
    const data = (await response.json()) as {
      ConversationID?: string;
      OriginatorConversationID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
    };
    if (!response.ok || data.ResponseCode !== '0') {
      throw new Error(`M-Pesa B2C failed: ${data.ResponseDescription ?? response.statusText}`);
    }
    return {
      conversationId: data.ConversationID!,
      originatorConversationId: data.OriginatorConversationID ?? '',
      responseCode: data.ResponseCode!,
      responseDescription: data.ResponseDescription ?? '',
    };
  }
}

// ---------------------------------------------------------------------------
// Mock client (in-process, deterministic)
// ---------------------------------------------------------------------------

export interface MockMpesaScenario {
  /** Forces the STK callback ResultCode. Default: 0 (success). */
  readonly forceResultCode?: number;
  /** ResultDesc for the forced callback. */
  readonly forceResultDesc?: string;
}

export interface MockMpesaClientOptions {
  /** Per-phone scenario override. Lookup by full E.164 phone. */
  readonly scenarios?: Readonly<Record<string, MockMpesaScenario>>;
}

/**
 * Queued webhook delivery. The mock client enqueues a callback after
 * every successful STK push; tests pull from the queue via
 * {@link MockMpesaClient.drainCallbacks} and feed them through the
 * webhook handler exactly as Daraja would.
 */
export interface QueuedMpesaCallback {
  readonly callbackUrl: string;
  readonly payload: StkCallbackPayload;
}

export class MockMpesaClient implements IMpesaClient {
  readonly mode = 'mock' as const;

  private readonly options: MockMpesaClientOptions;
  private readonly callbacks: QueuedMpesaCallback[] = [];
  private readonly checkoutStatus: Map<string, { resultCode: number; resultDesc: string }> =
    new Map();

  constructor(options: MockMpesaClientOptions = {}) {
    this.options = options;
  }

  async stkPush(req: StkPushRequest): Promise<StkPushResponse> {
    const merchantRequestId = `merc-${randomUUID()}`;
    const checkoutRequestId = `ws_CO_${randomUUID()}`;
    const scenario = this.options.scenarios?.[req.phoneNumber] ?? {};
    const resultCode = scenario.forceResultCode ?? 0;
    const resultDesc =
      scenario.forceResultDesc ??
      (resultCode === 0
        ? 'The service request is processed successfully.'
        : 'The balance is insufficient for the transaction.');
    this.checkoutStatus.set(checkoutRequestId, { resultCode, resultDesc });
    this.callbacks.push({
      callbackUrl: req.callbackUrl,
      payload: {
        Body: {
          stkCallback: {
            MerchantRequestID: merchantRequestId,
            CheckoutRequestID: checkoutRequestId,
            ResultCode: resultCode,
            ResultDesc: resultDesc,
            CallbackMetadata:
              resultCode === 0
                ? {
                    Item: [
                      { Name: 'Amount', Value: Math.round(req.amount) },
                      { Name: 'MpesaReceiptNumber', Value: `MOCK${randomUUID().slice(0, 8).toUpperCase()}` },
                      { Name: 'TransactionDate', Value: Number(nowTimestamp()) },
                      { Name: 'PhoneNumber', Value: req.phoneNumber },
                    ],
                  }
                : undefined,
          },
        },
      },
    });
    logger.info('mock mpesa stk-push enqueued callback', {
      checkoutRequestId,
      resultCode,
      phone: req.phoneNumber,
    });
    return {
      merchantRequestId,
      checkoutRequestId,
      responseCode: '0',
      responseDescription: 'Success. Request accepted for processing',
      customerMessage: 'Success. Request accepted for processing',
    };
  }

  async stkQuery(checkoutRequestId: string): Promise<StkQueryResponse> {
    const status = this.checkoutStatus.get(checkoutRequestId);
    if (!status) {
      return {
        resultCode: '404',
        resultDesc: 'Request not found',
        merchantRequestId: '',
        checkoutRequestId,
      };
    }
    return {
      resultCode: String(status.resultCode),
      resultDesc: status.resultDesc,
      merchantRequestId: '',
      checkoutRequestId,
    };
  }

  async b2c(req: B2CRequest): Promise<B2CResponse> {
    return {
      conversationId: `AG_${randomUUID()}`,
      originatorConversationId: `${randomUUID()}-${req.partyB}`,
      responseCode: '0',
      responseDescription: 'Accept the service request successfully.',
    };
  }

  /**
   * Drain the in-process delivery queue. Tests call this and feed each
   * entry through the webhook handler exactly like Daraja would.
   */
  drainCallbacks(): readonly QueuedMpesaCallback[] {
    const drained = [...this.callbacks];
    this.callbacks.length = 0;
    return drained;
  }

  /** Test helper — number of queued callbacks waiting for delivery. */
  pendingCallbackCount(): number {
    return this.callbacks.length;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Live-mode toggle. `MPESA_LIVE_KEYS_PRESENT === 'true'` switches to the
 * real Daraja client. ANY other value (including missing) returns the
 * mock — explicit opt-in only.
 */
export function isMpesaLiveMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MPESA_LIVE_KEYS_PRESENT === 'true';
}

export interface CreateMpesaClientOptions {
  readonly mockScenarios?: Readonly<Record<string, MockMpesaScenario>>;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Build the right M-Pesa client for the current environment. Tests can
 * pass `env` to override.
 */
export function createMpesaClient(
  options: CreateMpesaClientOptions = {},
): IMpesaClient {
  const env = options.env ?? process.env;
  if (!isMpesaLiveMode(env)) {
    return new MockMpesaClient({ scenarios: options.mockScenarios });
  }
  const config = readLiveConfig(env);
  return new LiveMpesaClient(config);
}

function readLiveConfig(env: NodeJS.ProcessEnv): LiveMpesaConfig {
  const consumerKey = env.MPESA_CONSUMER_KEY?.trim();
  const consumerSecret = env.MPESA_CONSUMER_SECRET?.trim();
  const shortCode = env.MPESA_SHORT_CODE?.trim();
  const passKey = env.MPESA_PASS_KEY?.trim();
  const environment = (env.MPESA_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production';
  if (!consumerKey || !consumerSecret || !shortCode || !passKey) {
    throw new Error(
      'MPESA_LIVE_KEYS_PRESENT=true but one of MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET / MPESA_SHORT_CODE / MPESA_PASS_KEY is missing.',
    );
  }
  return { consumerKey, consumerSecret, shortCode, passKey, environment };
}
