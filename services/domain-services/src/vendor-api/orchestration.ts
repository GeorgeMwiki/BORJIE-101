/**
 * Vendor Dispatch Orchestrator — WAVE 28.
 *
 * Given a maintenance ticket:
 *   a. select vendor from marketplace based on capability match + SLA
 *   b. resolve adapter via the registry
 *   c. call scheduleDispatch
 *   d. wait for on-site confirmation (adapter or IoT event)
 *   e. on work complete, request invoice via adapter
 *   f. close ticket
 *
 * The orchestrator intentionally does NOT import from the existing
 * maintenance/vendors/marketplace modules — it defines narrow "Like"
 * shapes so Agent ORCHESTRATE (building in parallel) can wire it up
 * without a circular dependency. The real services are plugged in at
 * composition time by adapting them to these interfaces.
 *
 * Every state transition fires a domain event on the injected bus so the
 * audit-trail captures the full physical-world execution path.
 */

import type {
  AvailabilityWindow,
  DateRange,
  DispatchInput,
  DispatchResult,
  InvoiceResult,
  OnSiteConfirmation,
  VendorAdapterId,
  VendorApiAdapter,
  VendorCapability,
  VendorInvoice,
} from './adapter-contract.js';
import { VendorAdapterError } from './adapter-contract.js';
import type { VendorAdapterRegistry, VendorRecordLike } from './adapter-registry.js';

// ----------------------------------------------------------------------------
// Narrow port types (kept local so we don't depend on the full domain)
// ----------------------------------------------------------------------------

export interface MaintenanceTicketLike {
  readonly id: string;
  readonly tenantId: string;
  readonly description: string;
  readonly locationHint: string;
  readonly priority: 'low' | 'normal' | 'high' | 'emergency';
  readonly requiredCapability: VendorCapability;
  readonly preferredWindowStart: string;
  readonly preferredWindowEnd: string;
}

export interface VendorCandidate {
  readonly vendor: VendorRecordLike;
  readonly slaMinutes: number;
  readonly supportsCapability: (cap: VendorCapability) => boolean;
}

export interface VendorSelector {
  selectVendor(
    ticket: MaintenanceTicketLike,
    candidates: readonly VendorCandidate[],
  ): VendorCandidate | null;
  listCandidates(ticket: MaintenanceTicketLike): Promise<readonly VendorCandidate[]>;
}

export interface DispatchBusEvent {
  readonly eventType:
    | 'VendorDispatchScheduled'
    | 'VendorOnSiteConfirmed'
    | 'VendorWorkCompleted'
    | 'VendorInvoiceReceived'
    | 'VendorDispatchFailed'
    | 'VendorDispatchCompensated';
  readonly ticketId: string;
  readonly tenantId: string;
  readonly adapterId: VendorAdapterId;
  readonly dispatchId: string | null;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
}

export interface DispatchEventBus {
  publish(event: DispatchBusEvent): Promise<void> | void;
}

export interface DispatchRecord {
  readonly ticketId: string;
  readonly tenantId: string;
  readonly vendorId: string;
  readonly adapterId: VendorAdapterId;
  readonly dispatchId: string;
  readonly status:
    | 'scheduled'
    | 'dispatched'
    | 'pending'
    | 'on_site'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly dispatchedAt: string;
  readonly onSiteAt: string | null;
  readonly completedAt: string | null;
  readonly invoice: InvoiceResult | null;
  readonly trackingUrl: string | null;
  readonly failureReason: string | null;
}

export interface DispatchStore {
  save(record: DispatchRecord): void;
  find(dispatchId: string): DispatchRecord | null;
  list(tenantId: string): readonly DispatchRecord[];
}

export function createInMemoryDispatchStore(): DispatchStore {
  const byId = new Map<string, DispatchRecord>();
  return {
    save(record) {
      byId.set(record.dispatchId, record);
    },
    find(dispatchId) {
      return byId.get(dispatchId) ?? null;
    },
    list(tenantId) {
      return Array.from(byId.values()).filter((r) => r.tenantId === tenantId);
    },
  };
}

// ----------------------------------------------------------------------------
// Orchestrator
// ----------------------------------------------------------------------------

export interface VendorDispatchOrchestratorDeps {
  readonly registry: VendorAdapterRegistry;
  readonly vendorSelector: VendorSelector;
  readonly eventBus: DispatchEventBus;
  readonly store: DispatchStore;
  readonly now?: () => Date;
  /** Max time to wait for on-site confirmation before compensating. */
  readonly onSiteTimeoutMs?: number;
}

export interface DispatchOutcome {
  readonly ok: boolean;
  readonly record: DispatchRecord;
  readonly dispatch: DispatchResult | null;
  readonly onSite: OnSiteConfirmation | null;
  readonly invoice: InvoiceResult | null;
  readonly failureReason: string | null;
}

export class VendorDispatchOrchestrator {
  private readonly registry: VendorAdapterRegistry;
  private readonly vendorSelector: VendorSelector;
  private readonly eventBus: DispatchEventBus;
  private readonly store: DispatchStore;
  private readonly now: () => Date;
  private readonly onSiteTimeoutMs: number;

  constructor(deps: VendorDispatchOrchestratorDeps) {
    this.registry = deps.registry;
    this.vendorSelector = deps.vendorSelector;
    this.eventBus = deps.eventBus;
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
    this.onSiteTimeoutMs = deps.onSiteTimeoutMs ?? 30 * 60 * 1000;
  }

  /** Step (a) + (b) + (c): select vendor, resolve adapter, schedule dispatch. */
  async dispatch(ticket: MaintenanceTicketLike): Promise<DispatchOutcome> {
    const candidates = await this.vendorSelector.listCandidates(ticket);
    const selected = this.vendorSelector.selectVendor(ticket, candidates);
    if (!selected) {
      const record: DispatchRecord = {
        ticketId: ticket.id,
        tenantId: ticket.tenantId,
        vendorId: 'none',
        adapterId: this.registry.fallback().id,
        dispatchId: `none_${ticket.id}_${this.now().getTime()}`,
        status: 'failed',
        dispatchedAt: this.now().toISOString(),
        onSiteAt: null,
        completedAt: null,
        invoice: null,
        trackingUrl: null,
        failureReason: 'no vendor candidates matched the ticket capability',
      };
      this.store.save(record);
      await this.emit({
        eventType: 'VendorDispatchFailed',
        ticketId: ticket.id,
        tenantId: ticket.tenantId,
        adapterId: record.adapterId,
        dispatchId: null,
        timestamp: record.dispatchedAt,
        payload: { reason: record.failureReason },
      });
      return {
        ok: false,
        record,
        dispatch: null,
        onSite: null,
        invoice: null,
        failureReason: record.failureReason,
      };
    }

    const adapter = this.registry.resolveForVendor(selected.vendor);
    const input: DispatchInput = {
      workOrderId: ticket.id,
      vendorId: selected.vendor.id,
      tenantId: ticket.tenantId,
      preferredWindowStart: ticket.preferredWindowStart,
      preferredWindowEnd: ticket.preferredWindowEnd,
      description: ticket.description,
      locationHint: ticket.locationHint,
      priority: ticket.priority,
    };

    let dispatch: DispatchResult;
    try {
      dispatch = await adapter.scheduleDispatch(input);
    } catch (error) {
      // Compensate by falling back to manual-queue. This is the single
      // compensation the orchestrator owns; deeper retries are the
      // adapter's responsibility.
      const fallback = this.registry.fallback();
      dispatch = await fallback.scheduleDispatch(input);
      await this.emit({
        eventType: 'VendorDispatchCompensated',
        ticketId: ticket.id,
        tenantId: ticket.tenantId,
        adapterId: fallback.id,
        dispatchId: dispatch.dispatchId,
        timestamp: this.now().toISOString(),
        payload: {
          originalAdapter: adapter.id,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }

    const record: DispatchRecord = {
      ticketId: ticket.id,
      tenantId: ticket.tenantId,
      vendorId: selected.vendor.id,
      adapterId: dispatch.adapterId,
      dispatchId: dispatch.dispatchId,
      status:
        dispatch.status === 'scheduled'
          ? 'scheduled'
          : dispatch.status === 'dispatched'
            ? 'dispatched'
            : 'pending',
      dispatchedAt: dispatch.dispatchedAt,
      onSiteAt: null,
      completedAt: null,
      invoice: null,
      trackingUrl: dispatch.trackingUrl,
      failureReason: null,
    };
    this.store.save(record);

    await this.emit({
      eventType: 'VendorDispatchScheduled',
      ticketId: ticket.id,
      tenantId: ticket.tenantId,
      adapterId: record.adapterId,
      dispatchId: record.dispatchId,
      timestamp: record.dispatchedAt,
      payload: {
        vendorId: selected.vendor.id,
        windowStart: dispatch.scheduledWindowStart,
        windowEnd: dispatch.scheduledWindowEnd,
        note: dispatch.note,
      },
    });

    return {
      ok: true,
      record,
      dispatch,
      onSite: null,
      invoice: null,
      failureReason: null,
    };
  }

  /** Step (d): record on-site confirmation — from adapter callback OR IoT. */
  async recordOnSite(
    dispatchId: string,
    source: 'adapter' | 'iot' = 'adapter',
  ): Promise<OnSiteConfirmation> {
    const record = this.store.find(dispatchId);
    if (!record) {
      throw new VendorAdapterError(`orchestrator: unknown dispatch ${dispatchId}`, {
        adapterId: this.registry.fallback().id,
        retryable: false,
      });
    }
    const adapter = this.registry.resolveById(record.adapterId);

    let confirmation: OnSiteConfirmation;
    if (source === 'iot') {
      confirmation = {
        dispatchId,
        confirmedAt: this.now().toISOString(),
        confirmedBy: 'iot-sensor',
        technicianName: null,
        notes: 'on-site detected via IoT event',
      };
    } else {
      confirmation = await adapter.confirmOnSite(dispatchId);
    }

    const updated: DispatchRecord = {
      ...record,
      status: 'on_site',
      onSiteAt: confirmation.confirmedAt,
    };
    this.store.save(updated);

    await this.emit({
      eventType: 'VendorOnSiteConfirmed',
      ticketId: record.ticketId,
      tenantId: record.tenantId,
      adapterId: record.adapterId,
      dispatchId,
      timestamp: confirmation.confirmedAt,
      payload: { source, technicianName: confirmation.technicianName },
    });

    return confirmation;
  }

  /** Step (e) + (f): record invoice and close the ticket. */
  async completeWork(
    dispatchId: string,
    invoice: VendorInvoice,
  ): Promise<InvoiceResult> {
    const record = this.store.find(dispatchId);
    if (!record) {
      throw new VendorAdapterError(`orchestrator: unknown dispatch ${dispatchId}`, {
        adapterId: this.registry.fallback().id,
        retryable: false,
      });
    }
    const adapter = this.registry.resolveById(record.adapterId);
    const result = await adapter.submitInvoice(dispatchId, invoice);

    const completedAt = this.now().toISOString();
    const updated: DispatchRecord = {
      ...record,
      status: 'completed',
      completedAt,
      invoice: result,
    };
    this.store.save(updated);

    await this.emit({
      eventType: 'VendorWorkCompleted',
      ticketId: record.ticketId,
      tenantId: record.tenantId,
      adapterId: record.adapterId,
      dispatchId,
      timestamp: completedAt,
      payload: { amountMinorUnits: result.amountMinorUnits, currency: result.currency },
    });
    await this.emit({
      eventType: 'VendorInvoiceReceived',
      ticketId: record.ticketId,
      tenantId: record.tenantId,
      adapterId: record.adapterId,
      dispatchId,
      timestamp: completedAt,
      payload: { invoiceId: result.invoiceId, status: result.status },
    });

    return result;
  }

  /**
   * Detect no-show — a dispatch scheduled longer ago than the configured
   * on-site timeout with no confirmation yet. Used by a background
   * supervisor to compensate (reassign + alert).
   */
  findTimedOutDispatches(tenantId: string): readonly DispatchRecord[] {
    const cutoff = this.now().getTime() - this.onSiteTimeoutMs;
    return this.store.list(tenantId).filter((r) => {
      if (r.onSiteAt) return false;
      if (r.status !== 'scheduled' && r.status !== 'dispatched' && r.status !== 'pending') {
        return false;
      }
      return new Date(r.dispatchedAt).getTime() < cutoff;
    });
  }

  /** Mark a dispatch as failed (e.g. after timeout compensation). */
  async markFailed(dispatchId: string, reason: string): Promise<DispatchRecord> {
    const record = this.store.find(dispatchId);
    if (!record) {
      throw new VendorAdapterError(`orchestrator: unknown dispatch ${dispatchId}`, {
        adapterId: this.registry.fallback().id,
        retryable: false,
      });
    }
    const updated: DispatchRecord = {
      ...record,
      status: 'failed',
      failureReason: reason,
    };
    this.store.save(updated);
    await this.emit({
      eventType: 'VendorDispatchFailed',
      ticketId: record.ticketId,
      tenantId: record.tenantId,
      adapterId: record.adapterId,
      dispatchId,
      timestamp: this.now().toISOString(),
      payload: { reason },
    });
    return updated;
  }

  async queryAvailability(
    vendorId: string,
    adapterId: VendorAdapterId,
    dateRange: DateRange,
  ): Promise<AvailabilityWindow[]> {
    const adapter: VendorApiAdapter = this.registry.resolveById(adapterId);
    return adapter.getAvailability(vendorId, dateRange);
  }

  getRecord(dispatchId: string): DispatchRecord | null {
    return this.store.find(dispatchId);
  }

  private async emit(event: DispatchBusEvent): Promise<void> {
    try {
      await this.eventBus.publish(event);
    } catch (error) {
      // Never let an event failure tear down the orchestration call.
      // Observability handles DLQ retries.
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`vendor-dispatch: event publish failed (${event.eventType}): ${message}`);
    }
  }
}
