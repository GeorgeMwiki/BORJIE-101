import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCockpitBusForTests,
  publishCockpitEvent,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../index';

const TENANT_A = 'tenant-a-uuid';
const TENANT_B = 'tenant-b-uuid';

function makeDecisionEvent(tenantId: string, suffix = ''): CockpitEvent {
  return {
    kind: 'decision.recorded',
    tenantId,
    emittedAt: '2026-05-29T10:00:00Z',
    decisionId: `dec-${suffix}`,
    subject: 'A test decision',
    severity: 'medium',
  };
}

describe('cockpit-events bus', () => {
  beforeEach(() => {
    __resetCockpitBusForTests();
  });

  afterEach(() => {
    __resetCockpitBusForTests();
  });

  it('delivers an event to a single subscriber', () => {
    const handler = vi.fn();
    const unsub = subscribeCockpitEvents(TENANT_A, handler);
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_A, '1'));
    expect(delivered).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    const arg = handler.mock.calls[0]?.[0] as CockpitEvent;
    expect(arg.kind).toBe('decision.recorded');
    expect(arg.tenantId).toBe(TENANT_A);
    unsub();
  });

  it('isolates events between tenants', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    subscribeCockpitEvents(TENANT_A, handlerA);
    subscribeCockpitEvents(TENANT_B, handlerB);
    publishCockpitEvent(makeDecisionEvent(TENANT_A, 'x'));
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('returns zero when no subscriber listens for the tenant', () => {
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_B, 'orphan'));
    expect(delivered).toBe(0);
  });

  it('stops delivering after unsubscribe', () => {
    const handler = vi.fn();
    const unsub = subscribeCockpitEvents(TENANT_A, handler);
    publishCockpitEvent(makeDecisionEvent(TENANT_A, '1'));
    unsub();
    publishCockpitEvent(makeDecisionEvent(TENANT_A, '2'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('broadcasts to multiple subscribers for the same tenant', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    subscribeCockpitEvents(TENANT_A, handlerA);
    subscribeCockpitEvents(TENANT_A, handlerB);
    const delivered = publishCockpitEvent(makeDecisionEvent(TENANT_A, 'fanout'));
    expect(delivered).toBe(2);
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });
});
