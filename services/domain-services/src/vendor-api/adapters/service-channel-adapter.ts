/**
 * ServiceChannel adapter — WAVE 28.
 *
 * ServiceChannel is a real-world vendor dispatch platform (ServiceChannel
 * Inc., facilities-management SaaS). Their REST API uses Bearer-token
 * auth and resource URLs like:
 *   POST /v3/workorders
 *   GET  /v3/workorders/{id}
 *   POST /v3/workorders/{id}/checkin
 *   POST /v3/workorders/{id}/invoice
 *   GET  /v3/providers/{id}/availability?from=...&to=...
 *
 * We model the *shape* here; real network calls stay behind an injected
 * `fetch` so tests run without external side effects. When the API key is
 * absent the adapter degrades gracefully to a pending DispatchResult and
 * emits a note telling the orchestrator to fall back to manual-queue.
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

export interface ServiceChannelAdapterConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
  readonly now?: () => Date;
}

const CAPABILITIES: readonly VendorCapability[] = [
  'scheduling',
  'on-site-confirmation',
  'invoice-submission',
  'availability-query',
];

export class ServiceChannelAdapter implements VendorApiAdapter {
  readonly id = 'servicechannel' as const;
  readonly capabilities = CAPABILITIES;

  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(config: ServiceChannelAdapterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl;
    this.now = config.now ?? (() => new Date());
  }

  async scheduleDispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!this.apiKey) {
      return {
        adapterId: this.id,
        dispatchId: `sc_pending_${input.workOrderId}`,
        status: 'pending',
        scheduledWindowStart: null,
        scheduledWindowEnd: null,
        dispatchedAt: this.now().toISOString(),
        trackingUrl: null,
        note: 'ServiceChannel API key absent — orchestrator should fall back to manual-queue',
      };
    }

    const response = await this.request('POST', '/v3/workorders', {
      externalId: input.workOrderId,
      providerId: input.vendorId,
      tenantReference: input.tenantId,
      window: { start: input.preferredWindowStart, end: input.preferredWindowEnd },
      summary: input.description,
      location: input.locationHint,
      priority: input.priority,
      metadata: input.metadata ?? {},
    });

    const body = response as {
      id?: string;
      scheduledStart?: string;
      scheduledEnd?: string;
      trackingUrl?: string;
    };
    if (!body.id) {
      throw new VendorAdapterError('ServiceChannel: missing dispatch id in response', {
        adapterId: this.id,
        retryable: true,
      });
    }

    return {
      adapterId: this.id,
      dispatchId: body.id,
      status: 'scheduled',
      scheduledWindowStart: body.scheduledStart ?? input.preferredWindowStart,
      scheduledWindowEnd: body.scheduledEnd ?? input.preferredWindowEnd,
      dispatchedAt: this.now().toISOString(),
      trackingUrl: body.trackingUrl ?? null,
      note: null,
    };
  }

  async confirmOnSite(dispatchId: string): Promise<OnSiteConfirmation> {
    if (!this.apiKey) {
      throw new VendorAdapterError('ServiceChannel: API key required for confirmOnSite', {
        adapterId: this.id,
        retryable: false,
      });
    }
    const response = await this.request(
      'POST',
      `/v3/workorders/${encodeURIComponent(dispatchId)}/checkin`,
      {},
    );
    const body = response as {
      checkedInAt?: string;
      technicianName?: string;
      notes?: string;
    };
    return {
      dispatchId,
      confirmedAt: body.checkedInAt ?? this.now().toISOString(),
      confirmedBy: 'vendor-api',
      technicianName: body.technicianName ?? null,
      notes: body.notes ?? null,
    };
  }

  async submitInvoice(dispatchId: string, invoice: VendorInvoice): Promise<InvoiceResult> {
    if (!this.apiKey) {
      throw new VendorAdapterError('ServiceChannel: API key required for submitInvoice', {
        adapterId: this.id,
        retryable: false,
      });
    }
    const response = await this.request(
      'POST',
      `/v3/workorders/${encodeURIComponent(dispatchId)}/invoice`,
      {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amountMinorUnits,
        currency: invoice.currency,
        lineItems: invoice.lineItems,
        issuedAt: invoice.issuedAt,
      },
    );
    const body = response as { invoiceId?: string; status?: string };
    return {
      dispatchId,
      invoiceId: body.invoiceId ?? `sc_inv_${dispatchId}`,
      status: body.status === 'pending' || body.status === 'rejected' ? body.status : 'received',
      amountMinorUnits: invoice.amountMinorUnits,
      currency: invoice.currency,
      receivedAt: this.now().toISOString(),
    };
  }

  async getAvailability(vendorId: string, dateRange: DateRange): Promise<AvailabilityWindow[]> {
    if (!this.apiKey) return [];
    const qs = new URLSearchParams({ from: dateRange.start, to: dateRange.end }).toString();
    const response = await this.request(
      'GET',
      `/v3/providers/${encodeURIComponent(vendorId)}/availability?${qs}`,
    );
    const body = response as {
      windows?: readonly {
        start: string;
        end: string;
        technicianId?: string;
        capacity?: number;
      }[];
    };
    return (body.windows ?? []).map((w) => ({
      start: w.start,
      end: w.end,
      technicianId: w.technicianId ?? null,
      capacityUnits: w.capacity ?? 1,
    }));
  }

  async healthCheck(): Promise<HealthStatus> {
    const startedAt = Date.now();
    if (!this.apiKey) {
      return {
        adapterId: this.id,
        healthy: false,
        latencyMs: 0,
        checkedAt: this.now().toISOString(),
        message: 'API key not configured',
      };
    }
    try {
      await this.request('GET', '/v3/health');
      return {
        adapterId: this.id,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        checkedAt: this.now().toISOString(),
        message: null,
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

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new VendorAdapterError(
        `ServiceChannel ${method} ${path} failed: ${response.status} ${response.statusText}`,
        { adapterId: this.id, retryable: response.status >= 500 },
      );
    }
    return response.json();
  }
}
