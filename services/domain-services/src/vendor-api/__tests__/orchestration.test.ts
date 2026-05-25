import { describe, it, expect } from 'vitest';
import {
  VendorDispatchOrchestrator,
  createInMemoryDispatchStore,
  type DispatchBusEvent,
  type DispatchEventBus,
  type MaintenanceTicketLike,
  type VendorCandidate,
  type VendorSelector,
} from '../orchestration.js';
import { createVendorAdapterRegistry } from '../adapter-registry.js';
import {
  ManualQueueAdapter,
  createInMemoryManualQueueStore,
} from '../adapters/manual-queue-adapter.js';
import { ServiceChannelAdapter } from '../adapters/service-channel-adapter.js';
import type { VendorApiAdapter, VendorCapability } from '../adapter-contract.js';
import { makeFakeFetch, fixedClock } from './test-helpers.js';

const ticket: MaintenanceTicketLike = {
  id: 'wo_orch_1',
  tenantId: 'tnt_1',
  description: 'Broken gate motor',
  locationHint: 'Main gate',
  priority: 'high',
  requiredCapability: 'scheduling',
  preferredWindowStart: '2026-05-05T09:00:00Z',
  preferredWindowEnd: '2026-05-05T11:00:00Z',
};

function recordingBus(): DispatchEventBus & { events: DispatchBusEvent[] } {
  const events: DispatchBusEvent[] = [];
  return {
    events,
    async publish(event) {
      events.push(event);
    },
  };
}

function makeCandidate(
  id: string,
  integrationId: string,
  capabilities: readonly VendorCapability[] = ['scheduling'],
): VendorCandidate {
  return {
    vendor: { id, integrationId },
    slaMinutes: 60,
    supportsCapability: (cap) => capabilities.includes(cap),
  };
}

function makeSelector(candidates: readonly VendorCandidate[]): VendorSelector {
  return {
    async listCandidates() {
      return candidates;
    },
    selectVendor(_t, list) {
      return list[0] ?? null;
    },
  };
}

describe('VendorDispatchOrchestrator', () => {
  it('end-to-end happy path: schedule -> on-site -> invoice -> completed', async () => {
    const fakeFetch = makeFakeFetch({
      '/v3/workorders': { body: { id: 'sc_99' } },
      '/checkin': {
        body: { checkedInAt: '2026-05-05T10:00:00Z', technicianName: 'Asha' },
      },
      '/invoice': { body: { invoiceId: 'sc_inv_99', status: 'received' } },
    });
    const sc = new ServiceChannelAdapter({
      apiKey: 'k',
      baseUrl: 'https://sc.example',
      fetchImpl: fakeFetch,
    });
    const fallback = new ManualQueueAdapter({
      store: createInMemoryManualQueueStore(),
    });
    const registry = createVendorAdapterRegistry({ adapters: [sc, fallback], fallback });
    const bus = recordingBus();
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([makeCandidate('v1', 'servicechannel')]),
      eventBus: bus,
      store: createInMemoryDispatchStore(),
      now: fixedClock('2026-05-05T08:00:00Z'),
    });

    const outcome = await orch.dispatch(ticket);
    expect(outcome.ok).toBe(true);
    expect(outcome.record.status).toBe('scheduled');
    expect(outcome.record.adapterId).toBe('servicechannel');

    const confirmation = await orch.recordOnSite(outcome.record.dispatchId);
    expect(confirmation.technicianName).toBe('Asha');

    const invoiceResult = await orch.completeWork(outcome.record.dispatchId, {
      invoiceNumber: 'INV-99',
      amountMinorUnits: 100_00,
      currency: 'TZS',
      lineItems: [{ description: 'Motor swap', amountMinorUnits: 100_00 }],
      issuedAt: '2026-05-05T11:30:00Z',
    });
    expect(invoiceResult.status).toBe('received');

    const eventTypes = bus.events.map((e) => e.eventType);
    expect(eventTypes).toEqual([
      'VendorDispatchScheduled',
      'VendorOnSiteConfirmed',
      'VendorWorkCompleted',
      'VendorInvoiceReceived',
    ]);
  });

  it('compensates to manual-queue when primary adapter throws', async () => {
    // ServiceChannel returns 500 -> orchestrator falls back to manual-queue.
    const fakeFetch = makeFakeFetch({
      '/v3/workorders': { status: 500, statusText: 'Down' },
    });
    const sc = new ServiceChannelAdapter({
      apiKey: 'k',
      baseUrl: 'https://sc.example',
      fetchImpl: fakeFetch,
    });
    const fallback = new ManualQueueAdapter({
      store: createInMemoryManualQueueStore(),
    });
    const registry = createVendorAdapterRegistry({ adapters: [sc, fallback], fallback });
    const bus = recordingBus();
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([makeCandidate('v1', 'servicechannel')]),
      eventBus: bus,
      store: createInMemoryDispatchStore(),
    });
    const outcome = await orch.dispatch(ticket);
    expect(outcome.ok).toBe(true);
    expect(outcome.record.adapterId).toBe('manual-queue');
    expect(bus.events.find((e) => e.eventType === 'VendorDispatchCompensated')).toBeTruthy();
  });

  it('accepts IoT-sourced on-site confirmations', async () => {
    const fallback = new ManualQueueAdapter({
      store: createInMemoryManualQueueStore(),
    });
    const registry = createVendorAdapterRegistry({ adapters: [fallback], fallback });
    const bus = recordingBus();
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([makeCandidate('v1', 'manual-queue')]),
      eventBus: bus,
      store: createInMemoryDispatchStore(),
      now: fixedClock('2026-05-05T09:00:00Z'),
    });
    const outcome = await orch.dispatch(ticket);
    const confirmation = await orch.recordOnSite(outcome.record.dispatchId, 'iot');
    expect(confirmation.confirmedBy).toBe('iot-sensor');
    expect(
      bus.events.find(
        (e) => e.eventType === 'VendorOnSiteConfirmed' && e.payload.source === 'iot',
      ),
    ).toBeTruthy();
  });

  it('returns failure outcome when no vendor candidates available', async () => {
    const fallback = new ManualQueueAdapter({
      store: createInMemoryManualQueueStore(),
    });
    const registry = createVendorAdapterRegistry({ adapters: [fallback], fallback });
    const bus = recordingBus();
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([]),
      eventBus: bus,
      store: createInMemoryDispatchStore(),
    });
    const outcome = await orch.dispatch(ticket);
    expect(outcome.ok).toBe(false);
    expect(outcome.record.status).toBe('failed');
    expect(bus.events[0].eventType).toBe('VendorDispatchFailed');
  });

  // Wave-12: previously skipped (wave-3 C6 / wave-4 D1) because the
  // assertion expected an item in the timed-out array but received [].
  // Root cause: `ManualQueueAdapter` accepts a `now` config but the test
  // didn't wire it — adapter used real `new Date()` while orchestrator
  // used the mock clock, so the adapter's `enqueuedAt` ended up well
  // past any test cutoff. Fixed by sharing the mock clock with both.
  it('detects timed-out dispatches awaiting on-site confirmation', async () => {
    const now = { value: new Date('2026-05-05T09:00:00Z') };
    const fallback = new ManualQueueAdapter({
      store: createInMemoryManualQueueStore(),
      now: () => now.value,
    });
    const registry = createVendorAdapterRegistry({ adapters: [fallback], fallback });
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([makeCandidate('v1', 'manual-queue')]),
      eventBus: recordingBus(),
      store: createInMemoryDispatchStore(),
      now: () => now.value,
      onSiteTimeoutMs: 30 * 60 * 1000,
    });
    const outcome = await orch.dispatch(ticket);
    // Advance the clock past the timeout.
    now.value = new Date('2026-05-05T10:00:00Z');
    const timedOut = orch.findTimedOutDispatches(ticket.tenantId);
    expect(timedOut.map((t) => t.dispatchId)).toContain(outcome.record.dispatchId);

    const failed = await orch.markFailed(
      outcome.record.dispatchId,
      'no-show after 30 minutes',
    );
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toMatch(/no-show/);
  });

  it('queryAvailability routes through the correct adapter', async () => {
    const fakeFetch = makeFakeFetch({
      '/availability': { body: { windows: [{ start: 'a', end: 'b', capacity: 2 }] } },
    });
    const sc = new ServiceChannelAdapter({
      apiKey: 'k',
      baseUrl: 'https://sc.example',
      fetchImpl: fakeFetch,
    });
    const fallback = new ManualQueueAdapter({
      store: createInMemoryManualQueueStore(),
    });
    const registry = createVendorAdapterRegistry({ adapters: [sc, fallback], fallback });
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([]),
      eventBus: recordingBus(),
      store: createInMemoryDispatchStore(),
    });
    const windows = await orch.queryAvailability('v1', 'servicechannel', {
      start: '2026-05-05T00:00:00Z',
      end: '2026-05-06T00:00:00Z',
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].capacityUnits).toBe(2);
  });

  it('store round-trips a DispatchRecord', async () => {
    const store = createInMemoryDispatchStore();
    const fallback = new ManualQueueAdapter({ store: createInMemoryManualQueueStore() });
    const registry = createVendorAdapterRegistry({ adapters: [fallback], fallback });
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([makeCandidate('v1', 'manual-queue')]),
      eventBus: recordingBus(),
      store,
    });
    const outcome = await orch.dispatch(ticket);
    const retrieved = orch.getRecord(outcome.record.dispatchId);
    expect(retrieved?.ticketId).toBe(ticket.id);
  });

  it('swallows bus publish failures without throwing', async () => {
    const flakyBus: DispatchEventBus = {
      async publish() {
        throw new Error('bus down');
      },
    };
    const fallback = new ManualQueueAdapter({ store: createInMemoryManualQueueStore() });
    const registry = createVendorAdapterRegistry({ adapters: [fallback], fallback });
    const orch = new VendorDispatchOrchestrator({
      registry,
      vendorSelector: makeSelector([makeCandidate('v1', 'manual-queue')]),
      eventBus: flakyBus,
      store: createInMemoryDispatchStore(),
    });
    // Should not throw even though the bus does.
    const outcome = await orch.dispatch(ticket);
    expect(outcome.ok).toBe(true);
  });

  it('unknown adapter on registry resolves to fallback when health-checked', async () => {
    const fallback = new ManualQueueAdapter({
      store: createInMemoryManualQueueStore(),
    });
    const registry = createVendorAdapterRegistry({ adapters: [fallback], fallback });
    const adapter: VendorApiAdapter = registry.resolveById('nonexistent');
    expect(adapter.id).toBe('manual-queue');
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });
});
