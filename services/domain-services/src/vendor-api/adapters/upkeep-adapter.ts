/**
 * UpKeep adapter — WAVE 28.
 *
 * UpKeep is a real CMMS (computerized-maintenance-management system) —
 * their REST v2 API uses a Bearer token and resource paths like:
 *   POST /api/v2/work-orders
 *   GET  /api/v2/work-orders/{id}
 *   POST /api/v2/work-orders/{id}/check-in
 *   POST /api/v2/work-orders/{id}/invoices
 *   GET  /api/v2/vendors/{id}/availability
 *
 * Same injected-fetch pattern as ServiceChannel so tests are hermetic.
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

export interface UpKeepAdapterConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly fetchImpl: FetchLike;
  readonly now?: () => Date;
}

const CAPABILITIES: readonly VendorCapability[] = [
  'scheduling',
  'on-site-confirmation',
  'invoice-submission',
];

export class UpKeepAdapter implements VendorApiAdapter {
  readonly id = 'upkeep' as const;
  readonly capabilities = CAPABILITIES;

  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(config: UpKeepAdapterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl;
    this.now = config.now ?? (() => new Date());
  }

  async scheduleDispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!this.apiKey) {
      return {
        adapterId: this.id,
        dispatchId: `upk_pending_${input.workOrderId}`,
        status: 'pending',
        scheduledWindowStart: null,
        scheduledWindowEnd: null,
        dispatchedAt: this.now().toISOString(),
        trackingUrl: null,
        note: 'UpKeep API key absent — orchestrator should fall back to manual-queue',
      };
    }

    const response = await this.request('POST', '/api/v2/work-orders', {
      title: `WO-${input.workOrderId}`,
      description: input.description,
      vendorId: input.vendorId,
      scheduledStartAt: input.preferredWindowStart,
      scheduledEndAt: input.preferredWindowEnd,
      priority: mapPriority(input.priority),
      locationNote: input.locationHint,
      externalId: input.workOrderId,
      meta: input.metadata ?? {},
    });

    const body = response as {
      id?: string | number;
      scheduledStartAt?: string;
      scheduledEndAt?: string;
      publicUrl?: string;
    };
    if (body.id === undefined || body.id === null) {
      throw new VendorAdapterError('UpKeep: missing work order id in response', {
        adapterId: this.id,
        retryable: true,
      });
    }

    return {
      adapterId: this.id,
      dispatchId: String(body.id),
      status: 'scheduled',
      scheduledWindowStart: body.scheduledStartAt ?? input.preferredWindowStart,
      scheduledWindowEnd: body.scheduledEndAt ?? input.preferredWindowEnd,
      dispatchedAt: this.now().toISOString(),
      trackingUrl: body.publicUrl ?? null,
      note: null,
    };
  }

  async confirmOnSite(dispatchId: string): Promise<OnSiteConfirmation> {
    if (!this.apiKey) {
      throw new VendorAdapterError('UpKeep: API key required for confirmOnSite', {
        adapterId: this.id,
        retryable: false,
      });
    }
    const response = await this.request(
      'POST',
      `/api/v2/work-orders/${encodeURIComponent(dispatchId)}/check-in`,
      {},
    );
    const body = response as {
      checkedInAt?: string;
      technician?: { name?: string };
      note?: string;
    };
    return {
      dispatchId,
      confirmedAt: body.checkedInAt ?? this.now().toISOString(),
      confirmedBy: 'vendor-api',
      technicianName: body.technician?.name ?? null,
      notes: body.note ?? null,
    };
  }

  async submitInvoice(dispatchId: string, invoice: VendorInvoice): Promise<InvoiceResult> {
    if (!this.apiKey) {
      throw new VendorAdapterError('UpKeep: API key required for submitInvoice', {
        adapterId: this.id,
        retryable: false,
      });
    }
    const response = await this.request(
      'POST',
      `/api/v2/work-orders/${encodeURIComponent(dispatchId)}/invoices`,
      {
        number: invoice.invoiceNumber,
        total: invoice.amountMinorUnits,
        currency: invoice.currency,
        lineItems: invoice.lineItems.map((l) => ({
          description: l.description,
          amount: l.amountMinorUnits,
        })),
        issuedAt: invoice.issuedAt,
      },
    );
    const body = response as { id?: string | number; state?: string };
    const statusStr = body.state;
    const normalizedStatus: 'received' | 'pending' | 'rejected' =
      statusStr === 'pending' || statusStr === 'rejected' ? statusStr : 'received';
    return {
      dispatchId,
      invoiceId: body.id === undefined ? `upk_inv_${dispatchId}` : String(body.id),
      status: normalizedStatus,
      amountMinorUnits: invoice.amountMinorUnits,
      currency: invoice.currency,
      receivedAt: this.now().toISOString(),
    };
  }

  async getAvailability(vendorId: string, dateRange: DateRange): Promise<AvailabilityWindow[]> {
    if (!this.apiKey) return [];
    const qs = new URLSearchParams({
      from: dateRange.start,
      to: dateRange.end,
    }).toString();
    const response = await this.request(
      'GET',
      `/api/v2/vendors/${encodeURIComponent(vendorId)}/availability?${qs}`,
    );
    const body = response as {
      slots?: readonly { start: string; end: string; userId?: string }[];
    };
    return (body.slots ?? []).map((w) => ({
      start: w.start,
      end: w.end,
      technicianId: w.userId ?? null,
      capacityUnits: 1,
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
      await this.request('GET', '/api/v2/ping');
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
        `UpKeep ${method} ${path} failed: ${response.status} ${response.statusText}`,
        { adapterId: this.id, retryable: response.status >= 500 },
      );
    }
    return response.json();
  }
}

function mapPriority(priority: DispatchInput['priority']): 'low' | 'medium' | 'high' | 'urgent' {
  switch (priority) {
    case 'emergency':
      return 'urgent';
    case 'high':
      return 'high';
    case 'low':
      return 'low';
    default:
      return 'medium';
  }
}
