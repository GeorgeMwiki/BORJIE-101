import { describe, expect, it } from 'vitest';
import { createLeaseCoordinatorSubMd, LEASE_COORDINATOR_NAME } from '../index.js';
import {
  DEFAULT_SUB_MD_BUDGET,
  type ObservedEvent,
  type SubMdContext,
  type SubMdLlmPort,
} from '../../shared/sub-md-base.js';

const TENANT = 't1';

const llm: SubMdLlmPort = {
  async generate() {
    return {
      text: JSON.stringify({
        summary: 'Send renewal proposal 60d earlier',
        steps: [
          { id: 'd60-renewal', description: 'Surface renewal draft at day 60', expectedImpact: '+12% on-time renewals' },
        ],
        predicted: { metric: 'on-time-renewal-rate', value: 0.78, unit: 'fraction' },
      }),
    };
  },
};

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: TENANT },
    nowMs: 0,
    correlationId: 'c-lease',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm,
  };
}

describe('lease.coordinator — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE', async () => {
    const sub = createLeaseCoordinatorSubMd({ scope: { tenantId: TENANT } });
    const events: ObservedEvent[] = [
      { id: '1', topic: 'lease.lifecycle', tenantId: TENANT, occurredAtMs: 1, payload: { leaseId: 'l1', state: 'pre-window' } },
      { id: '2', topic: 'lease.lifecycle', tenantId: TENANT, occurredAtMs: 2, payload: { leaseId: 'l1', state: 'open' } },
      { id: '3', topic: 'lease.lifecycle', tenantId: TENANT, occurredAtMs: 3, payload: { leaseId: 'l1', state: 'closing-soon' } },
      { id: '4', topic: 'lease.lifecycle', tenantId: TENANT, occurredAtMs: 4, payload: { leaseId: 'l1', state: 'renewed' } },
    ];
    const ctx = makeCtx();
    const graph = await sub.map(events, ctx);
    expect(graph.observationCount).toBe(4);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('lease-coordinator.')).toBe(true);
  });

  it('exposes 4 tools', () => {
    const sub = createLeaseCoordinatorSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('lease.draft_renewal');
  });

  it('riskTier is read — Tier-C draft-only', () => {
    const sub = createLeaseCoordinatorSubMd({ scope: { tenantId: TENANT } });
    expect(sub.riskTier).toBe('read');
  });

  it('name matches', () => {
    const sub = createLeaseCoordinatorSubMd({ scope: { tenantId: TENANT } });
    expect(sub.name).toBe(LEASE_COORDINATOR_NAME);
  });
});
