import { describe, it, expect } from 'vitest';
import { createVendorAdapterRegistry } from '../adapter-registry.js';
import {
  ManualQueueAdapter,
  createInMemoryManualQueueStore,
} from '../adapters/manual-queue-adapter.js';
import { ServiceChannelAdapter } from '../adapters/service-channel-adapter.js';
import { makeFakeFetch } from './test-helpers.js';

describe('VendorAdapterRegistry', () => {
  const fallback = new ManualQueueAdapter({ store: createInMemoryManualQueueStore() });
  const sc = new ServiceChannelAdapter({
    apiKey: 'k',
    baseUrl: 'https://sc.example',
    fetchImpl: makeFakeFetch({}),
  });
  const registry = createVendorAdapterRegistry({
    adapters: [sc, fallback],
    fallback,
  });

  it('resolves by integrationId', () => {
    const adapter = registry.resolveForVendor({ id: 'v1', integrationId: 'servicechannel' });
    expect(adapter.id).toBe('servicechannel');
  });

  it('falls back to manual-queue when integrationId is absent', () => {
    const adapter = registry.resolveForVendor({ id: 'v2' });
    expect(adapter.id).toBe('manual-queue');
  });

  it('falls back to manual-queue for unknown integrationId', () => {
    const adapter = registry.resolveForVendor({ id: 'v3', integrationId: 'some-unknown' });
    expect(adapter.id).toBe('manual-queue');
  });

  it('list returns every registered adapter', () => {
    const ids = registry.list().map((a) => a.id).sort();
    expect(ids).toEqual(['manual-queue', 'servicechannel']);
  });
});
