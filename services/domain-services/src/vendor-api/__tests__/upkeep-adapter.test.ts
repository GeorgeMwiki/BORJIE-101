import { describe, it, expect } from 'vitest';
import { UpKeepAdapter } from '../adapters/upkeep-adapter.js';
import { makeFakeFetch, fixedClock } from './test-helpers.js';

const INPUT = {
  workOrderId: 'wo_9',
  vendorId: 'upk_v',
  tenantId: 'tnt_1',
  preferredWindowStart: '2026-05-02T09:00:00Z',
  preferredWindowEnd: '2026-05-02T12:00:00Z',
  description: 'HVAC filter swap',
  locationHint: 'Rooftop',
  priority: 'normal' as const,
};

describe('UpKeepAdapter', () => {
  it('posts to /api/v2/work-orders and returns a scheduled dispatch', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/v2/work-orders': {
        body: {
          id: 1234,
          scheduledStartAt: '2026-05-02T10:00:00Z',
          scheduledEndAt: '2026-05-02T12:00:00Z',
          publicUrl: 'https://upkeep.example/wo/1234',
        },
      },
    });
    const adapter = new UpKeepAdapter({
      apiKey: 'upk-test',
      baseUrl: 'https://api.onupkeep.com',
      fetchImpl: fakeFetch,
      now: fixedClock('2026-05-01T12:00:00Z'),
    });
    const result = await adapter.scheduleDispatch(INPUT);
    expect(result.dispatchId).toBe('1234');
    expect(result.adapterId).toBe('upkeep');
    expect(result.status).toBe('scheduled');
    expect(result.trackingUrl).toBe('https://upkeep.example/wo/1234');
  });

  it('falls back to pending stub when API key absent', async () => {
    const adapter = new UpKeepAdapter({
      apiKey: null,
      baseUrl: 'https://api.onupkeep.com',
      fetchImpl: makeFakeFetch({}),
    });
    const result = await adapter.scheduleDispatch(INPUT);
    expect(result.status).toBe('pending');
    expect(result.note).toMatch(/API key absent/);
  });

  it('submitInvoice normalizes response and preserves amount/currency', async () => {
    const fakeFetch = makeFakeFetch({
      '/invoices': { body: { id: 'inv_upk_9', state: 'pending' } },
    });
    const adapter = new UpKeepAdapter({
      apiKey: 'upk-test',
      baseUrl: 'https://api.onupkeep.com',
      fetchImpl: fakeFetch,
    });
    const result = await adapter.submitInvoice('1234', {
      invoiceNumber: 'INV-1',
      amountMinorUnits: 500_00,
      currency: 'USD',
      lineItems: [{ description: 'Labor', amountMinorUnits: 500_00 }],
      issuedAt: '2026-05-03T00:00:00Z',
    });
    expect(result.status).toBe('pending');
    expect(result.amountMinorUnits).toBe(500_00);
    expect(result.currency).toBe('USD');
  });
});
