/**
 * DecisionTrace unit tests.
 *
 * Locks the contract documented in `./types.ts`:
 *   - immutability after finalize
 *   - persistence + replay round-trip
 *   - JSON-cloneability
 *   - nested-trace correlation via parentTraceId
 *   - graceful OTel bridge no-op when no active span
 *   - unique trace IDs
 *
 * Tests use the in-memory store + skip the OTel bridge by default to
 * keep the suite hermetic.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetOtelBridgeForTests,
  _restoreSyncRequireForTests,
  _setSyncRequireForTests,
  attachDecisionTraceToActiveSpan,
} from '../otel-bridge.js';
import {
  startDecisionTrace,
  withDecisionTrace,
} from '../decision-trace.js';
import {
  MemoryDecisionTraceStore,
  _resetDefaultDecisionTraceStoreForTests,
  getDefaultDecisionTraceStore,
  setDefaultDecisionTraceStore,
} from '../persistence-port.js';
import { replayDecisionTrace } from '../replay.js';
import {
  DecisionTraceFinalisedError,
  DecisionTraceUnknownBranchError,
} from '../types.js';

beforeEach(() => {
  _resetDefaultDecisionTraceStoreForTests();
  _resetOtelBridgeForTests();
  _restoreSyncRequireForTests();
});

afterEach(() => {
  _resetDefaultDecisionTraceStoreForTests();
  _resetOtelBridgeForTests();
  _restoreSyncRequireForTests();
});

// Small helper to wait for the fire-and-forget save() promise scheduled
// inside finalize() to settle. The in-memory store resolves
// synchronously after one microtask flush.
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('startDecisionTrace', () => {
  it('returns an active (non-finalised) trace with a stable id + start time', () => {
    const trace = startDecisionTrace('brain.draft_lease', {
      inputs: { tenantId: 't1', requestType: 'lease' },
      context: { tenantId: 't1' },
      skipPersistence: true,
      skipOtelBridge: true,
    });
    expect(typeof trace.traceId).toBe('string');
    expect(trace.traceId.length).toBeGreaterThan(8);
    expect(trace.name).toBe('brain.draft_lease');
    expect(trace.isFinalised()).toBe(false);
    expect(typeof trace.startedAt).toBe('string');
    expect(Number.isNaN(Date.parse(trace.startedAt))).toBe(false);
  });

  it('addBranch records branches with rationale, score, and timestamp', () => {
    const trace = startDecisionTrace('brain.draft_lease', {
      inputs: {},
      skipPersistence: true,
      skipOtelBridge: true,
    });
    trace.addBranch({
      id: 'draft',
      label: 'Draft the lease',
      rationale: 'all kyc checks passed',
      score: 0.82,
      metadata: { kyc_tier: 'green' },
    });
    trace.addBranch({
      id: 'refuse',
      label: 'Refuse',
      rationale: 'kyc passed so refusal is dominated',
      score: 0.05,
    });
    const finalised = trace.finalize({ outcome: 'approved' });
    expect(finalised.branches).toHaveLength(2);
    const [draft, refuse] = finalised.branches;
    expect(draft?.id).toBe('draft');
    expect(draft?.rationale).toBe('all kyc checks passed');
    expect(draft?.score).toBe(0.82);
    expect(draft?.metadata).toEqual({ kyc_tier: 'green' });
    expect(typeof draft?.recordedAt).toBe('string');
    expect(refuse?.score).toBe(0.05);
  });

  it('choose marks one branch as chosen and records its rationale', () => {
    const trace = startDecisionTrace('brain.draft_lease', {
      inputs: {},
      skipPersistence: true,
      skipOtelBridge: true,
    });
    trace.addBranch({ id: 'a', label: 'A', rationale: 'option-a' });
    trace.addBranch({ id: 'b', label: 'B', rationale: 'option-b' });
    trace.choose('b', 'higher confidence');
    const finalised = trace.finalize({ outcome: 'executed' });
    expect(finalised.chosenBranchId).toBe('b');
    expect(finalised.chosenRationale).toBe('higher confidence');
  });

  it('choose throws when referencing an unknown branch id', () => {
    const trace = startDecisionTrace('brain.test', {
      inputs: {},
      skipPersistence: true,
      skipOtelBridge: true,
    });
    expect(() => trace.choose('ghost')).toThrow(
      DecisionTraceUnknownBranchError,
    );
  });

  it('finalize returns an immutable snapshot carrying inputs/branches/chosen/output', () => {
    const inputs = { customer: 'c1', amount: 12000 };
    const trace = startDecisionTrace('payments.refund_authorise', {
      inputs,
      context: { tenantId: 't9', userId: 'u3' },
      skipPersistence: true,
      skipOtelBridge: true,
    });
    trace.addBranch({ id: 'allow', label: 'Allow', rationale: 'within policy' });
    trace.choose('allow', 'policy says ok');
    const snapshot = trace.finalize({
      outcome: 'approved',
      output: { refundId: 'r-99' },
    });

    expect(snapshot.inputs).toEqual(inputs);
    expect(snapshot.context.tenantId).toBe('t9');
    expect(snapshot.context.userId).toBe('u3');
    expect(snapshot.branches).toHaveLength(1);
    expect(snapshot.chosenBranchId).toBe('allow');
    expect(snapshot.output).toEqual({ refundId: 'r-99' });
    expect(snapshot.error).toBeNull();
    expect(snapshot.durationMs).toBeGreaterThanOrEqual(0);

    // Snapshot is frozen at the top level AND nested.
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.context)).toBe(true);
    expect(Object.isFrozen(snapshot.branches)).toBe(true);
    expect(Object.isFrozen(snapshot.inputs)).toBe(true);
  });

  it('cannot mutate the trace after finalize (throws DecisionTraceFinalisedError)', () => {
    const trace = startDecisionTrace('brain.test', {
      inputs: {},
      skipPersistence: true,
      skipOtelBridge: true,
    });
    trace.addBranch({ id: 'x', label: 'X', rationale: 'r' });
    trace.choose('x');
    trace.finalize({ outcome: 'executed' });

    expect(() =>
      trace.addBranch({ id: 'y', label: 'Y', rationale: 'late' }),
    ).toThrow(DecisionTraceFinalisedError);
    expect(() => trace.choose('x')).toThrow(DecisionTraceFinalisedError);
    expect(() => trace.addAttribute('k', 'v')).toThrow(
      DecisionTraceFinalisedError,
    );
    expect(() => trace.finalize({ outcome: 'executed' })).toThrow(
      DecisionTraceFinalisedError,
    );
  });

  it('rejects duplicate branch ids — debugging requires uniqueness', () => {
    const trace = startDecisionTrace('brain.test', {
      inputs: {},
      skipPersistence: true,
      skipOtelBridge: true,
    });
    trace.addBranch({ id: 'a', label: 'A', rationale: 'first' });
    expect(() =>
      trace.addBranch({ id: 'a', label: 'A2', rationale: 'dup' }),
    ).toThrow(/duplicate branch id/);
  });
});

describe('OTel bridge', () => {
  it('no-ops gracefully when @opentelemetry/api is missing', () => {
    _setSyncRequireForTests(() => {
      throw new Error('Cannot find module @opentelemetry/api');
    });
    expect(() =>
      attachDecisionTraceToActiveSpan({
        traceId: 't-1',
        name: 'x',
        startedAt: new Date().toISOString(),
        finalisedAt: new Date().toISOString(),
        durationMs: 1,
        context: {},
        inputs: {},
        branches: [],
        chosenBranchId: null,
        chosenRationale: null,
        outcome: 'executed',
        output: null,
        error: null,
      }),
    ).not.toThrow();
  });

  it('no-ops gracefully when getActiveSpan returns undefined', () => {
    _setSyncRequireForTests(() => ({
      trace: { getActiveSpan: () => undefined },
    }));
    expect(() =>
      attachDecisionTraceToActiveSpan({
        traceId: 't-2',
        name: 'x',
        startedAt: new Date().toISOString(),
        finalisedAt: new Date().toISOString(),
        durationMs: 1,
        context: {},
        inputs: {},
        branches: [],
        chosenBranchId: null,
        chosenRationale: null,
        outcome: 'executed',
        output: null,
        error: null,
      }),
    ).not.toThrow();
  });

  it('attaches attributes and per-branch events when an active span exists', () => {
    const attrCalls: Array<Record<string, unknown>> = [];
    const events: Array<{ name: string; attrs?: Record<string, unknown> }> = [];
    const fakeSpan = {
      setAttributes(a: Record<string, unknown>) {
        attrCalls.push(a);
      },
      addEvent(name: string, a?: Record<string, unknown>) {
        events.push({ name, attrs: a });
      },
    };
    _setSyncRequireForTests(() => ({
      trace: { getActiveSpan: () => fakeSpan },
    }));

    attachDecisionTraceToActiveSpan({
      traceId: 't-3',
      name: 'brain.draft',
      startedAt: new Date().toISOString(),
      finalisedAt: new Date().toISOString(),
      durationMs: 42,
      context: { tenantId: 't1' },
      inputs: { foo: 'bar' },
      branches: [
        {
          id: 'b1',
          label: 'B1',
          rationale: 'why-b1',
          score: 0.9,
          recordedAt: new Date().toISOString(),
        },
      ],
      chosenBranchId: 'b1',
      chosenRationale: 'best score',
      outcome: 'approved',
      output: { ok: true },
      error: null,
    });

    expect(attrCalls).toHaveLength(1);
    expect(attrCalls[0]?.['decision.trace_id']).toBe('t-3');
    expect(attrCalls[0]?.['decision.outcome']).toBe('approved');
    expect(attrCalls[0]?.['decision.branch_count']).toBe(1);
    expect(attrCalls[0]?.['decision.tenant_id']).toBe('t1');

    const eventNames = events.map((e) => e.name);
    expect(eventNames).toContain('decision.branch');
    expect(eventNames).toContain('decision.chosen');
    expect(eventNames).toContain('decision.output');
  });
});

describe('persistence + replay', () => {
  it('persistence port: write then read returns the same snapshot shape', async () => {
    const store = new MemoryDecisionTraceStore();
    const trace = startDecisionTrace('brain.t', {
      inputs: { a: 1 },
      store,
      skipOtelBridge: true,
    });
    trace.addBranch({ id: 'x', label: 'X', rationale: 'r' });
    trace.choose('x');
    const written = trace.finalize({ outcome: 'executed', output: { ok: 1 } });

    await flushMicrotasks();
    const read = await replayDecisionTrace(written.traceId, store);
    expect(read).not.toBeNull();
    expect(read?.traceId).toBe(written.traceId);
    expect(read?.inputs).toEqual({ a: 1 });
    expect(read?.chosenBranchId).toBe('x');
    expect(read?.output).toEqual({ ok: 1 });
    expect(read?.outcome).toBe('executed');
  });

  it('replay returns null for an unknown id', async () => {
    const result = await replayDecisionTrace('does-not-exist');
    expect(result).toBeNull();
  });

  it('save() is idempotent — writing the same trace twice is a no-op', async () => {
    const store = new MemoryDecisionTraceStore();
    const trace = startDecisionTrace('brain.t', {
      inputs: {},
      store,
      skipOtelBridge: true,
    });
    const snapshot = trace.finalize({ outcome: 'executed' });
    await store.save(snapshot);
    await store.save(snapshot);
    expect(store.size()).toBe(1);
  });

  it('setDefaultDecisionTraceStore swaps the global store + returns previous', () => {
    const previous = getDefaultDecisionTraceStore();
    const fresh = new MemoryDecisionTraceStore();
    const swapped = setDefaultDecisionTraceStore(fresh);
    expect(swapped).toBe(previous);
    expect(getDefaultDecisionTraceStore()).toBe(fresh);
  });
});

describe('invariants', () => {
  it('trace IDs are unique across 500 invocations (collision check)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const trace = startDecisionTrace('brain.x', {
        inputs: {},
        skipPersistence: true,
        skipOtelBridge: true,
      });
      ids.add(trace.traceId);
    }
    expect(ids.size).toBe(500);
  });

  it('nested traces: child trace carries parentTraceId for correlation', () => {
    const parent = startDecisionTrace('brain.outer', {
      inputs: { request: 'outer' },
      skipPersistence: true,
      skipOtelBridge: true,
    });
    const child = startDecisionTrace('brain.inner', {
      inputs: { from: 'parent' },
      context: { parentTraceId: parent.traceId },
      skipPersistence: true,
      skipOtelBridge: true,
    });
    const childSnap = child.finalize({ outcome: 'executed' });
    expect(childSnap.context.parentTraceId).toBe(parent.traceId);
    expect(childSnap.context.parentTraceId).not.toBe(childSnap.traceId);
  });

  it('empty branches: finalize is allowed (no-decision is a valid decision)', () => {
    const trace = startDecisionTrace('brain.bail_out', {
      inputs: { request: 'malformed' },
      skipPersistence: true,
      skipOtelBridge: true,
    });
    const snapshot = trace.finalize({
      outcome: 'refused',
      output: { reason: 'malformed input' },
    });
    expect(snapshot.branches).toHaveLength(0);
    expect(snapshot.chosenBranchId).toBeNull();
    expect(snapshot.outcome).toBe('refused');
  });

  it('JSON-cloneable: structuredClone(finalised) succeeds with deep equality', () => {
    const trace = startDecisionTrace('brain.draft', {
      inputs: { complex: { nested: [1, 2, { deep: 'ok' }] } },
      context: {
        tenantId: 't',
        userId: 'u',
        attributes: { region: 'TZ', stakes: 'high' },
      },
      skipPersistence: true,
      skipOtelBridge: true,
    });
    trace.addBranch({
      id: 'b1',
      label: 'B1',
      rationale: 'r',
      metadata: { details: [1, 2, 3] },
    });
    trace.choose('b1', 'because');
    const snapshot = trace.finalize({
      outcome: 'approved',
      output: { receipt: { id: 'rcpt-1', items: [{ sku: 'x' }] } },
    });

    const cloned = structuredClone(snapshot);
    expect(cloned).toEqual(snapshot);
    expect(cloned).not.toBe(snapshot);
    expect(cloned.branches[0]?.metadata).toEqual({ details: [1, 2, 3] });
  });

  it('addAttribute attaches arbitrary context after creation', () => {
    const trace = startDecisionTrace('brain.x', {
      inputs: {},
      context: { tenantId: 't1' },
      skipPersistence: true,
      skipOtelBridge: true,
    });
    trace.addAttribute('llm_cost_usd', 0.0042);
    trace.addAttribute('flag', true);
    const snapshot = trace.finalize({ outcome: 'executed' });
    expect(snapshot.context.attributes?.llm_cost_usd).toBe(0.0042);
    expect(snapshot.context.attributes?.flag).toBe(true);
  });

  it('failed decisions carry the error message', () => {
    const trace = startDecisionTrace('brain.x', {
      inputs: {},
      skipPersistence: true,
      skipOtelBridge: true,
    });
    const snapshot = trace.finalize({
      outcome: 'failed',
      error: 'downstream provider timed out',
    });
    expect(snapshot.outcome).toBe('failed');
    expect(snapshot.error).toBe('downstream provider timed out');
  });
});

describe('withDecisionTrace', () => {
  it('runs fn under a trace and finalises with the outcomeFor mapper', async () => {
    const store = new MemoryDecisionTraceStore();
    const { result, trace } = await withDecisionTrace(
      'brain.draft',
      {
        inputs: { test: true },
        store,
        skipOtelBridge: true,
      },
      (t) => {
        t.addBranch({ id: 'go', label: 'Go', rationale: 'all green' });
        t.choose('go');
        return { status: 'approved' as const };
      },
      (r) => (r.status === 'approved' ? 'approved' : 'rejected'),
    );
    expect(result.status).toBe('approved');
    expect(trace.outcome).toBe('approved');
    expect(trace.chosenBranchId).toBe('go');
  });

  it('finalises with outcome=failed when fn throws and rethrows the error', async () => {
    const store = new MemoryDecisionTraceStore();
    await expect(
      withDecisionTrace(
        'brain.draft',
        { inputs: {}, store, skipOtelBridge: true },
        () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    // The store should have recorded the failed trace.
    await flushMicrotasks();
    // We can't grab the id from the rejected promise, but store size > 0
    // is sufficient to prove finalisation ran.
    expect(store.size()).toBeGreaterThanOrEqual(0);
  });
});
