import { describe, expect, it } from 'vitest';
import { createMaintenanceDispatchSubMd, MAINTENANCE_DISPATCH_NAME } from '../index.js';
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
        summary: 'Route emergency water faster',
        steps: [
          { id: 'closer-vendor', description: 'Prefer closest emergency plumber', expectedImpact: '-30% response' },
        ],
        predicted: { metric: 'emergency-response-reduction', value: 0.3, unit: 'fraction' },
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
    { id: '1', topic: 'maintenance.ticket', tenantId: TENANT, occurredAtMs: 1, payload: { caseId: 'tk-1', state: 'received' } },
    { id: '2', topic: 'maintenance.ticket', tenantId: TENANT, occurredAtMs: 2, payload: { caseId: 'tk-1', state: 'classified' } },
    { id: '3', topic: 'maintenance.ticket', tenantId: TENANT, occurredAtMs: 3, payload: { caseId: 'tk-1', state: 'dispatched' } },
    { id: '4', topic: 'maintenance.ticket', tenantId: TENANT, occurredAtMs: 4, payload: { caseId: 'tk-1', state: 'resolved' } },
    { id: '5', topic: 'maintenance.ticket', tenantId: TENANT, occurredAtMs: 5, payload: { caseId: 'tk-2', state: 'received' } },
    { id: '6', topic: 'maintenance.ticket', tenantId: TENANT, occurredAtMs: 6, payload: { caseId: 'tk-2', state: 'dispatched', sla_breached: true } },
  ];
}

describe('maintenance.dispatch — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE produces a draft artefact', async () => {
    const sub = createMaintenanceDispatchSubMd({ scope: { tenantId: TENANT } });
    const ctx = makeCtx();
    // Use the helper observe form (fallback) since AsyncIterable in
    // production needs an event port. We bypass via the helper directly.
    const events = makeEvents();
    const graph = await sub.map(events, ctx);
    expect(graph.observationCount).toBe(events.length);
    expect(graph.slaBreaches.length).toBeGreaterThanOrEqual(1);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('maintenance-dispatch.')).toBe(true);
    expect(artifact.draftStatus).toBe('review-requested');
    expect(artifact.hookNames).toContain('maintenance.dispatch_work_order');
  });

  it('records predicted-vs-actual outcomes', async () => {
    const sub = createMaintenanceDispatchSubMd({ scope: { tenantId: TENANT } });
    await sub.recordOutcome(
      { metric: 'emergency-response-reduction', value: 0.5, unit: 'fraction', recordedAtMs: 1000 },
      { metric: 'emergency-response-reduction', value: 0.45, unit: 'fraction' },
    );
    // No throw is the contract — the recorder is internal.
    expect(sub.name).toBe(MAINTENANCE_DISPATCH_NAME);
  });

  it('exposes 4 tools in the toolbelt', () => {
    const sub = createMaintenanceDispatchSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('maintenance.classify_ticket');
    expect(sub.toolBelt).toContain('maintenance.pick_vendor');
    expect(sub.toolBelt).toContain('maintenance.dispatch_work_order');
    expect(sub.toolBelt).toContain('maintenance.follow_up');
  });

  it('observe() returns AsyncIterable empty when no port', async () => {
    const sub = createMaintenanceDispatchSubMd({ scope: { tenantId: TENANT } });
    const collected: ObservedEvent[] = [];
    for await (const e of sub.observe(makeCtx())) {
      collected.push(e);
    }
    expect(collected.length).toBe(0);
  });
});
