/**
 * Risk recompute dispatcher tests — Wave 27 (Part B.6).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRiskRecomputeDispatcher,
  defaultRiskEventClassifier,
} from '../index.js';
import type { RiskComputeJob, RiskDispatcherTelemetry } from '../types.js';

describe('risk-recompute/dispatcher', () => {
  it('dispatches a PaymentReceived event to credit_rating + churn_probability', async () => {
    const creditCalls: RiskComputeJob[] = [];
    const churnCalls: RiskComputeJob[] = [];
    const telemetry: RiskDispatcherTelemetry[] = [];
    const dispatcher = createRiskRecomputeDispatcher({
      registry: {
        credit_rating: async (job) => {
          creditCalls.push(job);
        },
        churn_probability: async (job) => {
          churnCalls.push(job);
        },
      },
      telemetry: (t) => telemetry.push(t),
    });

    const result = await dispatcher.dispatchEvent({
      eventType: 'PaymentReceived',
      eventId: 'evt_1',
      tenantId: 't1',
      payload: { customerId: 'c_99', amountMinorUnits: 12000 },
    });

    expect(result.jobsDispatched).toBe(2);
    expect(result.failures).toHaveLength(0);
    expect(creditCalls[0]).toMatchObject({
      tenantId: 't1',
      kind: 'credit_rating',
      entityId: 'c_99',
      triggerEventId: 'evt_1',
      triggerEventType: 'PaymentReceived',
    });
    expect(churnCalls[0]).toMatchObject({
      kind: 'churn_probability',
      entityId: 'c_99',
    });
    expect(telemetry).toHaveLength(2);
    expect(telemetry.every((t) => t.outcome === 'ok')).toBe(true);
  });

  it('dedupes the same event dispatched twice within the dedupe window', async () => {
    const fn = vi.fn(async (_j: RiskComputeJob) => {});
    const dispatcher = createRiskRecomputeDispatcher({
      registry: { credit_rating: fn },
      dedupeWindowMs: 10_000,
    });
    const input = {
      eventType: 'PaymentReceived',
      eventId: 'evt_dup',
      tenantId: 't1',
      payload: { customerId: 'c_1' },
    };
    await dispatcher.dispatchEvent(input);
    await dispatcher.dispatchEvent(input);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('skips kinds without a registered compute function', async () => {
    const dispatcher = createRiskRecomputeDispatcher({
      registry: {}, // nothing wired
    });
    const result = await dispatcher.dispatchEvent({
      eventType: 'PaymentReceived',
      eventId: 'evt_2',
      tenantId: 't1',
      payload: { customerId: 'c_x' },
    });
    expect(result.jobsDispatched).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  it('captures an error without throwing when a compute function rejects', async () => {
    const telemetry: RiskDispatcherTelemetry[] = [];
    const dispatcher = createRiskRecomputeDispatcher({
      registry: {
        credit_rating: async () => {
          throw new Error('db down');
        },
      },
      telemetry: (t) => telemetry.push(t),
    });
    const result = await dispatcher.dispatchEvent({
      eventType: 'PaymentReceived',
      eventId: 'evt_err',
      tenantId: 't1',
      payload: { customerId: 'c_err' },
    });
    expect(result.jobsDispatched).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain('db down');
    const err = telemetry.find((t) => t.outcome === 'error');
    expect(err).toBeDefined();
    expect(err?.errorMessage).toContain('db down');
  });

  it('maps InspectionCompleted → property_grade for the affected propertyId', async () => {
    const calls: RiskComputeJob[] = [];
    const dispatcher = createRiskRecomputeDispatcher({
      registry: {
        property_grade: async (job) => {
          calls.push(job);
        },
      },
    });
    await dispatcher.dispatchEvent({
      eventType: 'InspectionCompleted',
      eventId: 'evt_insp',
      tenantId: 't1',
      payload: { propertyId: 'p_1', surveyId: 's_1' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('property_grade');
    expect(calls[0].entityId).toBe('p_1');
  });

  it('maps WorkOrderClosed → vendor_scorecard + property_grade', async () => {
    const kinds: string[] = [];
    const dispatcher = createRiskRecomputeDispatcher({
      registry: {
        vendor_scorecard: async (j) => {
          kinds.push(j.kind);
        },
        property_grade: async (j) => {
          kinds.push(j.kind);
        },
      },
    });
    const res = await dispatcher.dispatchEvent({
      eventType: 'WorkOrderClosed',
      eventId: 'evt_wo',
      tenantId: 't1',
      payload: { vendorId: 'v_1', propertyId: 'p_2' },
    });
    expect(res.jobsDispatched).toBe(2);
    expect(kinds.sort()).toEqual(['property_grade', 'vendor_scorecard']);
  });

  it('subscribeTo wires into a SubscribableEventBus', async () => {
    const calls: RiskComputeJob[] = [];
    const handlers = new Map<
      string,
      (envelope: { event: Record<string, unknown> }) => Promise<void>
    >();
    const bus = {
      subscribe(type: string, handler: (e: { event: Record<string, unknown> }) => Promise<void>) {
        handlers.set(type, handler);
        return () => handlers.delete(type);
      },
    };
    const dispatcher = createRiskRecomputeDispatcher({
      registry: {
        credit_rating: async (j) => {
          calls.push(j);
        },
      },
      eventTypes: ['PaymentReceived'],
    });
    dispatcher.subscribeTo(bus);
    const handler = handlers.get('PaymentReceived');
    expect(handler).toBeDefined();
    await handler!({
      event: {
        eventType: 'PaymentReceived',
        eventId: 'evt_bus',
        tenantId: 't1',
        timestamp: '2025-01-01T00:00:00Z',
        payload: { customerId: 'c_bus' },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].entityId).toBe('c_bus');
  });
});

describe('defaultRiskEventClassifier', () => {
  it('ignores unknown event types', () => {
    const matches = defaultRiskEventClassifier('RandomThing', { anything: 1 });
    expect(matches).toEqual([]);
  });

  it('drops a PaymentReceived with no customerId', () => {
    const matches = defaultRiskEventClassifier('PaymentReceived', {});
    expect(matches).toEqual([]);
  });
});
