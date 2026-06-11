/**
 * Modality arbiter (COG-07/AUT-14) — main-loop integration tests.
 *
 * Proves:
 *  - Default-OFF: with NO arbiter dep the loop is byte-identical to today
 *    (the regression guard for the safe path).
 *  - Wired: a turn whose router emits a tool_call BUT matches a learned
 *    skill produces a `run_skill` Decision that still flows through the
 *    hook chain (a four-eye-style hook still fires).
 *  - Rail not bypassed: a money tool_call that the arbiter keeps as `action`
 *    reaches the dispatcher AS a tool_call (the existing gate path), the
 *    arbiter never turns it into an auto higher-order modality.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  think,
  type OrchestratorDeps,
  type OrchestratorRequest,
  type LLMRouter,
  type Dispatcher,
} from '../main-loop.js';
import { createHookChain, type Hook } from '../hook-chain.js';
import { createInMemoryPlanStore } from '../plan.js';
import { createInMemorySessionStore } from '../checkpoint.js';
import {
  createContextBudget,
  createInMemoryToolSearch,
} from '../context-budget.js';
import { createInMemoryMemoryTool } from '../memory-tool.js';
import type { Decision, DispatchResult } from '../decision.js';
import { createModalityArbiter } from '../modality-arbiter.js';
import type { ModalityArbiter } from '../modality-arbiter-types.js';

function fixedRouter(decisions: Decision[]): LLMRouter {
  let i = 0;
  return {
    async call(): Promise<Decision> {
      const next = decisions[i] ?? { kind: 'final', text: 'done' };
      i += 1;
      return next;
    },
  };
}

function recordingDispatcher(): Dispatcher & { calls: Decision[] } {
  const calls: Decision[] = [];
  return {
    calls,
    async dispatch(decision: Decision): Promise<DispatchResult> {
      calls.push(decision);
      switch (decision.kind) {
        case 'tool_call':
          return {
            kind: 'tool_ok',
            callId: decision.call.callId,
            output: { ran: decision.call.toolName },
            latencyMs: 1,
            tokensIn: 1,
            tokensOut: 1,
            usdCost: 0,
          };
        case 'respond_to_owner':
        case 'final':
          return { kind: 'response', text: decision.text, tokensIn: 1, tokensOut: 1, usdCost: 0 };
        case 'run_skill':
          return { kind: 'skill_ack', skillId: decision.skillId };
        case 'run_modality':
          return { kind: 'modality_ack', modality: decision.modality };
        default:
          return { kind: 'monitor_ack', watchId: 'w' };
      }
    },
  };
}

function makeReq(): OrchestratorRequest {
  return {
    threadId: 'thread_arb',
    userMessage: 'recover the tenant arrears',
    scope: { kind: 'tenant', tenantId: 't_1', actorUserId: 'u_1', roles: ['owner'], personaId: 'p_1' },
    tier: 'tenant',
    persona: 'arrears-advisor',
    grantedScopes: ['arrears.read', 'money.transfer'],
    budget: { maxTurns: 4 },
  };
}

function makeDeps(
  router: LLMRouter,
  dispatcher: Dispatcher,
  opts: { hooks?: Hook[]; arbiter?: ModalityArbiter } = {},
): OrchestratorDeps {
  return {
    router,
    toolSearch: createInMemoryToolSearch([
      { name: 'arrears.lookup', description: 'arrears lookup', keywords: ['arrears'] },
    ]),
    hookChain: createHookChain(opts.hooks ?? []),
    planStore: createInMemoryPlanStore(),
    sessionStore: createInMemorySessionStore(),
    memoryTool: createInMemoryMemoryTool(),
    contextBudget: createContextBudget(),
    dispatcher,
    ...(opts.arbiter ? { modalityArbiter: opts.arbiter } : {}),
  };
}

describe('main-loop × modality arbiter — default OFF', () => {
  it('arbiter ABSENT → tool_call dispatches unchanged (byte-identical path)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      { kind: 'tool_call', call: { toolName: 'arrears.lookup', input: {}, callId: 'c1' } },
      { kind: 'final', text: 'done' },
    ]);
    const out = await think(makeReq(), makeDeps(router, dispatcher));
    expect(out.kind).toBe('answer');
    // The dispatcher saw the ORIGINAL tool_call — no lift, no run_skill.
    expect(dispatcher.calls.some((c) => c.kind === 'tool_call')).toBe(true);
    expect(dispatcher.calls.some((c) => c.kind === 'run_skill')).toBe(false);
  });
});

describe('main-loop × modality arbiter — wired', () => {
  it('a tool_call matching a learned skill is LIFTED to run_skill and still hits the hook chain', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      { kind: 'tool_call', call: { toolName: 'arrears.lookup', input: { tenantId: 't_1' }, callId: 'c1' } },
      { kind: 'final', text: 'done' },
    ]);
    // A pre-tool-use hook that records every decision it sees — proves the
    // lifted run_skill still flows through the 9-hook chain.
    const seen: string[] = [];
    const recordHook: Hook = {
      name: 'record',
      stage: 'pre-tool-use',
      async fn(_ctx, decision) {
        seen.push(decision.kind);
        return { kind: 'allow' };
      },
    };
    const arbiter = createModalityArbiter({
      embedder: { embed: vi.fn(async () => [1, 0, 0]) },
      skillRetriever: {
        retrieve: vi.fn(async () => [
          { skillId: 's_arrears', score: 0.95, humanReviewed: true, status: 'active' as const },
        ]),
      },
    });
    const out = await think(makeReq(), makeDeps(router, dispatcher, { hooks: [recordHook], arbiter }));
    expect(out.kind).toBe('answer');
    // The arbiter lifted the tool_call → run_skill; the dispatcher ran it.
    expect(dispatcher.calls.some((c) => c.kind === 'run_skill')).toBe(true);
    // The hook chain saw the lifted run_skill (rail not bypassed).
    expect(seen).toContain('run_skill');
  });

  it('rail not bypassed: a money tool_call with no skill/flow match stays a tool_call', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      { kind: 'tool_call', call: { toolName: 'money.transfer', input: { amount: 100 }, callId: 'm1' } },
      { kind: 'final', text: 'done' },
    ]);
    // The four-eye-style hook that gates money — proves a money action still
    // reaches the gate as a tool_call (the arbiter never auto-routes it away).
    let gatedToolName = '';
    const moneyGate: Hook = {
      name: 'money-gate',
      stage: 'pre-tool-use',
      async fn(_ctx, decision) {
        if (decision.kind === 'tool_call' && decision.call.toolName.startsWith('money.')) {
          gatedToolName = decision.call.toolName;
          return { kind: 'ask-owner', prompt: 'approve money transfer?', channel: 'inbox' };
        }
        return { kind: 'allow' };
      },
    };
    // Arbiter wired but NO skill/flow matches → Tier-0/1 keep it as `action`,
    // no lift; the money tool_call reaches the four-eye gate unchanged.
    const arbiter = createModalityArbiter({
      embedder: { embed: vi.fn(async () => [1, 0, 0]) },
      skillRetriever: { retrieve: vi.fn(async () => []) },
      flowRetriever: { retrieve: vi.fn(async () => []) },
    });
    const out = await think(makeReq(), makeDeps(router, dispatcher, { hooks: [moneyGate], arbiter }));
    // The loop returned ask-approval — the rail held.
    expect(out.kind).toBe('ask-approval');
    expect(gatedToolName).toBe('money.transfer');
    // The dispatcher NEVER ran the money call (it was gated before dispatch),
    // and it was never lifted to a higher-order modality.
    expect(dispatcher.calls.some((c) => c.kind === 'run_modality')).toBe(false);
    expect(dispatcher.calls.some((c) => c.kind === 'run_skill')).toBe(false);
  });
});
