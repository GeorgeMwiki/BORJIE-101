import { describe, expect, it } from 'vitest';
import { observeMaintenance, MAINTENANCE_TICKET_TOPIC } from '../observe.js';
import {
  DEFAULT_SUB_MD_BUDGET,
  type ObservedEvent,
  type SubMdContext,
  type SubMdLlmPort,
} from '../../shared/sub-md-base.js';

const fakeLlm: SubMdLlmPort = { async generate() { return { text: '{}' }; } };

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: 't1' },
    nowMs: 1000,
    correlationId: 'c1',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm: fakeLlm,
  };
}

describe('observeMaintenance', () => {
  it('returns only in-tenant events from fallback', async () => {
    const fallback: ObservedEvent[] = [
      { id: '1', topic: MAINTENANCE_TICKET_TOPIC, tenantId: 't1', occurredAtMs: 1, payload: {} },
      { id: '2', topic: MAINTENANCE_TICKET_TOPIC, tenantId: 't2', occurredAtMs: 2, payload: {} },
      { id: '3', topic: MAINTENANCE_TICKET_TOPIC, tenantId: 't1', occurredAtMs: 3, payload: {} },
    ];
    const out = await observeMaintenance(makeCtx(), fallback);
    expect(out.map(e => e.id)).toEqual(['1', '3']);
  });

  it('returns empty if no event port and no fallback', async () => {
    const out = await observeMaintenance(makeCtx());
    expect(out).toEqual([]);
  });

  it('topic constant matches expected', () => {
    expect(MAINTENANCE_TICKET_TOPIC).toBe('maintenance.ticket');
  });
});
