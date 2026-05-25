import { describe, it, expect } from 'vitest';
import { ServiceChannelAdapter } from '../adapters/service-channel-adapter.js';
import { VendorAdapterError } from '../adapter-contract.js';
import { makeFakeFetch, fixedClock } from './test-helpers.js';

const INPUT = {
  workOrderId: 'wo_1',
  vendorId: 'ven_sc_1',
  tenantId: 'tnt_1',
  preferredWindowStart: '2026-05-01T09:00:00Z',
  preferredWindowEnd: '2026-05-01T12:00:00Z',
  description: 'Leaky faucet in unit 3B',
  locationHint: 'Block A / Unit 3B',
  priority: 'high' as const,
};

describe('ServiceChannelAdapter', () => {
  it('posts to /v3/workorders and returns a scheduled dispatch', async () => {
    const fakeFetch = makeFakeFetch({
      '/v3/workorders': {
        body: {
          id: 'sc_42',
          scheduledStart: '2026-05-01T10:00:00Z',
          scheduledEnd: '2026-05-01T13:00:00Z',
          trackingUrl: 'https://servicechannel.example/wo/42',
        },
      },
    });
    const adapter = new ServiceChannelAdapter({
      apiKey: 'sk-test',
      baseUrl: 'https://sc.example',
      fetchImpl: fakeFetch,
      now: fixedClock('2026-04-30T08:00:00Z'),
    });

    const result = await adapter.scheduleDispatch(INPUT);
    expect(result.adapterId).toBe('servicechannel');
    expect(result.dispatchId).toBe('sc_42');
    expect(result.status).toBe('scheduled');
    expect(result.trackingUrl).toBe('https://servicechannel.example/wo/42');
    expect(fakeFetch.calls).toHaveLength(1);
    expect(fakeFetch.calls[0].init?.method).toBe('POST');
    expect(fakeFetch.calls[0].init?.headers?.Authorization).toBe('Bearer sk-test');
  });

  it('falls back to a pending stub when API key is absent', async () => {
    const fakeFetch = makeFakeFetch({});
    const adapter = new ServiceChannelAdapter({
      apiKey: null,
      baseUrl: 'https://sc.example',
      fetchImpl: fakeFetch,
    });
    const result = await adapter.scheduleDispatch(INPUT);
    expect(result.status).toBe('pending');
    expect(result.note).toMatch(/API key absent/);
    expect(fakeFetch.calls).toHaveLength(0);
  });

  it('throws VendorAdapterError on 500 response', async () => {
    const fakeFetch = makeFakeFetch({
      '/v3/workorders': { status: 500, statusText: 'Internal Error' },
    });
    const adapter = new ServiceChannelAdapter({
      apiKey: 'sk-test',
      baseUrl: 'https://sc.example',
      fetchImpl: fakeFetch,
    });
    await expect(adapter.scheduleDispatch(INPUT)).rejects.toBeInstanceOf(VendorAdapterError);
  });

  it('healthCheck reports unhealthy when API key is missing', async () => {
    const adapter = new ServiceChannelAdapter({
      apiKey: null,
      baseUrl: 'https://sc.example',
      fetchImpl: makeFakeFetch({}),
    });
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/API key/);
  });
});
