import { describe, expect, it } from 'vitest';
import { createComplaintTriageSubMd, COMPLAINT_TRIAGE_NAME } from '../index.js';
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
        summary: 'Tighten safety routing',
        steps: [{ id: 'safety-fast', description: 'P0 for safety always', expectedImpact: '-90% time-to-ack' }],
        predicted: { metric: 'first-attempt-routing-accuracy', value: 0.95, unit: 'fraction' },
      }),
    };
  },
};

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: TENANT },
    nowMs: 1000,
    correlationId: 'c-pipeline',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm,
  };
}

function makeEvents(): ObservedEvent[] {
  return [
    { id: '1', topic: 'complaint.received', tenantId: TENANT, occurredAtMs: 1, payload: { caseId: 'cmp-1', state: 'received' } },
    { id: '2', topic: 'complaint.received', tenantId: TENANT, occurredAtMs: 2, payload: { caseId: 'cmp-1', state: 'classified' } },
    { id: '3', topic: 'complaint.received', tenantId: TENANT, occurredAtMs: 3, payload: { caseId: 'cmp-1', state: 'routed' } },
    { id: '4', topic: 'complaint.received', tenantId: TENANT, occurredAtMs: 4, payload: { caseId: 'cmp-1', state: 'resolved' } },
    { id: '5', topic: 'complaint.received', tenantId: TENANT, occurredAtMs: 5, payload: { caseId: 'cmp-2', state: 'received' } },
    { id: '6', topic: 'complaint.received', tenantId: TENANT, occurredAtMs: 6, payload: { caseId: 'cmp-2', state: 'escalated', sla_breached: true } },
  ];
}

describe('complaint.triage — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE produces a draft artefact', async () => {
    const sub = createComplaintTriageSubMd({ scope: { tenantId: TENANT } });
    const ctx = makeCtx();
    const events = makeEvents();
    const graph = await sub.map(events, ctx);
    expect(graph.observationCount).toBe(events.length);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('complaint-triage.')).toBe(true);
    expect(artifact.draftStatus).toBe('review-requested');
    expect(artifact.hookNames).toContain('complaint.empathize_response');
  });

  it('exposes 4 tools in the toolbelt', () => {
    const sub = createComplaintTriageSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('complaint.classify');
    expect(sub.toolBelt).toContain('complaint.route');
    expect(sub.toolBelt).toContain('complaint.empathize_response');
    expect(sub.toolBelt).toContain('complaint.escalate_when_needed');
  });

  it('observe() returns empty when no port', async () => {
    const sub = createComplaintTriageSubMd({ scope: { tenantId: TENANT } });
    const collected: ObservedEvent[] = [];
    for await (const e of sub.observe(makeCtx())) collected.push(e);
    expect(collected.length).toBe(0);
  });

  it('records outcome successfully', async () => {
    const sub = createComplaintTriageSubMd({ scope: { tenantId: TENANT } });
    await sub.recordOutcome(
      { metric: 'first-attempt-routing-accuracy', value: 0.92, unit: 'fraction', recordedAtMs: 1000 },
      { metric: 'first-attempt-routing-accuracy', value: 0.9, unit: 'fraction' },
    );
    expect(sub.name).toBe(COMPLAINT_TRIAGE_NAME);
  });

  it('risk tier is mutate (Tier-A reversible)', () => {
    const sub = createComplaintTriageSubMd({ scope: { tenantId: TENANT } });
    expect(sub.riskTier).toBe('mutate');
  });
});
