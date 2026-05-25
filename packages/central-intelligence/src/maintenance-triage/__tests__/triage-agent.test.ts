/**
 * Unit tests for the maintenance triage agent — pure deterministic
 * state-machine, fully testable from synthetic data.
 */

import { describe, it, expect } from 'vitest';
import {
  answer,
  buildWorkOrder,
  DEFAULT_TRIAGE_TREE,
  startSession,
  type TriageOutcome,
  type TriageTree,
} from '../triage-agent.js';

const CTX = { tenantId: 't-alpha', customerId: 'c-1', initialReport: 'no power in bedroom' };

function expectQuestion(outcome: TriageOutcome): asserts outcome is { kind: 'ask'; node: { kind: 'question'; id: string; question: string; options: ReadonlyArray<{ key: string; label: string; nextNodeId: string }> } } {
  if (outcome.kind !== 'ask') throw new Error(`expected ask, got ${outcome.kind}`);
}

describe('startSession', () => {
  it('returns the root question on a fresh session', () => {
    const { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    expect(outcome.node.id).toBe('root');
    expect(session.currentNodeId).toBe('root');
    expect(session.history).toHaveLength(0);
    expect(session.initialReport).toBe('no power in bedroom');
  });

  it('accepts a deterministic clock', () => {
    const fixed = new Date('2026-05-15T10:00:00Z');
    const { session } = startSession({ ...CTX, clock: () => fixed });
    expect(session.startedAt).toBe(fixed.toISOString());
  });

  it('accepts a supplied sessionId', () => {
    const { session } = startSession({ ...CTX, sessionId: 'sess-fixed-1' });
    expect(session.sessionId).toBe('sess-fixed-1');
  });

  it('throws if rootNodeId is missing from the tree', () => {
    const broken: TriageTree = { rootNodeId: 'missing', nodes: {} };
    expect(() => startSession({ ...CTX, tree: broken })).toThrow(/rootNodeId/);
  });
});

describe('answer — happy path branches', () => {
  it('breaker-flipped path resolves self-service', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'electrical' }));
    expectQuestion(outcome);
    expect(outcome.node.id).toBe('electrical.scope');
    ({ session, outcome } = answer({ session, optionKey: 'zone' }));
    expectQuestion(outcome);
    expect(outcome.node.id).toBe('electrical.zone.breaker-check');
    ({ session, outcome } = answer({ session, optionKey: 'yes' }));
    if (outcome.kind !== 'self-service') throw new Error('expected self-service');
    expect(outcome.node.problemCode).toBe('electrical.breaker.tripped');
    expect(outcome.node.instructions.length).toBeGreaterThan(0);
    expect(outcome.node.safetyWarning).toBeDefined();
    expect(session.history).toHaveLength(3);
  });

  it('zone-no-breaker path dispatches with high urgency', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'electrical' }));
    ({ session, outcome } = answer({ session, optionKey: 'zone' }));
    ({ session, outcome } = answer({ session, optionKey: 'no' }));
    if (outcome.kind !== 'dispatch') throw new Error('expected dispatch');
    expect(outcome.node.urgency).toBe('high');
    expect(outcome.node.vendorTags).toContain('electrician');
  });

  it('whole-house outage dispatches critical', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'electrical' }));
    ({ session, outcome } = answer({ session, optionKey: 'whole-house' }));
    if (outcome.kind !== 'dispatch') throw new Error('expected dispatch');
    expect(outcome.node.urgency).toBe('critical');
    expect(outcome.node.problemCode).toBe('electrical.no-power-whole');
  });

  it('plumbing leak dispatches critical with emergency vendor', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'plumbing' }));
    ({ session, outcome } = answer({ session, optionKey: 'leak' }));
    if (outcome.kind !== 'dispatch') throw new Error('expected dispatch');
    expect(outcome.node.urgency).toBe('critical');
    expect(outcome.node.vendorTags).toContain('emergency');
  });

  it('slow-drain resolves self-service', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'plumbing' }));
    ({ session, outcome } = answer({ session, optionKey: 'slow-drain' }));
    if (outcome.kind !== 'self-service') throw new Error('expected self-service');
    expect(outcome.node.problemCode).toBe('plumbing.slow-drain');
  });

  it('hvac remote-dead path resolves self-service', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'hvac' }));
    ({ session, outcome } = answer({ session, optionKey: 'not-running' }));
    ({ session, outcome } = answer({ session, optionKey: 'no-display' }));
    if (outcome.kind !== 'self-service') throw new Error('expected self-service');
    expect(outcome.node.problemCode).toBe('hvac.remote-battery-dead');
  });

  it('hvac warm-air path suggests capacitor in parts list', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'hvac' }));
    ({ session, outcome } = answer({ session, optionKey: 'running-no-cool' }));
    if (outcome.kind !== 'dispatch') throw new Error('expected dispatch');
    expect(outcome.node.suggestedPartsList.some((p) => p.includes('capacitor'))).toBe(true);
  });

  it('hvac via remote-ok path also reaches warm-dispatch', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'hvac' }));
    ({ session, outcome } = answer({ session, optionKey: 'not-running' }));
    ({ session, outcome } = answer({ session, optionKey: 'display-ok' }));
    if (outcome.kind !== 'dispatch') throw new Error('expected dispatch');
    expect(outcome.node.problemCode).toBe('hvac.no-cooling');
  });
});

describe('answer — error handling', () => {
  it('throws on an unknown option key', () => {
    const { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    expect(() => answer({ session, optionKey: 'bogus' })).toThrow(/option "bogus"/);
  });

  it('throws when called on a terminal node', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'electrical' }));
    ({ session, outcome } = answer({ session, optionKey: 'zone' }));
    ({ session, outcome } = answer({ session, optionKey: 'yes' }));
    expect(() => answer({ session, optionKey: 'anything' })).toThrow(/terminal/);
  });
});

describe('session history bookkeeping', () => {
  it('records each turn with the question + chosen option', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session } = answer({ session, optionKey: 'electrical' }));
    expect(session.history).toHaveLength(1);
    expect(session.history[0]!.optionChosenKey).toBe('electrical');
    expect(session.history[0]!.optionChosenLabel).toContain('electrical');
  });

  it('history is appended immutably', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    const first = session.history;
    ({ session } = answer({ session, optionKey: 'electrical' }));
    expect(first).not.toBe(session.history);
    expect(first).toHaveLength(0);
  });
});

describe('buildWorkOrder', () => {
  it('produces a dispatch payload with transcript embedded', () => {
    let { session, outcome } = startSession(CTX);
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'electrical' }));
    ({ session, outcome } = answer({ session, optionKey: 'zone' }));
    ({ session, outcome } = answer({ session, optionKey: 'no' }));
    if (outcome.kind !== 'dispatch') throw new Error('expected dispatch');
    const order = buildWorkOrder({ session, dispatchNode: outcome.node });
    expect(order.tenantId).toBe('t-alpha');
    expect(order.customerId).toBe('c-1');
    expect(order.urgency).toBe('high');
    expect(order.problemCode).toBe('electrical.no-power-zone');
    expect(order.description).toContain('Initial report: no power in bedroom');
    expect(order.description).toContain('Diagnostic transcript');
    expect(order.triageTranscript).toHaveLength(3);
  });

  it('includes pre-ordered parts list', () => {
    let { session, outcome } = startSession({ ...CTX, initialReport: 'AC not cold' });
    expectQuestion(outcome);
    ({ session, outcome } = answer({ session, optionKey: 'hvac' }));
    ({ session, outcome } = answer({ session, optionKey: 'running-no-cool' }));
    if (outcome.kind !== 'dispatch') throw new Error('expected dispatch');
    const order = buildWorkOrder({ session, dispatchNode: outcome.node });
    expect(order.suggestedPartsList.length).toBeGreaterThan(0);
  });
});

describe('default tree integrity', () => {
  it('every option points to a valid node id', () => {
    const allIds = new Set(Object.keys(DEFAULT_TRIAGE_TREE.nodes));
    for (const node of Object.values(DEFAULT_TRIAGE_TREE.nodes)) {
      if (node.kind === 'question') {
        for (const opt of node.options) {
          expect(allIds.has(opt.nextNodeId)).toBe(true);
        }
      }
    }
  });

  it('rootNodeId resolves to a question node', () => {
    const root = DEFAULT_TRIAGE_TREE.nodes[DEFAULT_TRIAGE_TREE.rootNodeId];
    expect(root?.kind).toBe('question');
  });
});
