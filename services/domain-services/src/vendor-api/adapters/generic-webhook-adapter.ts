/**
 * Generic-webhook adapter — WAVE 28.
 *
 * For vendors that don't expose a full REST API but DO accept an inbound
 * POST webhook (and let us subscribe to callbacks). We POST the dispatch
 * payload to the configured webhook URL and persist callback tokens so
 * the orchestrator's callback router can later mark on-site / completion
 * transitions.
 *
 * Callbacks are NOT handled by this adapter directly — the webhook
 * receiver (in the api-gateway) validates the signature then calls into
 * the orchestrator. This adapter only exposes the outbound half.
 */

import type {
  AvailabilityWindow,
  DateRange,
  DispatchInput,
  DispatchResult,
  FetchLike,
  HealthStatus,
  InvoiceResult,
  OnSiteConfirmation,
  VendorApiAdapter,
  VendorCapability,
  VendorInvoice,
} from '../adapter-contract.js';
import { VendorAdapterError } from '../adapter-contract.js';

export interface GenericWebhookAdapterConfig {
  readonly webhookUrl: string;
  readonly signingSecret: string | null;
  readonly fetchImpl: FetchLike;
  readonly callbackUrlPrefix: string;
  readonly now?: () => Date;
  readonly randomToken?: () => string;
}

const CAPABILITIES: readonly VendorCapability[] = [
  'scheduling',
  'invoice-submission',
];

export class GenericWebhookAdapter implements VendorApiAdapter {
  readonly id = 'generic-webhook' as const;
  readonly capabilities = CAPABILITIES;

  private readonly webhookUrl: string;
  private readonly signingSecret: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly callbackUrlPrefix: string;
  private readonly now: () => Date;
  private readonly randomToken: () => string;

  /**
   * In-memory callback registry. Real implementations persist to the DB;
   * for WAVE 28 scaffolding we hold it in-process so the orchestrator can
   * resolve on-site confirmations from an inbound webhook callback.
   */
  private readonly callbackTokens = new Map<string, OnSiteConfirmation | null>();

  constructor(config: GenericWebhookAdapterConfig) {
    this.webhookUrl = config.webhookUrl;
    this.signingSecret = config.signingSecret;
    this.fetchImpl = config.fetchImpl;
    this.callbackUrlPrefix = config.callbackUrlPrefix.replace(/\/$/, '');
    this.now = config.now ?? (() => new Date());
    this.randomToken =
      config.randomToken ??
      (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  async scheduleDispatch(input: DispatchInput): Promise<DispatchResult> {
    const token = this.randomToken();
    const dispatchId = `wh_${input.workOrderId}_${token}`;
    const callbackUrl = `${this.callbackUrlPrefix}/callback/${encodeURIComponent(token)}`;

    const payload = {
      dispatchId,
      workOrderId: input.workOrderId,
      vendorId: input.vendorId,
      tenantId: input.tenantId,
      window: { start: input.preferredWindowStart, end: input.preferredWindowEnd },
      description: input.description,
      location: input.locationHint,
      priority: input.priority,
      metadata: input.metadata ?? {},
      callbackUrl,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Bossnyumba-Dispatch-Id': dispatchId,
    };
    if (this.signingSecret) {
      headers['X-Bossnyumba-Signature'] = await signPayload(payload, this.signingSecret);
    }

    const response = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new VendorAdapterError(
        `Generic webhook POST failed: ${response.status} ${response.statusText}`,
        { adapterId: this.id, retryable: response.status >= 500 },
      );
    }

    this.callbackTokens.set(token, null);

    return {
      adapterId: this.id,
      dispatchId,
      status: 'dispatched',
      scheduledWindowStart: input.preferredWindowStart,
      scheduledWindowEnd: input.preferredWindowEnd,
      dispatchedAt: this.now().toISOString(),
      trackingUrl: callbackUrl,
      note: null,
    };
  }

  /**
   * Resolve on-site confirmation by looking up a previously-recorded
   * callback event. If the vendor never called us back we throw a
   * retryable error so the orchestrator waits and retries.
   */
  async confirmOnSite(dispatchId: string): Promise<OnSiteConfirmation> {
    const token = extractTokenFromDispatchId(dispatchId);
    const stored = this.callbackTokens.get(token);
    if (!stored) {
      throw new VendorAdapterError(
        `Generic webhook: no callback received yet for ${dispatchId}`,
        { adapterId: this.id, retryable: true },
      );
    }
    return stored;
  }

  /** Called by the webhook receiver when the vendor POSTs back to our callback URL. */
  recordCallback(token: string, confirmation: OnSiteConfirmation): void {
    this.callbackTokens.set(token, confirmation);
  }

  async submitInvoice(dispatchId: string, invoice: VendorInvoice): Promise<InvoiceResult> {
    return {
      dispatchId,
      invoiceId: `wh_inv_${invoice.invoiceNumber}`,
      status: 'received',
      amountMinorUnits: invoice.amountMinorUnits,
      currency: invoice.currency,
      receivedAt: this.now().toISOString(),
    };
  }

  async getAvailability(
    _vendorId: string,
    _dateRange: DateRange,
  ): Promise<AvailabilityWindow[]> {
    // Generic webhook vendors don't expose queryable availability.
    return [];
  }

  async healthCheck(): Promise<HealthStatus> {
    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(this.webhookUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      return {
        adapterId: this.id,
        healthy: response.ok,
        latencyMs: Date.now() - startedAt,
        checkedAt: this.now().toISOString(),
        message: response.ok ? null : `Webhook responded ${response.status}`,
      };
    } catch (error) {
      return {
        adapterId: this.id,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        checkedAt: this.now().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function extractTokenFromDispatchId(dispatchId: string): string {
  const parts = dispatchId.split('_');
  return parts[parts.length - 1] ?? dispatchId;
}

async function signPayload(payload: unknown, secret: string): Promise<string> {
  // Lightweight HMAC-SHA256 using Node's crypto (domain-services already
  // runs on Node). Kept inline to avoid a cross-package import.
  const { createHmac } = await import('node:crypto');
  const serialized = JSON.stringify(payload);
  return createHmac('sha256', secret).update(serialized).digest('hex');
}
