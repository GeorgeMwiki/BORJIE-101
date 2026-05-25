import { describe, expect, it } from 'vitest';
import {
  agentInvoiceForPeriod,
  computeCallCost,
  InMemoryAaaSEndpointStore,
  meterAgentCall,
  priceQuoteForJob,
  publishAgentEndpoint,
  type AaaSCallMetric,
  type MeteringSink,
} from '../index.js';

describe('agent-as-a-service / publishAgentEndpoint', () => {
  it('persists a per_call endpoint as live', async () => {
    const store = new InMemoryAaaSEndpointStore();
    const ep = await publishAgentEndpoint({
      store,
      input: {
        agentId: 'agent-rent',
        domainId: 'rent-collection',
        pricing: { model: 'per_call', unitPriceUsdCents: 5 },
        sla: {
          latencyP95Ms: 1500,
          availabilityPct: 99.5,
          maxResponseSeconds: 5,
          refundPolicy: 'partial',
        },
        scope: {
          tenantsAllowed: 'any',
          jurisdictions: ['TZ', 'KE'],
        },
      },
    });
    expect(ep.status).toBe('live');
    const fetched = await store.get(ep.endpointId);
    expect(fetched?.endpointId).toBe(ep.endpointId);
  });

  it('rejects negative unit price', async () => {
    const store = new InMemoryAaaSEndpointStore();
    await expect(
      publishAgentEndpoint({
        store,
        input: {
          agentId: 'a',
          domainId: 'd',
          pricing: { model: 'per_call', unitPriceUsdCents: -1 },
          sla: {
            latencyP95Ms: 100,
            availabilityPct: 99,
            maxResponseSeconds: 5,
            refundPolicy: 'none',
          },
          scope: { tenantsAllowed: 'self', jurisdictions: ['TZ'] },
        },
      }),
    ).rejects.toThrow();
  });

  it('per_subscription requires monthlyUsdCents', async () => {
    const store = new InMemoryAaaSEndpointStore();
    await expect(
      publishAgentEndpoint({
        store,
        input: {
          agentId: 'a',
          domainId: 'd',
          pricing: { model: 'per_subscription', unitPriceUsdCents: 0 },
          sla: {
            latencyP95Ms: 100,
            availabilityPct: 99,
            maxResponseSeconds: 5,
            refundPolicy: 'none',
          },
          scope: { tenantsAllowed: 'self', jurisdictions: ['TZ'] },
        },
      }),
    ).rejects.toThrow(/monthlyUsdCents/);
  });
});

describe('agent-as-a-service / computeCallCost', () => {
  it('per_call charges units × unit price regardless of outcome', () => {
    const c = computeCallCost({
      pricing: { model: 'per_call', unitPriceUsdCents: 7 },
      units: 4,
      outcome: 'failure',
    });
    expect(c).toBe(28);
  });

  it('per_outcome charges full on success, 50% on partial, 0 on failure', () => {
    expect(
      computeCallCost({
        pricing: { model: 'per_outcome', unitPriceUsdCents: 200 },
        units: 1,
        outcome: 'success',
      }),
    ).toBe(200);
    expect(
      computeCallCost({
        pricing: { model: 'per_outcome', unitPriceUsdCents: 200 },
        units: 1,
        outcome: 'partial',
      }),
    ).toBe(100);
    expect(
      computeCallCost({
        pricing: { model: 'per_outcome', unitPriceUsdCents: 200 },
        units: 1,
        outcome: 'failure',
      }),
    ).toBe(0);
  });

  it('per_subscription returns 0 per call (settled at invoice time)', () => {
    expect(
      computeCallCost({
        pricing: {
          model: 'per_subscription',
          unitPriceUsdCents: 100,
          monthlyUsdCents: 50000,
        },
        units: 10,
        outcome: 'success',
      }),
    ).toBe(0);
  });
});

describe('agent-as-a-service / meterAgentCall', () => {
  it('emits a metric with computed cost', async () => {
    const store = new InMemoryAaaSEndpointStore();
    const ep = await publishAgentEndpoint({
      store,
      input: {
        agentId: 'a',
        domainId: 'd',
        pricing: { model: 'per_call', unitPriceUsdCents: 5 },
        sla: {
          latencyP95Ms: 100,
          availabilityPct: 99,
          maxResponseSeconds: 5,
          refundPolicy: 'none',
        },
        scope: { tenantsAllowed: 'any', jurisdictions: ['TZ'] },
      },
    });
    const captured: AaaSCallMetric[] = [];
    const sink: MeteringSink = { emit: async (m) => void captured.push(m) };
    const metric = await meterAgentCall({
      endpoint: ep,
      input: {
        endpointId: ep.endpointId,
        callId: 'call-1',
        tenantId: 't1',
        units: 3,
        outcome: 'success',
      },
      sink,
    });
    expect(metric.costUsdCents).toBe(15);
    expect(captured).toHaveLength(1);
  });
});

describe('agent-as-a-service / priceQuoteForJob', () => {
  it('returns a cost estimate + clamped confidence + ttl', async () => {
    const store = new InMemoryAaaSEndpointStore();
    const ep = await publishAgentEndpoint({
      store,
      input: {
        agentId: 'a',
        domainId: 'd',
        pricing: { model: 'per_outcome', unitPriceUsdCents: 250 },
        sla: {
          latencyP95Ms: 1000,
          availabilityPct: 99.9,
          maxResponseSeconds: 5,
          refundPolicy: 'partial',
        },
        scope: { tenantsAllowed: 'any', jurisdictions: ['TZ'] },
      },
    });
    const quote = await priceQuoteForJob({
      endpoint: ep,
      input: {
        endpointId: ep.endpointId,
        job: { estimatedUnits: 4, confidence: 1.5 /* clamps to 1 */ },
        ttlSeconds: 60,
      },
    });
    expect(quote.estimatedCostUsdCents).toBe(1000);
    expect(quote.confidence).toBe(1);
    expect(quote.assumedUnits).toBe(4);
    expect(quote.expiresAt > quote.issuedAt).toBe(true);
  });
});

describe('agent-as-a-service / agentInvoiceForPeriod', () => {
  it('rolls per_call metrics into a single line per endpoint', async () => {
    const store = new InMemoryAaaSEndpointStore();
    const ep = await publishAgentEndpoint({
      store,
      input: {
        agentId: 'a',
        domainId: 'd',
        pricing: { model: 'per_call', unitPriceUsdCents: 5 },
        sla: {
          latencyP95Ms: 100,
          availabilityPct: 99,
          maxResponseSeconds: 5,
          refundPolicy: 'none',
        },
        scope: { tenantsAllowed: 'any', jurisdictions: ['TZ'] },
      },
      now: () => new Date('2026-05-01T00:00:00Z'),
    });
    const metrics: AaaSCallMetric[] = [
      {
        metricId: 'm1',
        endpointId: ep.endpointId,
        callId: 'c1',
        tenantId: 't1',
        units: 2,
        outcome: 'success',
        costUsdCents: 10,
        capturedAt: '2026-05-05T10:00:00Z',
      },
      {
        metricId: 'm2',
        endpointId: ep.endpointId,
        callId: 'c2',
        tenantId: 't1',
        units: 5,
        outcome: 'failure',
        costUsdCents: 25,
        capturedAt: '2026-05-08T10:00:00Z',
      },
      // out of period
      {
        metricId: 'm3',
        endpointId: ep.endpointId,
        callId: 'c3',
        tenantId: 't1',
        units: 100,
        outcome: 'success',
        costUsdCents: 500,
        capturedAt: '2026-04-30T10:00:00Z',
      },
      // other tenant
      {
        metricId: 'm4',
        endpointId: ep.endpointId,
        callId: 'c4',
        tenantId: 't-other',
        units: 100,
        outcome: 'success',
        costUsdCents: 500,
        capturedAt: '2026-05-10T10:00:00Z',
      },
    ];

    const invoice = agentInvoiceForPeriod({
      tenantId: 't1',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-06-01T00:00:00Z'),
      metrics,
      endpoints: [ep],
      taxRatePct: 18,
    });
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0]?.subtotalUsdCents).toBe(35);
    expect(invoice.subtotalUsdCents).toBe(35);
    expect(invoice.taxUsdCents).toBe(6); // round(35 * 0.18)
    expect(invoice.totalUsdCents).toBe(41);
  });

  it('per_subscription bills monthly base + overage', async () => {
    const store = new InMemoryAaaSEndpointStore();
    const ep = await publishAgentEndpoint({
      store,
      input: {
        agentId: 'a',
        domainId: 'd',
        pricing: {
          model: 'per_subscription',
          unitPriceUsdCents: 0,
          monthlyUsdCents: 50000,
          includedUnits: 1000,
          overageUnitPriceUsdCents: 5,
        },
        sla: {
          latencyP95Ms: 100,
          availabilityPct: 99,
          maxResponseSeconds: 5,
          refundPolicy: 'none',
        },
        scope: { tenantsAllowed: 'self', jurisdictions: ['TZ'] },
      },
    });
    const metrics: AaaSCallMetric[] = [
      {
        metricId: 'm1',
        endpointId: ep.endpointId,
        callId: 'c1',
        tenantId: 't1',
        units: 1500, // 500 over
        outcome: 'success',
        costUsdCents: 0,
        capturedAt: '2026-05-10T00:00:00Z',
      },
    ];
    const invoice = agentInvoiceForPeriod({
      tenantId: 't1',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-06-01T00:00:00Z'),
      metrics,
      endpoints: [ep],
    });
    // 50000 base + 500*5 = 52500
    expect(invoice.subtotalUsdCents).toBe(52500);
  });

  it('subscription with no usage still bills monthly base', () => {
    const ep = {
      endpointId: 'ep-sub',
      agentId: 'a',
      domainId: 'd',
      pricing: {
        model: 'per_subscription' as const,
        unitPriceUsdCents: 0,
        monthlyUsdCents: 30000,
        includedUnits: 100,
        overageUnitPriceUsdCents: 0,
      },
      sla: {
        latencyP95Ms: 100,
        availabilityPct: 99,
        maxResponseSeconds: 5,
        refundPolicy: 'none' as const,
      },
      scope: {
        tenantsAllowed: 'self' as const,
        jurisdictions: ['TZ' as const],
      },
      publishedAt: '2026-05-01T00:00:00Z',
      status: 'live' as const,
    };
    const invoice = agentInvoiceForPeriod({
      tenantId: 't1',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-06-01T00:00:00Z'),
      metrics: [],
      endpoints: [ep],
    });
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.subtotalUsdCents).toBe(30000);
  });
});
