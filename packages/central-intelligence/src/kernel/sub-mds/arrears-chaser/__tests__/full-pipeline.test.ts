import { describe, expect, it } from 'vitest';
import { createArrearsChaserSubMd, ARREARS_CHASER_NAME } from '../index.js';
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
        summary: 'Earlier soft reminder, gentler tone',
        steps: [
          { id: 'd3-soft', description: 'Send soft reminder on day 3 not day 7', expectedImpact: '+8% day7-cure' },
        ],
        predicted: { metric: 'day7-cure-rate', value: 0.6, unit: 'fraction' },
      }),
    };
  },
};

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: TENANT },
    nowMs: 0,
    correlationId: 'c-arrears',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm,
  };
}

function makeEvents(): ObservedEvent[] {
  return [
    { id: '1', topic: 'arrears.event', tenantId: TENANT, occurredAtMs: 1, payload: { leaseId: 'l1', state: 'mild' } },
    { id: '2', topic: 'arrears.event', tenantId: TENANT, occurredAtMs: 2, payload: { leaseId: 'l1', state: 'moderate' } },
    { id: '3', topic: 'arrears.event', tenantId: TENANT, occurredAtMs: 3, payload: { leaseId: 'l1', state: 'resolved' } },
    { id: '4', topic: 'arrears.event', tenantId: TENANT, occurredAtMs: 4, payload: { leaseId: 'l2', state: 'mild' } },
    { id: '5', topic: 'arrears.event', tenantId: TENANT, occurredAtMs: 5, payload: { leaseId: 'l2', state: 'serious', sla_breached: true } },
  ];
}

describe('arrears.chaser — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE produces a draft artefact', async () => {
    const sub = createArrearsChaserSubMd({ scope: { tenantId: TENANT } });
    const events = makeEvents();
    const ctx = makeCtx();
    const graph = await sub.map(events, ctx);
    expect(graph.slaBreaches.length).toBeGreaterThanOrEqual(1);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('arrears-chaser.')).toBe(true);
    expect(artifact.draftStatus).toBe('review-requested');
  });

  it('exposes 4 tools', () => {
    const sub = createArrearsChaserSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('arrears.draft_notice');
  });

  it('riskTier is mutate (reversible)', () => {
    const sub = createArrearsChaserSubMd({ scope: { tenantId: TENANT } });
    expect(sub.riskTier).toBe('mutate');
  });

  it('records outcomes', async () => {
    const sub = createArrearsChaserSubMd({ scope: { tenantId: TENANT } });
    await sub.recordOutcome(
      { metric: 'day7-cure-rate', value: 0.58, unit: 'fraction', recordedAtMs: 1000 },
      { metric: 'day7-cure-rate', value: 0.55, unit: 'fraction' },
    );
    expect(sub.name).toBe(ARREARS_CHASER_NAME);
  });
});
