import { describe, it, expect } from 'vitest';
import {
  evaluatePermissionMode,
  renderPlanModePreview,
  PERMISSION_MODES,
  type PermissionModeContext,
} from '../permission-mode.js';
import {
  thinkExtended,
  type OrchestratorDeps,
  type OrchestratorRequest,
  type LLMRouter,
  type Dispatcher,
} from '../main-loop.js';
import { createHookChain } from '../hook-chain.js';
import { createInMemoryPlanStore } from '../plan.js';
import { createInMemorySessionStore } from '../checkpoint.js';
import {
  createContextBudget,
  createInMemoryToolSearch,
} from '../context-budget.js';
import { createInMemoryMemoryTool } from '../memory-tool.js';
import type { Decision, DispatchResult } from '../decision.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function ctxOf(mode: PermissionModeContext['currentMode']): PermissionModeContext {
  return { currentMode: mode, callerScopes: [] };
}

// ─────────────────────────────────────────────────────────────────────
// One pure-evaluator test per mode.
// ─────────────────────────────────────────────────────────────────────

describe('evaluatePermissionMode', () => {
  it('default — allow reads, ask elevated tiers', () => {
    expect(
      evaluatePermissionMode(ctxOf('default'), { riskTier: 'read' }).decision,
    ).toBe('allow');
    expect(
      evaluatePermissionMode(ctxOf('default'), { riskTier: 'mutate' }).decision,
    ).toBe('ask');
    expect(
      evaluatePermissionMode(ctxOf('default'), { riskTier: 'billing' }).decision,
    ).toBe('ask');
  });

  it('accept-edits — allow read+mutate, ask destroy/billing', () => {
    expect(
      evaluatePermissionMode(ctxOf('accept-edits'), { riskTier: 'mutate' }).decision,
    ).toBe('allow');
    expect(
      evaluatePermissionMode(ctxOf('accept-edits'), { riskTier: 'destroy' }).decision,
    ).toBe('ask');
  });

  it('plan — plan-preview for any mutation, allow reads', () => {
    expect(
      evaluatePermissionMode(ctxOf('plan'), { riskTier: 'read' }).decision,
    ).toBe('allow');
    const out = evaluatePermissionMode(ctxOf('plan'), { riskTier: 'mutate' });
    expect(out.decision).toBe('plan-preview');
  });

  it('auto — allow for all tiers', () => {
    expect(
      evaluatePermissionMode(ctxOf('auto'), { riskTier: 'destroy' }).decision,
    ).toBe('allow');
    expect(
      evaluatePermissionMode(ctxOf('auto'), { riskTier: 'external-comm' }).decision,
    ).toBe('allow');
  });

  it('dont-ask — deny anything that would ask', () => {
    expect(
      evaluatePermissionMode(ctxOf('dont-ask'), { riskTier: 'read' }).decision,
    ).toBe('allow');
    expect(
      evaluatePermissionMode(ctxOf('dont-ask'), { riskTier: 'billing' }).decision,
    ).toBe('deny');
  });

  it('bypass-permissions — short-circuit to allow on every tier', () => {
    expect(
      evaluatePermissionMode(ctxOf('bypass-permissions'), {
        riskTier: 'destroy',
      }).decision,
    ).toBe('allow');
  });

  it('tenant override wins over the current mode', () => {
    expect(
      evaluatePermissionMode(
        {
          currentMode: 'auto',
          tenantOverride: 'default',
          callerScopes: [],
        },
        { riskTier: 'mutate' },
      ).decision,
    ).toBe('ask');
  });

  it('PERMISSION_MODES enumerates all six modes', () => {
    expect(PERMISSION_MODES.length).toBe(6);
    expect(PERMISSION_MODES).toContain('plan');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Plan-mode integration — confirm no tool was actually invoked when the
// main-loop runs in plan mode.
// ─────────────────────────────────────────────────────────────────────

describe('main-loop plan-mode short-circuit', () => {
  function recordingDispatcher(): Dispatcher & { calls: Decision[] } {
    const calls: Decision[] = [];
    return {
      calls,
      async dispatch(decision: Decision): Promise<DispatchResult> {
        calls.push(decision);
        if (
          decision.kind === 'respond_to_owner' ||
          decision.kind === 'final'
        ) {
          return {
            kind: 'response',
            text: decision.text,
            tokensIn: 1,
            tokensOut: 1,
            usdCost: 0,
          };
        }
        if (decision.kind === 'tool_call') {
          return {
            kind: 'tool_ok',
            callId: decision.call.callId,
            output: { ran: true },
            latencyMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            usdCost: 0,
          };
        }
        return { kind: 'monitor_ack', watchId: 'w' };
      },
    };
  }

  function makeReq(): OrchestratorRequest {
    return {
      threadId: 'th',
      userMessage: 'evict the tenant',
      scope: {
        kind: 'tenant',
        tenantId: 't_1',
        actorUserId: 'u_1',
        roles: ['owner'],
        personaId: 'p_1',
      },
      tier: 'tenant',
      persona: 'evictor',
      budget: { maxTurns: 5 },
      permissionMode: 'plan',
    };
  }

  function makeDeps(
    router: LLMRouter,
    dispatcher: Dispatcher,
  ): OrchestratorDeps {
    return {
      router,
      toolSearch: createInMemoryToolSearch([]),
      hookChain: createHookChain([]),
      planStore: createInMemoryPlanStore(),
      sessionStore: createInMemorySessionStore(),
      memoryTool: createInMemoryMemoryTool(),
      contextBudget: createContextBudget(),
      dispatcher,
      toolRiskTier: () => 'destroy',
    };
  }

  it('plan-mode never dispatches a mutating tool', async () => {
    const dispatcher = recordingDispatcher();
    let routerCalled = 0;
    const router: LLMRouter = {
      async call(): Promise<Decision> {
        routerCalled += 1;
        if (routerCalled === 1) {
          return {
            kind: 'tool_call',
            call: { toolName: 'tenant.evict', input: { id: 'x' }, callId: 'c1' },
          };
        }
        return { kind: 'respond_to_owner', text: 'done' };
      },
    };
    const deps = makeDeps(router, dispatcher);
    await thinkExtended(makeReq(), deps);
    // The destructive tool_call MUST NOT have hit the dispatcher.
    const dispatched = dispatcher.calls.find(
      (d) => d.kind === 'tool_call' && d.call.toolName === 'tenant.evict',
    );
    expect(dispatched).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Preview rendering
// ─────────────────────────────────────────────────────────────────────

describe('renderPlanModePreview', () => {
  it('produces a stable preview block', () => {
    const out = renderPlanModePreview({
      toolName: 'tenant.evict',
      inputs: { id: 't_1', reason: 'arrears' },
      riskTier: 'destroy',
    });
    expect(out).toContain('plan-mode preview');
    expect(out).toContain('tenant.evict');
    expect(out).toContain('arrears');
  });
});
