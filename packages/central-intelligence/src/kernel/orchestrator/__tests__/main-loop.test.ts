import { describe, it, expect } from 'vitest';
import {
  think,
  thinkExtended,
  type OrchestratorDeps,
  type OrchestratorRequest,
  type LLMRouter,
  type Dispatcher,
} from '../main-loop.js';
import { createHookChain, type Hook } from '../hook-chain.js';
import {
  createPlan,
  createInMemoryPlanStore,
  type PlanGoal,
} from '../plan.js';
import { createInMemorySessionStore } from '../checkpoint.js';
import {
  createContextBudget,
  createInMemoryToolSearch,
} from '../context-budget.js';
import { createInMemoryMemoryTool } from '../memory-tool.js';
import type { Decision, DispatchResult } from '../decision.js';
import { createLedgerSealHook, createInMemoryLedgerSeal } from '../hooks/stop/ledger-seal-hook.js';
import { createPermissionHook } from '../hooks/pre-tool-use/permission-hook.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function fixedRouter(decisions: Decision[]): LLMRouter {
  let i = 0;
  return {
    async call(): Promise<Decision> {
      const next = decisions[i] ?? { kind: 'final', text: 'no more decisions' };
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
      if (decision.kind === 'tool_call') {
        return {
          kind: 'tool_ok',
          callId: decision.call.callId,
          output: { ran: decision.call.toolName },
          latencyMs: 1,
          tokensIn: 10,
          tokensOut: 10,
          usdCost: 0,
        };
      }
      if (
        decision.kind === 'respond_to_owner' ||
        decision.kind === 'final'
      ) {
        return {
          kind: 'response',
          text: decision.text,
          tokensIn: 5,
          tokensOut: 5,
          usdCost: 0,
        };
      }
      if (decision.kind === 'schedule_wake') {
        return { kind: 'wake_ack', resumeToken: decision.wake.wakeAt };
      }
      if (decision.kind === 'spawn_sub_md') {
        return {
          kind: 'spawn_ack',
          subMdId: decision.spawn.subMdId,
          handoffToken: 'h_1',
        };
      }
      return { kind: 'monitor_ack', watchId: 'w_1' };
    },
  };
}

function makeReq(): OrchestratorRequest {
  return {
    threadId: 'thread_test',
    userMessage: 'Tell me about arrears.',
    scope: {
      kind: 'tenant',
      tenantId: 't_1',
      actorUserId: 'u_1',
      roles: ['owner'],
      personaId: 'p_1',
    },
    tier: 'tenant',
    persona: 'arrears-advisor',
    grantedScopes: ['arrears.read'],
    budget: { maxTurns: 5 },
  };
}

function makeDeps(
  router: LLMRouter,
  dispatcher: Dispatcher,
  hooks: Hook[] = [],
  plan?: ReadonlyArray<PlanGoal>,
): OrchestratorDeps {
  const planStore = createInMemoryPlanStore();
  if (plan) {
    // Hydrate the in-memory plan store with a seeded plan.
    planStore.load('thread_test');
    planStore.save(createPlan('thread_test', plan));
  }
  return {
    router,
    toolSearch: createInMemoryToolSearch([
      {
        name: 'arrears.lookup',
        description: 'arrears lookup',
        keywords: ['arrears'],
      },
    ]),
    hookChain: createHookChain(hooks),
    planStore,
    sessionStore: createInMemorySessionStore(),
    memoryTool: createInMemoryMemoryTool(),
    contextBudget: createContextBudget(),
    dispatcher,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('main-loop think()', () => {
  it('answers immediately when the model emits respond_to_owner', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      { kind: 'respond_to_owner', text: 'arrears: $0' },
    ]);
    const deps = makeDeps(router, dispatcher);
    const out = await think(makeReq(), deps);
    expect(out.kind).toBe('answer');
    if (out.kind === 'answer') expect(out.text).toBe('arrears: $0');
    expect(dispatcher.calls.length).toBe(1);
  });

  it('runs a pre-hook deny and skips dispatch', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      {
        kind: 'tool_call',
        call: { toolName: 'tenant.write', input: {}, callId: 'c1' },
      },
      { kind: 'respond_to_owner', text: 'cannot' },
    ]);
    const deps = makeDeps(router, dispatcher, [
      createPermissionHook({
        scopes: { requiredScopes: () => ['tenants.write'] },
      }),
    ]);
    const out = await think(makeReq(), deps);
    expect(out.kind).toBe('answer');
    // The denied tool_call must NOT have been dispatched.
    expect(dispatcher.calls.find((d) => d.kind === 'tool_call')).toBeUndefined();
  });

  it('halts with budget-exhausted when maxTurns is reached', async () => {
    const dispatcher = recordingDispatcher();
    // Always reply with the same tool_call so the loop never terminates.
    const router: LLMRouter = {
      async call(): Promise<Decision> {
        return {
          kind: 'tool_call',
          call: { toolName: 'noop', input: {}, callId: 'c' },
        };
      },
    };
    const deps = makeDeps(router, dispatcher);
    const req: OrchestratorRequest = { ...makeReq(), budget: { maxTurns: 3 } };
    const out = await think(req, deps);
    expect(out.kind).toBe('budget-exhausted');
    if (out.kind === 'budget-exhausted') expect(out.axis).toBe('turns');
  });

  it('returns ask-approval when a hook asks for owner sign-off', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      {
        kind: 'tool_call',
        call: { toolName: 'tenant.evict', input: {}, callId: 'c1' },
      },
    ]);
    const askHook: Hook = {
      name: 'ask',
      stage: 'pre-tool-use',
      async fn() {
        return {
          kind: 'ask-owner',
          channel: 'inbox',
          prompt: 'Confirm eviction',
        };
      },
    };
    const deps = makeDeps(router, dispatcher, [askHook]);
    const out = await think(makeReq(), deps);
    expect(out.kind).toBe('ask-approval');
    if (out.kind === 'ask-approval') {
      expect(out.channel).toBe('inbox');
      expect(out.prompt).toContain('Confirm');
    }
  });

  it('runs the stop chain when a final response is emitted', async () => {
    const dispatcher = recordingDispatcher();
    const ledger = createInMemoryLedgerSeal();
    const router = fixedRouter([
      { kind: 'respond_to_owner', text: 'bye' },
    ]);
    const deps = makeDeps(router, dispatcher, [
      createLedgerSealHook({ ledger }),
    ]);
    await think(makeReq(), deps);
    expect(ledger.seals.length).toBe(1);
    expect(ledger.seals[0]?.threadId).toBe('thread_test');
  });

  // ─────────────────────────────────────────────────────────────────
  // Gap-5 — background sub-MD spawn: SubagentStart fires, parent
  // continues, SubagentStop fires asynchronously (modeled here as
  // back-to-back invocations because the in-memory dispatcher returns
  // spawn_ack synchronously).
  // ─────────────────────────────────────────────────────────────────
  it('background sub-MD spawn fires SubagentStart and SubagentStop', async () => {
    const dispatcher = recordingDispatcher();
    let startedCount = 0;
    let stoppedCount = 0;
    const startHook: Hook = {
      name: 'sub-start',
      stage: 'subagent-start',
      async fn() {
        startedCount += 1;
        return { kind: 'allow' };
      },
    };
    const stopHook: Hook = {
      name: 'sub-stop',
      stage: 'subagent-stop',
      async fn() {
        stoppedCount += 1;
        return { kind: 'allow' };
      },
    };
    const router = fixedRouter([
      {
        kind: 'spawn_sub_md',
        spawn: {
          subMdId: 'sm_bg',
          scope: {
            kind: 'tenant',
            tenantId: 't_1',
            actorUserId: 'u_1',
            roles: ['owner'],
            personaId: 'p_1',
          },
          initialInput: { task: 'check-arrears' },
          persona: 'arrears',
          background: true,
        },
      },
      { kind: 'respond_to_owner', text: 'parent continued' },
    ]);
    const deps = makeDeps(router, dispatcher, [startHook, stopHook]);
    const out = await think(makeReq(), deps);
    expect(startedCount).toBe(1);
    expect(stoppedCount).toBe(1);
    // The parent did continue past the spawn and answered.
    expect(out.kind).toBe('answer');
    if (out.kind === 'answer') expect(out.text).toBe('parent continued');
  });

  // ─────────────────────────────────────────────────────────────────
  // Plan-mode short-circuit — destructive tool is never dispatched.
  // ─────────────────────────────────────────────────────────────────
  it('plan-mode short-circuits a destructive tool', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      {
        kind: 'tool_call',
        call: {
          toolName: 'tenant.delete',
          input: { id: 't_1' },
          callId: 'cdel',
        },
      },
      { kind: 'respond_to_owner', text: 'never reached' },
    ]);
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
      toolRiskTier: () => 'destroy',
    };
    const req: OrchestratorRequest = { ...makeReq(), permissionMode: 'plan' };
    const out = await thinkExtended(req, deps);
    expect(out.kind).toBe('plan-preview');
    if (out.kind === 'plan-preview') {
      expect(out.preview).toContain('tenant.delete');
    }
    // Crucially, the tool MUST NOT have been dispatched.
    expect(
      dispatcher.calls.find(
        (d) => d.kind === 'tool_call' && d.call.toolName === 'tenant.delete',
      ),
    ).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────
  // CRITICAL #3 regression — plan-mode propagates to spawn_sub_md.
  // ─────────────────────────────────────────────────────────────────
  it('plan-mode short-circuits a spawn_sub_md decision (CRITICAL #3)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      {
        kind: 'spawn_sub_md',
        spawn: {
          subMdId: 'eviction.coordinator',
          scope: {
            kind: 'tenant',
            tenantId: 't_1',
            actorUserId: 'u_1',
            roles: ['owner'],
            personaId: 'p_1',
          },
          initialInput: { caseId: 'c_1' },
          persona: 'eviction-coordinator',
          prompt: 'Begin the eviction workflow',
          background: false,
        },
      },
      { kind: 'respond_to_owner', text: 'never reached' },
    ]);
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
    };
    const req: OrchestratorRequest = { ...makeReq(), permissionMode: 'plan' };
    const out = await thinkExtended(req, deps);
    // The spawn must short-circuit to a plan-preview, NOT dispatch.
    expect(out.kind).toBe('plan-preview');
    // No spawn must have hit the dispatcher.
    expect(
      dispatcher.calls.find((d) => d.kind === 'spawn_sub_md'),
    ).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────
  // HIGH-A regression — Decision.kind === 'monitor' yields ack-schedule.
  // ─────────────────────────────────────────────────────────────────
  it("yields ack-schedule when the model emits Decision.kind === 'monitor' (HIGH-A)", async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      {
        kind: 'monitor',
        watch: {
          watchId: 'w_arrears',
          predicate: 'arrears > 100k',
          timeoutMs: 86_400_000,
        },
      },
      { kind: 'respond_to_owner', text: 'after-watch' },
    ]);
    const deps = makeDeps(router, dispatcher);
    const out = await think(makeReq(), deps);
    expect(out.kind).toBe('ack-schedule');
    if (out.kind === 'ack-schedule') {
      expect(out.resumeToken).toBe('monitor:w_arrears');
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // C2 regression — bypass-permissions emits warning + audit row.
  // ─────────────────────────────────────────────────────────────────
  it('emits a warning + sovereign-ledger row whenever bypass-permissions is active (C2)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([{ kind: 'respond_to_owner', text: 'ok' }]);
    const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const audited: Array<{
      threadId: string;
      tenantId: string | null;
      mode: string;
    }> = [];
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
      logger: {
        info: () => undefined,
        warn: (msg, meta) => {
          warnings.push({ msg, meta });
        },
      },
      bypassPermissionsAudit: {
        async recordBypassActive(args) {
          audited.push({
            threadId: args.threadId,
            tenantId: args.tenantId,
            mode: args.mode,
          });
        },
      },
    };
    const req: OrchestratorRequest = {
      ...makeReq(),
      permissionMode: 'bypass-permissions',
    };
    await thinkExtended(req, deps);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]?.msg).toContain('bypass-permissions');
    expect(audited.length).toBe(1);
    expect(audited[0]?.threadId).toBe('thread_test');
    expect(audited[0]?.tenantId).toBe('t_1');
    expect(audited[0]?.mode).toBe('bypass-permissions');
  });

  it('emits a bypass audit row even when the tenant override flips to bypass (C2)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([{ kind: 'respond_to_owner', text: 'ok' }]);
    const audited: Array<{ tenantOverride: boolean }> = [];
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
      bypassPermissionsAudit: {
        async recordBypassActive(args) {
          audited.push({ tenantOverride: args.tenantOverride });
        },
      },
    };
    const req: OrchestratorRequest = {
      ...makeReq(),
      permissionMode: 'default',
      tenantPermissionModeOverride: 'bypass-permissions',
    };
    await thinkExtended(req, deps);
    expect(audited.length).toBe(1);
    expect(audited[0]?.tenantOverride).toBe(true);
  });

  it('does NOT emit a bypass audit row in non-bypass modes (C2 false-positive guard)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([{ kind: 'respond_to_owner', text: 'ok' }]);
    const audited: Array<unknown> = [];
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
      bypassPermissionsAudit: {
        async recordBypassActive() {
          audited.push(1);
        },
      },
    };
    await think(makeReq(), deps);
    expect(audited.length).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────
  // H1 regression — permission-mode deny path caps retries instead of
  // burning the entire turn budget.
  // ─────────────────────────────────────────────────────────────────
  it('halts with stopped after maxPermissionDenyRetries consecutive permission-mode denies (H1)', async () => {
    const dispatcher = recordingDispatcher();
    // Router always returns the same denied tool — without H1's cap
    // the loop would spin until budget-exhausted.
    const router: LLMRouter = {
      async call(): Promise<Decision> {
        return {
          kind: 'tool_call',
          call: { toolName: 'tenant.evict', input: {}, callId: 'c' },
        };
      },
    };
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
      // Tier is mutate; tenant is in dont-ask mode → deny.
      toolRiskTier: () => 'mutate',
      maxPermissionDenyRetries: 1,
    };
    const req: OrchestratorRequest = {
      ...makeReq(),
      permissionMode: 'dont-ask',
      budget: { maxTurns: 20 },
    };
    const out = await thinkExtended(req, deps);
    expect(out.kind).toBe('stopped');
    if (out.kind === 'stopped') {
      expect(out.reason).toContain('permission-mode-deny');
    }
    // No tool_call must have reached the dispatcher.
    expect(dispatcher.calls.find((d) => d.kind === 'tool_call')).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────
  // H4 regression — a lifecycle-hook deny (user-prompt-submit, session-
  // start, pre-compact, etc.) MUST fire the stop chain before
  // surfacing the terminal response so the ledger seal still runs.
  // ─────────────────────────────────────────────────────────────────
  it('runs runStop when user-prompt-submit denies a hostile prompt (H4)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([{ kind: 'respond_to_owner', text: 'never' }]);
    let stopCount = 0;
    const stopHook: Hook = {
      name: 'stop-counter',
      stage: 'stop',
      async fn() {
        stopCount += 1;
        return { kind: 'allow' };
      },
    };
    const promptDenyHook: Hook = {
      name: 'hostile-prompt-filter',
      stage: 'user-prompt-submit',
      async fn() {
        return { kind: 'deny', code: 'hostile-prompt', reason: 'blocked' };
      },
    };
    const deps = makeDeps(router, dispatcher, [stopHook, promptDenyHook]);
    const out = await thinkExtended(makeReq(), deps);
    expect(out.kind).toBe('stopped');
    expect(stopCount).toBe(1);
  });

  it('runs runStop when session-start denies (H4)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([{ kind: 'respond_to_owner', text: 'never' }]);
    let stopCount = 0;
    const stopHook: Hook = {
      name: 'stop-counter',
      stage: 'stop',
      async fn() {
        stopCount += 1;
        return { kind: 'allow' };
      },
    };
    const sessionDenyHook: Hook = {
      name: 'session-filter',
      stage: 'session-start',
      async fn() {
        return { kind: 'deny', code: 'no-session', reason: 'blocked' };
      },
    };
    const deps = makeDeps(router, dispatcher, [stopHook, sessionDenyHook]);
    const out = await thinkExtended(makeReq(), deps);
    expect(out.kind).toBe('stopped');
    expect(stopCount).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────
  // H6 regression — sub-MD risk-tier ceiling is enforced as a hard cap
  // on any tool_call the child orchestrator emits.
  // ─────────────────────────────────────────────────────────────────
  it('denies a mutate tool when subMdRiskTierCeiling=read (H6)', async () => {
    const dispatcher = recordingDispatcher();
    const router: LLMRouter = {
      async call(): Promise<Decision> {
        return {
          kind: 'tool_call',
          call: { toolName: 'arrears.send_reminder', input: {}, callId: 'c' },
        };
      },
    };
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
      toolRiskTier: () => 'mutate',
      maxPermissionDenyRetries: 0,
    };
    const req: OrchestratorRequest = {
      ...makeReq(),
      subMdRiskTierCeiling: 'read',
      budget: { maxTurns: 20 },
    };
    const out = await thinkExtended(req, deps);
    expect(out.kind).toBe('stopped');
    if (out.kind === 'stopped') {
      expect(out.reason).toContain('sub-md-tier-ceiling');
    }
    expect(dispatcher.calls.find((d) => d.kind === 'tool_call')).toBeUndefined();
  });

  it('allows a read tool when subMdRiskTierCeiling=read (H6)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      {
        kind: 'tool_call',
        call: { toolName: 'arrears.lookup', input: {}, callId: 'c' },
      },
      { kind: 'respond_to_owner', text: 'done' },
    ]);
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher),
      toolRiskTier: () => 'read',
    };
    const req: OrchestratorRequest = {
      ...makeReq(),
      subMdRiskTierCeiling: 'read',
    };
    const out = await think(req, deps);
    expect(out.kind).toBe('answer');
    expect(
      dispatcher.calls.find(
        (d) => d.kind === 'tool_call' && d.call.toolName === 'arrears.lookup',
      ),
    ).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────
  // C3 regression — main-loop consumes runPostToolUse return + raises
  // an operator-visible audit-pipeline-failure signal.
  // ─────────────────────────────────────────────────────────────────
  it('logs an audit-pipeline-failure when a post-tool-use hook throws (C3)', async () => {
    const dispatcher = recordingDispatcher();
    const router = fixedRouter([
      {
        kind: 'tool_call',
        call: { toolName: 'arrears.lookup', input: {}, callId: 'c1' },
      },
      { kind: 'respond_to_owner', text: 'ok' },
    ]);
    const throwingPost: Hook = {
      name: 'audit-throw',
      stage: 'post-tool-use',
      async fn() {
        throw new Error('audit-sink-down');
      },
    };
    const failures: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher, [throwingPost]),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: (msg, meta) => {
          failures.push({ msg, meta });
        },
      },
    };
    const out = await think(makeReq(), deps);
    expect(out.kind).toBe('answer');
    // The loop kept going (dispatch DID happen) — but the failure was logged.
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures[0]?.msg).toContain('audit-pipeline failure');
  });

  it('runs runStop when H1 retry cap is exceeded so audit chain seals', async () => {
    const dispatcher = recordingDispatcher();
    const router: LLMRouter = {
      async call(): Promise<Decision> {
        return {
          kind: 'tool_call',
          call: { toolName: 'tenant.evict', input: {}, callId: 'c' },
        };
      },
    };
    let stopCount = 0;
    const stopHook: Hook = {
      name: 'stop-counter',
      stage: 'stop',
      async fn() {
        stopCount += 1;
        return { kind: 'allow' };
      },
    };
    const deps: OrchestratorDeps = {
      ...makeDeps(router, dispatcher, [stopHook]),
      toolRiskTier: () => 'mutate',
      maxPermissionDenyRetries: 0,
    };
    const req: OrchestratorRequest = {
      ...makeReq(),
      permissionMode: 'dont-ask',
      budget: { maxTurns: 20 },
    };
    const out = await thinkExtended(req, deps);
    expect(out.kind).toBe('stopped');
    expect(stopCount).toBe(1);
  });
});
