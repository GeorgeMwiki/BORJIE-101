/**
 * ClickPesa PSP adapter for Tanzania. Presents the same interface as the
 * direct GePG provider but uses ClickPesa's REST API, which transparently
 * brokers GePG control numbers on merchants' behalf.
 *
 * Reference: https://docs.clickpesa.com
 *
 * Zero external deps — uses Node's built-in fetch.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ClickPesaConfig {
  readonly apiKey: string;
  readonly baseUrl: string; // e.g. 'https://api.clickpesa.com/v1' or sandbox URL
  readonly webhookSecret: string;
  readonly merchantId: string;
}

export interface ClickPesaPaymentRequest {
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly currency: 'TZS';
  readonly payerPhone: string;
  readonly description?: string;
}

export interface ClickPesaPaymentResponse {
  readonly controlNumber: string;
  readonly gepgBillReference: string;
  readonly expiresAt: string; // ISO
  readonly status: 'issued' | 'paid' | 'failed';
  readonly provider: 'clickpesa';
}

export interface ClickPesaWebhookPayload {
  readonly controlNumber: string;
  readonly status: 'paid' | 'failed' | 'expired';
  readonly paidAt?: string;
  readonly amountMinor: number;
  readonly rawSignature: string;
  readonly rawBody: string;
}

export class ClickPesaError extends Error {
  constructor(
    readonly code: 'AUTH_FAILED' | 'BAD_REQUEST' | 'UPSTREAM' | 'SIGNATURE_INVALID',
    message: string
  ) {
    super(message);
    this.name = 'ClickPesaError';
  }
}

export class ClickPesaProvider {
  constructor(private readonly config: ClickPesaConfig) {}

  async requestPayment(
    req: ClickPesaPaymentRequest
  ): Promise<ClickPesaPaymentResponse> {
    const res = await fetch(`${this.config.baseUrl}/payments/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        orderReference: req.invoiceId,
        amount: req.amountMinor / 100,
        currency: req.currency,
        customer: { phone: req.payerPhone },
        description: req.description ?? `Invoice ${req.invoiceId}`,
      }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new ClickPesaError('AUTH_FAILED', 'ClickPesa rejected credentials');
    }
    if (res.status >= 400 && res.status < 500) {
      const body = await res.text();
      throw new ClickPesaError('BAD_REQUEST', `ClickPesa 4xx: ${body}`);
    }
    if (!res.ok) {
      throw new ClickPesaError('UPSTREAM', `ClickPesa ${res.status}`);
    }

    const body = (await res.json()) as {
      controlNumber: string;
      billReference: string;
      expiresAt: string;
      status: string;
    };
    return {
      controlNumber: body.controlNumber,
      gepgBillReference: body.billReference,
      expiresAt: body.expiresAt,
      status: body.status as 'issued' | 'paid' | 'failed',
      provider: 'clickpesa',
    };
  }

  async queryStatus(controlNumber: string): Promise<ClickPesaPaymentResponse> {
    const res = await fetch(
      `${this.config.baseUrl}/payments/${encodeURIComponent(controlNumber)}`,
      {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      }
    );
    if (!res.ok) {
      throw new ClickPesaError('UPSTREAM', `ClickPesa query failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      controlNumber: string;
      billReference: string;
      expiresAt: string;
      status: string;
    };
    return {
      controlNumber: body.controlNumber,
      gepgBillReference: body.billReference,
      expiresAt: body.expiresAt,
      status: body.status as 'issued' | 'paid' | 'failed',
      provider: 'clickpesa',
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(rawBody, 'utf-8')
      .digest('hex');
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(signature, 'hex');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async handleWebhook(payload: ClickPesaWebhookPayload): Promise<{
    accepted: boolean;
    reason?: string;
  }> {
    const ok = this.verifyWebhookSignature(payload.rawBody, payload.rawSignature);
    if (!ok) return { accepted: false, reason: 'invalid_signature' };
    return { accepted: true };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      return {
        healthy: res.ok,
        latencyMs: Date.now() - start,
        error: res.ok ? undefined : `status ${res.status}`,
      };
    } catch (err) {
      return { healthy: false, error: (err as Error).message };
    }
  }
}
