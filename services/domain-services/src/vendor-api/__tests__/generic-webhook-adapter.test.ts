import { describe, it, expect } from 'vitest';
import { GenericWebhookAdapter } from '../adapters/generic-webhook-adapter.js';
import { VendorAdapterError } from '../adapter-contract.js';
import { makeFakeFetch, fixedClock } from './test-helpers.js';

const INPUT = {
  workOrderId: 'wo_42',
  vendorId: 'ven_gw_1',
  tenantId: 'tnt_1',
  preferredWindowStart: '2026-05-03T08:00:00Z',
  preferredWindowEnd: '2026-05-03T10:00:00Z',
  description: 'Security camera maintenance',
  locationHint: 'Lobby',
  priority: 'normal' as const,
};

describe('GenericWebhookAdapter', () => {
  it('POSTs the dispatch payload with signed header and tracking URL', async () => {
    const fakeFetch = makeFakeFetch({
      'https://vendor.example/hook': { body: { accepted: true } },
    });
    const adapter = new GenericWebhookAdapter({
      webhookUrl: 'https://vendor.example/hook',
      signingSecret: 'shared-secret',
      fetchImpl: fakeFetch,
      callbackUrlPrefix: 'https://borjie.example/api/v1/vendor-dispatch',
      now: fixedClock('2026-05-02T10:00:00Z'),
      randomToken: () => 'tok123',
    });
    const result = await adapter.scheduleDispatch(INPUT);
    expect(result.status).toBe('dispatched');
    expect(result.dispatchId).toContain('tok123');
    expect(result.trackingUrl).toBe(
      'https://borjie.example/api/v1/vendor-dispatch/callback/tok123',
    );
    expect(fakeFetch.calls).toHaveLength(1);
    expect(fakeFetch.calls[0].init?.headers?.['X-Borjie-Signature']).toBeTruthy();
  });

  it('confirmOnSite throws retryable error before callback arrives', async () => {
    const adapter = new GenericWebhookAdapter({
      webhookUrl: 'https://vendor.example/hook',
      signingSecret: null,
      fetchImpl: makeFakeFetch({
        'https://vendor.example/hook': { body: {} },
      }),
      callbackUrlPrefix: 'https://borjie.example/api/v1/vendor-dispatch',
      randomToken: () => 'tokXYZ',
    });
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

  it('records callback and resolves confirmOnSite afterwards', async () => {
    const adapter = new GenericWebhookAdapter({
      webhookUrl: 'https://vendor.example/hook',
      signingSecret: null,
      fetchImpl: makeFakeFetch({
        'https://vendor.example/hook': { body: {} },
      }),
      callbackUrlPrefix: 'https://borjie.example/api/v1/vendor-dispatch',
      randomToken: () => 'tokABC',
    });
    const dispatch = await adapter.scheduleDispatch(INPUT);
    adapter.recordCallback('tokABC', {
      dispatchId: dispatch.dispatchId,
      confirmedAt: '2026-05-03T09:00:00Z',
      confirmedBy: 'webhook',
      technicianName: 'Jane',
      notes: null,
    });
    const confirmation = await adapter.confirmOnSite(dispatch.dispatchId);
    expect(confirmation.technicianName).toBe('Jane');
    expect(confirmation.confirmedBy).toBe('webhook');
  });
});
