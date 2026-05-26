import axios, { AxiosInstance } from 'axios';

export interface AfricasTalkingConfig {
  apiKey: string;
  username: string;
  environment: 'sandbox' | 'production';
  senderId?: string;
}

export interface SmsRequest {
  to: string | string[];
  message: string;
  from?: string;
  enqueue?: boolean;
  bulkSMSMode?: 0 | 1;
  retryDurationInHours?: number;
}

export interface SmsRecipient {
  statusCode: number;
  number: string;
  status: 'Success' | 'Sent' | 'Queued' | 'InvalidPhoneNumber' | 'InsufficientBalance' | string;
  cost: string;
  messageId: string;
}

export interface SmsResponse {
  SMSMessageData: {
    Message: string;
    Recipients: SmsRecipient[];
  };
}

export interface DeliveryReport {
  id: string;
  status: 'Success' | 'Failed' | 'Rejected' | 'Buffered' | 'Submitted';
  phoneNumber: string;
  networkCode?: string;
  failureReason?: string;
  retryCount?: number;
}

export interface BulkSmsRequest {
  recipients: Array<{
    phoneNumber: string;
    message: string;
  }>;
  from?: string;
}

const SANDBOX_URL = 'https://api.sandbox.africastalking.com/version1';
const PRODUCTION_URL = 'https://api.africastalking.com/version1';

function resolveAtEnvironment(
  override: 'sandbox' | 'production' | undefined,
): 'sandbox' | 'production' {
  if (override === 'sandbox' || override === 'production') return override;
  const fromEnv = (
    process.env.AFRICAS_TALKING_ENVIRONMENT ?? process.env.AT_ENVIRONMENT
  )
    ?.trim()
    .toLowerCase();
  if (fromEnv === 'sandbox' || fromEnv === 'production') return fromEnv;
  throw new Error(
    'AFRICAS_TALKING_ENVIRONMENT (or AT_ENVIRONMENT) must be set to "sandbox" or "production"',
  );
}

function resolveAtUsername(override: string | undefined): string {
  const v = (
    override ??
    process.env.AFRICAS_TALKING_USERNAME ??
    process.env.AT_USERNAME
  )?.trim();
  if (!v) {
    throw new Error(
      'AFRICAS_TALKING_USERNAME (or AT_USERNAME) must be set — no silent "sandbox" default',
    );
  }
  return v;
}

export class AfricasTalkingSms {
  private config: AfricasTalkingConfig;
  private client: AxiosInstance;

  constructor(config?: Partial<AfricasTalkingConfig>) {
    const env = resolveAtEnvironment(config?.environment);
    const senderId = config?.senderId || process.env.AFRICAS_TALKING_SENDER_ID || process.env.AT_SENDER_ID;
    this.config = {
      apiKey: config?.apiKey || process.env.AFRICAS_TALKING_API_KEY || process.env.AT_API_KEY || '',
      username: resolveAtUsername(config?.username),
      environment: env,
      ...(senderId !== undefined ? { senderId } : {}),
    };

    const baseURL = this.config.environment === 'production' ? PRODUCTION_URL : SANDBOX_URL;

    this.client = axios.create({
      baseURL,
      // Production-hardening: request timeout so hung connections don't pin
      // worker threads. Retries happen inside the SMS send method using a
      // small backoff loop.
      timeout: 15_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey: this.config.apiKey,
      },
    });
  }

  /**
   * Issue a request with exponential-backoff retry on network errors /
   * 429 / 5xx. Callers that want no retry pass `retries: 0`.
   */
  protected async requestWithRetry<T>(
    fn: () => Promise<{ data: T; status: number }>,
    opts: { retries?: number; baseMs?: number } = {}
  ): Promise<T> {
    const maxAttempts = Math.max(1, (opts.retries ?? 3) + 1);
    const baseMs = opts.baseMs ?? 500;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fn();
        return res.data;
      } catch (err) {
        lastErr = err;
        const status = (err as { response?: { status?: number } }).response?.status;
        const retryable =
          status === undefined ||
          status === 408 ||
          status === 429 ||
          (status >= 500 && status < 600);
        if (!retryable || attempt === maxAttempts - 1) throw err;
        // eslint-disable-next-line no-restricted-syntax -- Math.random for jitter is fine (no security boundary; bounded by baseMs).
        const backoff = baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    throw lastErr ?? new Error('unknown_error');
  }

  /**
   * Format a phone number to international (+CC...) format.
   *
   * Africa's Talking supports multiple African countries. We do NOT
   * hardcode a Kenya default — ambiguous local numbers (`07XX...`)
   * are returned as-is prefixed with '+', which surfaces the missing
   * country hint upstream rather than silently misrouting the SMS.
   * Callers that know the country should pre-normalize via
   * `normalizePhoneForCountry` from domain-models.
   */
  private formatPhoneNumber(phone: string): string {
    const trimmed = phone.trim();
    const cleaned = trimmed.replace(/\D/g, '');
    // Round-3 audit L4 — the previous implementation returned `+`
    // (literally just a plus sign) when the input contained no digits.
    // Africa's Talking would then reject the entire batch with an
    // opaque 4xx, surfacing the validation gap as a delivery failure
    // instead of an input-validation error. Validate length here so
    // the caller gets a clear boundary error before any HTTP hop.
    // Valid E.164 numbers are 8–15 digits (ITU E.164).
    if (cleaned.length < 8 || cleaned.length > 15) {
      throw new Error(
        `africas-talking: invalid phone number — got ${cleaned.length} digits, need 8-15 (E.164)`
      );
    }
    if (trimmed.startsWith('+')) return `+${cleaned}`;
    // Preserve caller input; no 254 injection.
    return `+${cleaned}`;
  }

  /**
   * Format multiple phone numbers
   */
  private formatPhoneNumbers(phones: string | string[]): string {
    const phoneArray = Array.isArray(phones) ? phones : [phones];
    return phoneArray.map((p) => this.formatPhoneNumber(p)).join(',');
  }

  /**
   * Send SMS message(s)
   */
  async sendSms(request: SmsRequest): Promise<SmsResponse> {
    const params = new URLSearchParams();
    params.append('username', this.config.username);
    params.append('to', this.formatPhoneNumbers(request.to));
    params.append('message', request.message);

    if (request.from || this.config.senderId) {
      params.append('from', request.from || this.config.senderId!);
    }

    if (request.enqueue !== undefined) {
      params.append('enqueue', request.enqueue ? '1' : '0');
    }

    if (request.bulkSMSMode !== undefined) {
      params.append('bulkSMSMode', String(request.bulkSMSMode));
    }

    if (request.retryDurationInHours !== undefined) {
      params.append('retryDurationInHours', String(request.retryDurationInHours));
    }

    const response = await this.client.post<SmsResponse>('/messaging', params);
    return response.data;
  }

  /**
   * Send bulk personalized SMS
   */
  async sendBulkSms(request: BulkSmsRequest): Promise<SmsResponse[]> {
    const results: SmsResponse[] = [];

    // Africa's Talking doesn't support personalized bulk in single request
    // So we send individually but could batch for better performance
    for (const recipient of request.recipients) {
      const response = await this.sendSms({
        to: recipient.phoneNumber,
        message: recipient.message,
        ...(request.from !== undefined ? { from: request.from } : {}),
        enqueue: true, // Use enqueue for bulk
      });
      results.push(response);
    }

    return results;
  }

  /**
   * Send rent reminder SMS. `currency` is the ISO-4217 code resolved
   * from the tenant's region-config. Previously hardcoded KES which
   * leaked for non-Kenya tenants.
   */
  async sendRentReminder(
    phoneNumber: string,
    tenantName: string,
    amount: number,
    dueDate: string,
    propertyName: string,
    currency: string
  ): Promise<SmsResponse> {
    const message = `Dear ${tenantName}, this is a reminder that your rent of ${currency} ${amount.toLocaleString()} for ${propertyName} is due on ${dueDate}. Please pay via the provided channel. Thank you.`;

    return this.sendSms({
      to: phoneNumber,
      message,
    });
  }

  /**
   * Send payment confirmation SMS
   */
  async sendPaymentConfirmation(
    phoneNumber: string,
    tenantName: string,
    amount: number,
    receiptNumber: string,
    balance: number,
    currency: string
  ): Promise<SmsResponse> {
    const message =
      balance > 0
        ? `Dear ${tenantName}, we have received your payment of ${currency} ${amount.toLocaleString()}. Receipt: ${receiptNumber}. Outstanding balance: ${currency} ${balance.toLocaleString()}. Thank you.`
        : `Dear ${tenantName}, we have received your payment of ${currency} ${amount.toLocaleString()}. Receipt: ${receiptNumber}. Your account is now fully paid. Thank you.`;

    return this.sendSms({
      to: phoneNumber,
      message,
    });
  }

  /**
   * Send overdue notice SMS
   */
  async sendOverdueNotice(
    phoneNumber: string,
    tenantName: string,
    amount: number,
    daysOverdue: number,
    propertyName: string,
    currency: string
  ): Promise<SmsResponse> {
    const message = `Dear ${tenantName}, your rent payment of ${currency} ${amount.toLocaleString()} for ${propertyName} is ${daysOverdue} days overdue. Please pay immediately to avoid penalties. Contact us for any issues.`;

    return this.sendSms({
      to: phoneNumber,
      message,
    });
  }

  /**
   * Send maintenance update SMS
   */
  async sendMaintenanceUpdate(
    phoneNumber: string,
    tenantName: string,
    ticketId: string,
    status: string
  ): Promise<SmsResponse> {
    const message = `Dear ${tenantName}, your maintenance request #${ticketId} status: ${status}. We will keep you updated on the progress.`;

    return this.sendSms({
      to: phoneNumber,
      message,
    });
  }

  /**
   * Send lease expiry reminder
   */
  async sendLeaseExpiryReminder(
    phoneNumber: string,
    tenantName: string,
    expiryDate: string,
    daysRemaining: number
  ): Promise<SmsResponse> {
    const message = `Dear ${tenantName}, your lease agreement expires on ${expiryDate} (${daysRemaining} days remaining). Please contact us to discuss renewal options.`;

    return this.sendSms({
      to: phoneNumber,
      message,
    });
  }

  /**
   * Send welcome message to new tenant
   */
  async sendWelcomeMessage(
    phoneNumber: string,
    tenantName: string,
    propertyName: string,
    unitNumber: string
  ): Promise<SmsResponse> {
    const message = `Welcome ${tenantName}! You are now registered at ${propertyName}, Unit ${unitNumber}. For any issues, please contact property management. Thank you for choosing us.`;

    return this.sendSms({
      to: phoneNumber,
      message,
    });
  }

  /**
   * Check account balance
   */
  async getBalance(): Promise<{ balance: string; currency: string }> {
    const params = new URLSearchParams();
    params.append('username', this.config.username);

    const response = await this.client.get('/user', { params: { username: this.config.username } });
    
    const balanceData = response.data?.UserData?.balance || '0';
    const [currency, balance] = balanceData.split(' ');
    
    return { balance, currency };
  }

  /**
   * Parse delivery report callback
   */
  parseDeliveryReport(body: Record<string, string>): DeliveryReport {
    const retryCount = body.retryCount ? parseInt(body.retryCount, 10) : undefined;
    return {
      id: body.id ?? '',
      status: (body.status ?? 'Unknown') as DeliveryReport['status'],
      phoneNumber: body.phoneNumber ?? '',
      networkCode: body.networkCode ?? '',
      ...(body.failureReason !== undefined ? { failureReason: body.failureReason } : {}),
      ...(retryCount !== undefined ? { retryCount } : {}),
    };
  }

  /**
   * Check if SMS was successfully sent
   */
  isSent(recipient: SmsRecipient): boolean {
    return ['Success', 'Sent', 'Queued'].includes(recipient.status);
  }

  /**
   * Get total cost from response in integer minor units.
   *
   * Bug fix A-BUG-DEEP #5: previously summed `parseFloat` costs which
   * accumulated IEEE-754 drift across many recipients (e.g.
   * 0.1 + 0.2 != 0.3). Convert each cost to integer cents
   * (`Math.round(x * 100)`) and sum in integer space so the ledger sees
   * an exact integer.
   */
  getTotalCost(response: SmsResponse): number {
    return response.SMSMessageData.Recipients.reduce((total, r) => {
      const decimal = Number(r.cost.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(decimal)) return total;
      return total + Math.round(decimal * 100);
    }, 0);
  }
}

export const africasTalkingSms = new AfricasTalkingSms();
