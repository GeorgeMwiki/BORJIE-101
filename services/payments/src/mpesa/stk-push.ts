import axios, { AxiosInstance } from 'axios';

function resolveMpesaEnvironment(
  override: 'sandbox' | 'production' | undefined,
): 'sandbox' | 'production' {
  if (override === 'sandbox' || override === 'production') return override;
  const fromEnv = process.env.MPESA_ENVIRONMENT?.trim().toLowerCase();
  if (fromEnv === 'sandbox' || fromEnv === 'production') return fromEnv;
  throw new Error(
    'MPESA_ENVIRONMENT must be set to "sandbox" or "production" — no silent default',
  );
}

export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  callbackUrl: string;
  environment: 'sandbox' | 'production';
}

export interface StkPushRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc?: string;
}

export interface StkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface StkQueryRequest {
  checkoutRequestId: string;
}

export interface StkQueryResponse {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
}

const SANDBOX_URL = 'https://sandbox.safaricom.co.ke';
const PRODUCTION_URL = 'https://api.safaricom.co.ke';

export class MpesaStkPush {
  private config: MpesaConfig;
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config?: Partial<MpesaConfig>) {
    this.config = {
      consumerKey: config?.consumerKey || process.env.MPESA_CONSUMER_KEY || '',
      consumerSecret: config?.consumerSecret || process.env.MPESA_CONSUMER_SECRET || '',
      passkey: config?.passkey || process.env.MPESA_PASSKEY || '',
      shortcode: config?.shortcode || process.env.MPESA_SHORTCODE || '',
      callbackUrl: config?.callbackUrl || process.env.MPESA_CALLBACK_URL || '',
      environment: resolveMpesaEnvironment(config?.environment),
    };

    const baseURL = this.config.environment === 'production' ? PRODUCTION_URL : SANDBOX_URL;

    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get OAuth access token from M-Pesa
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');

    const response = await this.client.get('/oauth/v1/generate?grant_type=client_credentials', {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    this.accessToken = response.data.access_token;
    // Token expires in 1 hour, but we refresh 5 minutes early
    this.tokenExpiry = Date.now() + 55 * 60 * 1000;

    return this.accessToken!;
  }

  /**
   * Generate password for STK push
   */
  private generatePassword(): { password: string; timestamp: string } {
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14);

    const password = Buffer.from(`${this.config.shortcode}${this.config.passkey}${timestamp}`).toString('base64');

    return { password, timestamp };
  }

  /**
   * Format phone number to M-Pesa format (254XXXXXXXXX)
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');

    // Handle different formats
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.slice(1);
    } else if (cleaned.startsWith('+254')) {
      cleaned = cleaned.slice(1);
    } else if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }

    return cleaned;
  }

  /**
   * Initiate STK Push payment request
   */
  async initiateStkPush(request: StkPushRequest): Promise<StkPushResponse> {
    const accessToken = await this.getAccessToken();
    const { password, timestamp } = this.generatePassword();
    const phoneNumber = this.formatPhoneNumber(request.phoneNumber);

    const payload = {
      BusinessShortCode: this.config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(request.amount),
      PartyA: phoneNumber,
      PartyB: this.config.shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: this.config.callbackUrl,
      AccountReference: request.accountReference.slice(0, 12), // Max 12 chars
      TransactionDesc: request.transactionDesc?.slice(0, 13) || 'Payment', // Max 13 chars
    };

    const response = await this.client.post<StkPushResponse>('/mpesa/stkpush/v1/processrequest', payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.data;
  }

  /**
   * Query STK Push transaction status
   */
  async queryStkPushStatus(request: StkQueryRequest): Promise<StkQueryResponse> {
    const accessToken = await this.getAccessToken();
    const { password, timestamp } = this.generatePassword();

    const payload = {
      BusinessShortCode: this.config.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: request.checkoutRequestId,
    };

    const response = await this.client.post<StkQueryResponse>('/mpesa/stkpushquery/v1/query', payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.data;
  }

  /**
   * Initiate payment for rent
   */
  async initiateRentPayment(
    phoneNumber: string,
    amount: number,
    invoiceId: string,
    propertyName?: string
  ): Promise<StkPushResponse> {
    return this.initiateStkPush({
      phoneNumber,
      amount,
      accountReference: invoiceId,
      transactionDesc: propertyName ? `Rent-${propertyName}`.slice(0, 13) : 'RentPayment',
    });
  }

  /**
   * Check if STK Push was successful based on result code
   */
  isSuccessful(resultCode: string): boolean {
    return resultCode === '0';
  }

  /**
   * Get human-readable error message for result code
   */
  getResultMessage(resultCode: string): string {
    const messages: Record<string, string> = {
      '0': 'Transaction successful',
      '1': 'Insufficient balance / insufficient funds',
      '1032': 'Transaction cancelled by user',
      '1037': 'Timeout waiting for user input',
      '2001': 'Wrong PIN entered',
    };

    return messages[resultCode] || `Unknown error (code: ${resultCode})`;
  }
}

/**
 * Lazy singleton accessor. We avoid module-load-time instantiation
 * because `new MpesaStkPush()` now requires MPESA_ENVIRONMENT to be set
 * — pre-existing tests that just import the package would otherwise
 * crash at load. Callers use `getMpesaStkPush()` and the client is
 * built on first use.
 */
let _instance: MpesaStkPush | null = null;
export function getMpesaStkPush(): MpesaStkPush {
  if (!_instance) {
    _instance = new MpesaStkPush();
  }
  return _instance;
}

/**
 * @deprecated Use `getMpesaStkPush()` — direct access required eager
 * instantiation at module load, which is unsafe when MPESA_ENVIRONMENT
 * is not yet set (CLI, tests). Kept as a getter-backed export for
 * backwards compatibility.
 */
export const mpesaStkPush = new Proxy({} as MpesaStkPush, {
  get(_target, prop) {
    return (getMpesaStkPush() as unknown as Record<string | symbol, unknown>)[
      prop as string
    ];
  },
});
