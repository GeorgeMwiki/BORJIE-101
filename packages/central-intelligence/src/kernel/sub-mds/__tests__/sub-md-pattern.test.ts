import { describe, expect, it } from 'vitest';
import { runObserveStage } from '../shared/observe-stage.js';
import { runMapStage } from '../shared/map-stage.js';
import { runAutomateStage } from '../shared/automate-stage.js';
import { runRedesignStage } from '../shared/redesign-stage.js';
import { createOutcomeRecorder } from '../shared/outcome-recorder.js';
import {
  DEFAULT_SUB_MD_BUDGET,
  eventInScope,
  freezeBudget,
  type ObservedEvent,
  type ScopeFilter,
  type SubMdContext,
  type SubMdLlmPort,
} from '../shared/sub-md-base.js';

const TENANT = 'tenant-A';

function makeEvent(over: Partial<ObservedEvent> = {}): ObservedEvent {
  return {
    id: over.id ?? 'evt-1',
    topic: over.topic ?? 'demo.topic',
    tenantId: over.tenantId ?? TENANT,
    occurredAtMs: over.occurredAtMs ?? 1000,
    payload: over.payload ?? {},
  };
}

const fakeLlm: SubMdLlmPort = {
  async generate({ user }) {
    return {
      text: JSON.stringify({
        summary: 'demo',
        steps: [{ id: 's1', description: 'do thing', expectedImpact: 'better' }],
        predicted: { metric: 'x', value: 0.5, unit: 'fraction' },
      }) + ` brief-len=${user.length}`,
    };
  },
};

function makeCtx(scope: ScopeFilter): SubMdContext {
  return {
    scope,
    nowMs: 1000,
    correlationId: 'corr-1',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm: fakeLlm,
  };
}

describe('eventInScope', () => {
  it('accepts in-tenant events', () => {
    const r = eventInScope(makeEvent(), { tenantId: TENANT });
    expect(r.ok).toBe(true);
  });
  it('rejects cross-tenant events', () => {
    const r = eventInScope(makeEvent({ tenantId: 'other' }), { tenantId: TENANT });
    expect(r.ok).toBe(false);
  });
});

describe('runObserveStage', () => {
  it('caps to budget and filters cross-tenant', async () => {
    const fallback: ObservedEvent[] = [
      makeEvent({ id: 'a' }),
      makeEvent({ id: 'b', tenantId: 'other' }),
      makeEvent({ id: 'c' }),
    ];
    const out = await runObserveStage({
      topic: 'demo.topic',
      scope: { tenantId: TENANT },
      budget: freezeBudget({ maxObservedEvents: 5 }),
      events: undefined,
      fallback,
    });
    expect(out.map(e => e.id)).toEqual(['a', 'c']);
  });

  it('respects budget cap', async () => {
    const fallback = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ id: `e${i}` }),
    );
    const out = await runObserveStage({
      topic: 'demo.topic',
      scope: { tenantId: TENANT },
      budget: freezeBudget({ maxObservedEvents: 3 }),
      events: undefined,
      fallback,
    });
    expect(out.length).toBe(3);
  });
});

describe('runMapStage', () => {
  it('builds a state-machine graph with breaches', () => {
    const events: ObservedEvent[] = [
      makeEvent({ id: '1', occurredAtMs: 1000, payload: { caseId: 't1', state: 'received' } }),
      makeEvent({ id: '2', occurredAtMs: 2000, payload: { caseId: 't1', state: 'dispatched', sla_breached: true } }),
      makeEvent({ id: '3', occurredAtMs: 1500, payload: { caseId: 't2', state: 'received' } }),
      makeEvent({ id: '4', occurredAtMs: 3000, payload: { caseId: 't2', state: 'dispatched' } }),
    ];
    const graph = runMapStage({ events });
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.edges.find(e => e.from === 'received' && e.to === 'dispatched')?.count).toBe(2);
    expect(graph.slaBreaches.find(b => b.nodeId === 'dispatched')?.breachedCount).toBe(1);
  });
});

describe('runRedesignStage', () => {
  it('parses LLM JSON proposal', async () => {
    const graph = runMapStage({ events: [] });
    const ctx = makeCtx({ tenantId: TENANT });
    const proposal = await runRedesignStage({
      graph,
      ctx,
      system: 'sys',
      fallbackPrediction: { metric: 'x', value: 0.1, unit: 'fraction' },
    });
    expect(proposal.summary).toBe('demo');
    expect(proposal.steps.length).toBe(1);
    expect(proposal.predicted.value).toBe(0.5);
  });

  it('falls back to fallbackPrediction when LLM omits prediction', async () => {
    const ctx: SubMdContext = {
      ...makeCtx({ tenantId: TENANT }),
      llm: {
        async generate() {
          return { text: '{"summary":"x","steps":[]}' };
        },
      },
    };
    const proposal = await runRedesignStage({
      graph: runMapStage({ events: [] }),
      ctx,
      system: 'sys',
      fallbackPrediction: { metric: 'x', value: 0.1, unit: 'fraction' },
    });
    expect(proposal.predicted.value).toBe(0.1);
  });
});

describe('runAutomateStage', () => {
  it('produces a draft artefact', () => {
    const artifact = runAutomateStage({
      proposal: {
        summary: 'x',
        steps: [{ id: 'foo', description: 'd', expectedImpact: 'i' }],
        predicted: { metric: 'x', value: 1, unit: 'count' },
      },
      skillNamespace: 'ns',
      cronExpression: '* * * * *',
      monitorThresholds: { latencyMs: 1000 },
      hookNames: ['a', 'b'],
      budget: DEFAULT_SUB_MD_BUDGET,
    });
    expect(artifact.skillName.startsWith('ns.')).toBe(true);
    expect(artifact.draftStatus).toBe('review-requested');
    expect(artifact.hookNames).toEqual(['a', 'b']);
  });
});

describe('outcomeRecorder', () => {
  it('classifies verdict and history is immutable', async () => {
    const rec = createOutcomeRecorder();
    const r = await rec.record({
      subMdName: 'demo',
      predicted: { metric: 'x', value: 100, unit: 'count' },
      actual: { metric: 'x', value: 70, unit: 'count', recordedAtMs: 1000 },
    });
    expect(r.verdict).toBe('under-performed');
    expect(rec.history().length).toBe(1);
    expect(() => (rec.history() as unknown as { push: (x: unknown) => void }).push({})).toThrow();
  });

  it('on-target verdict within 10%', async () => {
    const rec = createOutcomeRecorder();
    const r = await rec.record({
      subMdName: 'demo',
      predicted: { metric: 'x', value: 100, unit: 'count' },
      actual: { metric: 'x', value: 105, unit: 'count', recordedAtMs: 1 },
    });
    expect(r.verdict).toBe('on-target');
  });
});
