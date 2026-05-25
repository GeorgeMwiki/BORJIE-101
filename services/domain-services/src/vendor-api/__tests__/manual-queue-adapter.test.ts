import { describe, it, expect } from 'vitest';
import {
  ManualQueueAdapter,
  createInMemoryManualQueueStore,
} from '../adapters/manual-queue-adapter.js';
import { VendorAdapterError } from '../adapter-contract.js';
import { fixedClock } from './test-helpers.js';

const INPUT = {
  workOrderId: 'wo_mq_1',
  vendorId: 'ven_fundi',
  tenantId: 'tnt_1',
  preferredWindowStart: '2026-05-04T08:00:00Z',
  preferredWindowEnd: '2026-05-04T10:00:00Z',
  description: 'Repaint fence',
  locationHint: 'Perimeter',
  priority: 'low' as const,
};

describe('ManualQueueAdapter', () => {
  it('enqueues a pending dispatch when scheduled', async () => {
    const store = createInMemoryManualQueueStore();
    const adapter = new ManualQueueAdapter({
      store,
      now: fixedClock('2026-05-03T10:00:00Z'),
      randomId: () => 'r1',
    });
    const result = await adapter.scheduleDispatch(INPUT);
    expect(result.status).toBe('pending');
    expect(result.note).toMatch(/manual outreach/);
    const pending = adapter.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].dispatchId).toBe(result.dispatchId);
  });

  it('confirmOnSite throws retryable before manual confirmation recorded', async () => {
    const store = createInMemoryManualQueueStore();
    const adapter = new ManualQueueAdapter({ store, randomId: () => 'r2' });
    const dispatch = await adapter.scheduleDispatch(INPUT);
    let caught: unknown = null;
    try {
      await adapter.confirmOnSite(dispatch.dispatchId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VendorAdapterError);
    expect((caught as VendorAdapterError).retryable).toBe(true);
  });

  it('recordManualConfirmation lets confirmOnSite succeed', async () => {
    const store = createInMemoryManualQueueStore();
    const adapter = new ManualQueueAdapter({ store, randomId: () => 'r3' });
    const dispatch = await adapter.scheduleDispatch(INPUT);
    adapter.recordManualConfirmation(dispatch.dispatchId, {
      confirmedAt: '2026-05-04T09:00:00Z',
      technicianName: 'Fundi Amani',
      notes: 'arrived on time',
    });
    const confirmation = await adapter.confirmOnSite(dispatch.dispatchId);
    expect(confirmation.confirmedBy).toBe('manual');
    expect(confirmation.technicianName).toBe('Fundi Amani');
  });

  it('healthCheck always reports healthy', async () => {
    const adapter = new ManualQueueAdapter({ store: createInMemoryManualQueueStore() });
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });
});
