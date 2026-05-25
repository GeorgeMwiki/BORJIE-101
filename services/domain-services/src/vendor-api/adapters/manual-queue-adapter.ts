/**
 * Manual-queue adapter — WAVE 28.
 *
 * Fallback for vendors with zero API. We enqueue a task on the manual
 * outreach queue (call/email/SMS); a human operator reviews the entry in
 * the manual-queue UI and flips the state by calling
 * `recordManualConfirmation`. The orchestrator can then advance the
 * ticket exactly as it would for a fully-automated dispatch.
 *
 * State is held in-memory so the package has zero DB dependency for the
 * scaffolding — the composition root is responsible for swapping in a
 * Postgres-backed store when the table is ready.
 */

import type {
  AvailabilityWindow,
  DateRange,
  DispatchInput,
  DispatchResult,
  HealthStatus,
  InvoiceResult,
  OnSiteConfirmation,
  VendorApiAdapter,
  VendorCapability,
  VendorInvoice,
} from '../adapter-contract.js';
import { VendorAdapterError } from '../adapter-contract.js';

export interface ManualQueueEntry {
  readonly dispatchId: string;
  readonly workOrderId: string;
  readonly vendorId: string;
  readonly tenantId: string;
  readonly description: string;
  readonly priority: DispatchInput['priority'];
  readonly enqueuedAt: string;
  readonly status: 'queued' | 'accepted' | 'on_site' | 'completed' | 'cancelled';
  readonly confirmation: OnSiteConfirmation | null;
}

export interface ManualQueueStore {
  readonly list: () => readonly ManualQueueEntry[];
  readonly enqueue: (entry: ManualQueueEntry) => void;
  readonly update: (dispatchId: string, patch: Partial<ManualQueueEntry>) => void;
  readonly find: (dispatchId: string) => ManualQueueEntry | null;
}

export function createInMemoryManualQueueStore(): ManualQueueStore {
  const byId = new Map<string, ManualQueueEntry>();
  return {
    list() {
      return Array.from(byId.values());
    },
    enqueue(entry) {
      byId.set(entry.dispatchId, entry);
    },
    update(dispatchId, patch) {
      const curr = byId.get(dispatchId);
      if (!curr) return;
      byId.set(dispatchId, { ...curr, ...patch });
    },
    find(dispatchId) {
      return byId.get(dispatchId) ?? null;
    },
  };
}

export interface ManualQueueAdapterConfig {
  readonly store: ManualQueueStore;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

const CAPABILITIES: readonly VendorCapability[] = ['scheduling', 'on-site-confirmation'];

export class ManualQueueAdapter implements VendorApiAdapter {
  readonly id = 'manual-queue' as const;
  readonly capabilities = CAPABILITIES;

  private readonly store: ManualQueueStore;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(config: ManualQueueAdapterConfig) {
    this.store = config.store;
    this.now = config.now ?? (() => new Date());
    this.randomId =
      config.randomId ??
      (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  async scheduleDispatch(input: DispatchInput): Promise<DispatchResult> {
    const dispatchId = `mq_${input.workOrderId}_${this.randomId()}`;
    const enqueuedAt = this.now().toISOString();
    this.store.enqueue({
      dispatchId,
      workOrderId: input.workOrderId,
      vendorId: input.vendorId,
      tenantId: input.tenantId,
      description: input.description,
      priority: input.priority,
      enqueuedAt,
      status: 'queued',
      confirmation: null,
    });
    return {
      adapterId: this.id,
      dispatchId,
      status: 'pending',
      scheduledWindowStart: null,
      scheduledWindowEnd: null,
      dispatchedAt: enqueuedAt,
      trackingUrl: null,
      note: 'Queued for manual outreach — awaiting human confirmation',
    };
  }

  async confirmOnSite(dispatchId: string): Promise<OnSiteConfirmation> {
    const entry = this.store.find(dispatchId);
    if (!entry) {
      throw new VendorAdapterError(`manual-queue: dispatch ${dispatchId} not found`, {
        adapterId: this.id,
        retryable: false,
      });
    }
    if (!entry.confirmation) {
      throw new VendorAdapterError(
        `manual-queue: awaiting human confirmation for ${dispatchId}`,
        { adapterId: this.id, retryable: true },
      );
    }
    return entry.confirmation;
  }

  /** Called from the manual-queue UI when an operator records on-site arrival. */
  recordManualConfirmation(
    dispatchId: string,
    confirmation: Omit<OnSiteConfirmation, 'dispatchId' | 'confirmedBy'>,
  ): OnSiteConfirmation {
    const entry = this.store.find(dispatchId);
    if (!entry) {
      throw new VendorAdapterError(`manual-queue: dispatch ${dispatchId} not found`, {
        adapterId: this.id,
        retryable: false,
      });
    }
    const full: OnSiteConfirmation = {
      dispatchId,
      confirmedAt: confirmation.confirmedAt,
      confirmedBy: 'manual',
      technicianName: confirmation.technicianName,
      notes: confirmation.notes,
    };
    this.store.update(dispatchId, { status: 'on_site', confirmation: full });
    return full;
  }

  async submitInvoice(dispatchId: string, invoice: VendorInvoice): Promise<InvoiceResult> {
    const entry = this.store.find(dispatchId);
    if (!entry) {
      throw new VendorAdapterError(`manual-queue: dispatch ${dispatchId} not found`, {
        adapterId: this.id,
        retryable: false,
      });
    }
    this.store.update(dispatchId, { status: 'completed' });
    return {
      dispatchId,
      invoiceId: `mq_inv_${invoice.invoiceNumber}`,
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
    return [];
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      adapterId: this.id,
      healthy: true,
      latencyMs: 0,
      checkedAt: this.now().toISOString(),
      message: 'manual-queue always healthy (in-process fallback)',
    };
  }

  /** Read-only view of pending queue entries — used by the manual-queue UI. */
  listPending(): readonly ManualQueueEntry[] {
    return this.store.list().filter((e) => e.status === 'queued');
  }
}
