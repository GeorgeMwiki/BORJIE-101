/**
 * mcts-tool-search.test.ts — asserts the wrapper composes correctly with
 * mocked PRM + mocked dispatcher. Black-box: no peek into the package
 * internals beyond the public surface.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  ExpansionFn,
  Observation,
  PrmContext,
  PrmFn,
  ReasoningState,
  ReasoningStep,
  SimulationStepFn,
} from '@borjie/process-reward-model';

import {
  createMctsToolSearch,
  mctsToolSearch,
  type DispatchedToolPath,
  type ToolDispatcher,
} from '../mcts-tool-search.js';

const ctx: PrmContext = Object.freeze({
  tenantId: 't1',
  scopeKind: null,
  scopeId: null,
  autonomyTier: 1,
  killswitchActive: false,
  domainHints: Object.freeze({}),
});

const fakePrm: PrmFn = (input) => {
  const cites = (input.candidateStep.args['citations'] ?? []) as ReadonlyArray<unknown>;
  const score = Array.isArray(cites) && cites.length > 0 ? 0.85 : 0.4;
  return Object.freeze({
    score,
    confidence: 0.7,
    signals: Object.freeze([]),
    explanation: 'fake',
  });
};

let stepCounter = 0;

const fakeExpander: ExpansionFn = (parent, width) => {
  if (parent.depth >= 2) return [];
  const out: Array<ReasoningStep> = [];
  for (let i = 0; i < Math.min(width, 2); i += 1) {
    stepCounter += 1;
    out.push(
      Object.freeze({
        id: `step-${String(stepCounter)}`,
        kind: 'tool_call' as const,
        toolName: 'submit',
        args: Object.freeze({ citations: i === 0 ? ['doc'] : [] }),
        rationale: 'mock',
      }),
    );
  }
  return out;
};

const fakeStep: SimulationStepFn = (state, step) => {
  const obs: Observation = Object.freeze({
    stepId: step.id,
    success: true,
    summary: 'ok',
    schemaValid: true,
  });
  const nextState: ReasoningState = Object.freeze({
    ...state,
    steps: Object.freeze([...state.steps, step]),
    observations: Object.freeze([...state.observations, obs]),
    depth: state.depth + 1,
    terminal: state.depth + 1 >= 2,
  });
  return { nextState, observation: obs };
};

function makeDispatcher(): {
  readonly dispatcher: ToolDispatcher;
  readonly replay: ReturnType<typeof vi.fn>;
} {
  const replay = vi.fn(
    async (path: ReadonlyArray<ReasoningStep>): Promise<DispatchedToolPath> => {
      return Object.freeze({
        steps: path,
        observations: Object.freeze(
          path.map((s) => ({
            stepId: s.id,
            success: true,
            summary: 'dispatched',
            schemaValid: true,
          })),
        ),
        success: true,
      });
    },
  );
  return {
    dispatcher: Object.freeze({ replay }),
    replay,
  };
}

describe('createMctsToolSearch', () => {
  it('runs the search, replays the path, and emits an audit payload', async () => {
    stepCounter = 0;
    const { dispatcher, replay } = makeDispatcher();
    const fn = createMctsToolSearch({
      prm: fakePrm,
      expander: fakeExpander,
      stepFn: fakeStep,
      dispatcher,
      now: () => 0,
      nowIso: () => '2026-05-26T00:00:00Z',
    });
    const out = await fn({
      intent: { intentKind: 'file_royalty', turnId: 'turn-1' },
      context: ctx,
      budget: { rollouts: 4, maxDepth: 2, maxWidth: 2 },
    });

    expect(replay).toHaveBeenCalledTimes(1);
    expect(out.searchResult.rolloutsRun).toBeLessThanOrEqual(4);
    expect(out.dispatchedPath.success).toBe(true);
    expect(out.auditPayload.kind).toBe('mcts_reasoning_search');
    expect(out.auditPayload.payload.tenant_id).toBe('t1');
    expect(out.auditPayload.payload.turn_id).toBe('turn-1');
    expect(out.auditPayload.payload.intent_kind).toBe('file_royalty');
  });

  it('uses default budget when none is supplied', async () => {
    stepCounter = 0;
    const { dispatcher, replay } = makeDispatcher();
    const fn = createMctsToolSearch({
      prm: fakePrm,
      expander: fakeExpander,
      stepFn: fakeStep,
      dispatcher,
      now: () => 0,
      nowIso: () => 'iso',
    });
    const out = await fn({
      intent: { intentKind: 'file', turnId: 'turn-2' },
      context: ctx,
    });
    expect(replay).toHaveBeenCalled();
    expect(out.auditPayload.payload.tree_size).toBeGreaterThan(0);
  });

  it('emits a stable selected_path_hash for identical paths', async () => {
    stepCounter = 0;
    const { dispatcher } = makeDispatcher();
    const fn = createMctsToolSearch({
      prm: fakePrm,
      expander: fakeExpander,
      stepFn: fakeStep,
      dispatcher,
      now: () => 0,
      nowIso: () => 'iso',
      hashPath: (steps) => `hash:${steps.length}`,
    });
    const out = await fn({
      intent: { intentKind: 'file', turnId: 'turn-3' },
      context: ctx,
      budget: { rollouts: 2 },
    });
    expect(out.auditPayload.payload.selected_path_hash).toMatch(/^hash:/);
  });
});

describe('mctsToolSearch (one-shot convenience)', () => {
  it('forwards to the bound function with intent + context + budget', async () => {
    stepCounter = 0;
    const { dispatcher } = makeDispatcher();
    const bound = createMctsToolSearch({
      prm: fakePrm,
      expander: fakeExpander,
      stepFn: fakeStep,
      dispatcher,
      now: () => 0,
      nowIso: () => 'iso',
    });
    const result = await mctsToolSearch(
      bound,
      { intentKind: 'file', turnId: 'turn-4' },
      ctx,
      { rollouts: 3, maxDepth: 2, maxWidth: 2 },
    );
    expect(result.dispatchedPath.success).toBe(true);
  });

  it('omits the budget when undefined', async () => {
    stepCounter = 0;
    const { dispatcher } = makeDispatcher();
    const bound = createMctsToolSearch({
      prm: fakePrm,
      expander: fakeExpander,
      stepFn: fakeStep,
      dispatcher,
      now: () => 0,
      nowIso: () => 'iso',
    });
    const result = await mctsToolSearch(
      bound,
      { intentKind: 'file', turnId: 'turn-5' },
      ctx,
    );
    expect(result.auditPayload.kind).toBe('mcts_reasoning_search');
  });
});
