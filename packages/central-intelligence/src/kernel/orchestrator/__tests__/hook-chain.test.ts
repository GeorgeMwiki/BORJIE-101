import { describe, it, expect } from 'vitest';
import {
  createHookChain,
  type Hook,
  type HookContext,
  type HookResult,
  type PreToolUseHook,
  type PostToolUseHook,
  type StopHook,
  type SessionStartHook,
  type UserPromptSubmitHook,
  type PreCompactHook,
  type PostCompactHook,
  type SubagentStartHook,
  type SubagentStopHook,
} from '../hook-chain.js';
import type { Decision, DispatchResult } from '../decision.js';
import { createPiiScrubHook } from '../hooks/pre-tool-use/pii-scrub-hook.js';
import { createPermissionHook } from '../hooks/pre-tool-use/permission-hook.js';
import { createFourEyeHook } from '../hooks/pre-tool-use/four-eye-hook.js';
import { createToolDenylistHook } from '../hooks/pre-tool-use/tool-denylist-hook.js';
import {
  createRateLimitHook,
  createInMemoryRateLimitCounter,
} from '../hooks/pre-tool-use/rate-limit-hook.js';
import { createCostCircuitHook } from '../hooks/pre-tool-use/cost-circuit-hook.js';
import { createSandboxDivertHook } from '../hooks/pre-tool-use/sandbox-divert-hook.js';
import {
  createAuditEmissionHook,
  createInMemoryAuditEmissionSink,
} from '../hooks/post-tool-use/audit-emission-hook.js';
import {
  createLedgerSealHook,
  createInMemoryLedgerSeal,
} from '../hooks/stop/ledger-seal-hook.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const tenantCtx: HookContext = {
  threadId: 'th_1',
  scope: {
    kind: 'tenant',
    tenantId: 't_1',
    actorUserId: 'u_1',
    roles: ['owner'],
    personaId: 'p_1',
  },
  tier: 'tenant',
  userMessage: 'hello',
  tickStartedAt: 0,
  grantedScopes: ['tenants.read'],
};

const platformCtx: HookContext = {
  threadId: 'th_2',
  scope: {
    kind: 'platform',
    actorUserId: 'admin',
    roles: ['platform-admin'],
    personaId: 'pi_1',
  },
  tier: 'industry',
  userMessage: 'hi',
  tickStartedAt: 0,
};

const toolCall = (
  toolName: string,
  input: Record<string, unknown> = {},
  estimatedCostUsd?: number,
): Decision => ({
  kind: 'tool_call',
  call: {
    toolName,
    input,
    callId: `call_${toolName}`,
    ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
  },
});

const respond: Decision = { kind: 'respond_to_owner', text: 'done' };

// ─────────────────────────────────────────────────────────────────────
// HookChain core
// ─────────────────────────────────────────────────────────────────────

describe('createHookChain', () => {
  it('returns allow when no hooks are registered', async () => {
    const chain = createHookChain([]);
    expect((await chain.runPreToolUse(respond, tenantCtx)).outcome.kind).toBe('allow');
    expect(chain.list()).toEqual([]);
  });

  it('short-circuits at the first non-allow result', async () => {
    let secondCalled = false;
    const first: PreToolUseHook = {
      name: 'denier',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        return { kind: 'deny', code: 'X', reason: 'no' };
      },
    };
    const second: PreToolUseHook = {
      name: 'never',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        secondCalled = true;
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([first, second]);
    const result = await chain.runPreToolUse(toolCall('any'), tenantCtx);
    expect(result.outcome.kind).toBe('deny');
    expect(secondCalled).toBe(false);
  });

  it('respects scope filters by tool name', async () => {
    const hook: PreToolUseHook = {
      name: 'scoped',
      stage: 'pre-tool-use',
      scope: { toolNames: ['tenant.delete'] },
      async fn(): Promise<HookResult> {
        return { kind: 'deny', code: 'D', reason: 'scoped deny' };
      },
    };
    const chain = createHookChain([hook]);
    expect((await chain.runPreToolUse(toolCall('tenant.read'), tenantCtx)).outcome.kind)
      .toBe('allow');
    expect((await chain.runPreToolUse(toolCall('tenant.delete'), tenantCtx)).outcome.kind)
      .toBe('deny');
  });

  it('runs post-tool-use and stop chains independently', async () => {
    let postFired = false;
    let stopFired = false;
    const post: PostToolUseHook = {
      name: 'p',
      stage: 'post-tool-use',
      async fn(): Promise<HookResult> {
        postFired = true;
        return { kind: 'allow' };
      },
    };
    const stop: StopHook = {
      name: 's',
      stage: 'stop',
      async fn(): Promise<HookResult> {
        stopFired = true;
        return { kind: 'allow' };
      },
    };
    const hooks: Hook[] = [post, stop];
    const chain = createHookChain(hooks);
    const dispatchResult: DispatchResult = {
      kind: 'tool_ok',
      callId: 'c',
      output: null,
      latencyMs: 1,
      tokensIn: 1,
      tokensOut: 1,
      usdCost: 0,
    };
    await chain.runPostToolUse(toolCall('x'), dispatchResult, tenantCtx);
    await chain.runStop(
      { threadId: 'th', turnCount: 1, finalText: null, exhaustedAxis: null },
      tenantCtx,
    );
    expect(postFired).toBe(true);
    expect(stopFired).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7 built-in pre-tool-use hooks
// ─────────────────────────────────────────────────────────────────────

describe('built-in hooks', () => {
  describe('pii-scrub-hook', () => {
    it('transforms tool input when the scrubber flags PII', async () => {
      const hook = createPiiScrubHook({
        scrubber: {
          scrub: (text: string) =>
            text.includes('+255')
              ? { scrubbed: text.replace(/\+255\d+/g, '[redacted]'), hasPii: true }
              : { scrubbed: text, hasPii: false },
        },
      });
      const decision = toolCall('contact', { phone: '+255712345678', note: 'ok' });
      const result = await hook.fn(tenantCtx, decision);
      expect(result.kind).toBe('transform');
      if (result.kind === 'transform' && result.replacement.kind === 'tool_call') {
        expect(result.replacement.call.input.phone).toBe('[redacted]');
        expect(result.replacement.call.input.note).toBe('ok');
      }
    });

    it('allows when no PII is found', async () => {
      const hook = createPiiScrubHook({
        scrubber: { scrub: (t) => ({ scrubbed: t, hasPii: false }) },
      });
      expect((await hook.fn(tenantCtx, toolCall('safe', { a: 'b' }))).kind)
        .toBe('allow');
    });

    it('passes through non-tool decisions', async () => {
      const hook = createPiiScrubHook({
        scrubber: { scrub: (t) => ({ scrubbed: t, hasPii: true }) },
      });
      expect((await hook.fn(tenantCtx, respond)).kind).toBe('allow');
    });
  });

  describe('permission-hook', () => {
    it('denies when a required scope is missing', async () => {
      const hook = createPermissionHook({
        scopes: { requiredScopes: () => ['tenants.write'] },
      });
      const r = await hook.fn(tenantCtx, toolCall('tenant.update'));
      expect(r.kind).toBe('deny');
      if (r.kind === 'deny') expect(r.code).toBe('permission-missing-scopes');
    });

    it('allows when granted scopes cover the required set', async () => {
      const hook = createPermissionHook({
        scopes: { requiredScopes: () => ['tenants.read'] },
      });
      expect((await hook.fn(tenantCtx, toolCall('tenant.read'))).kind).toBe('allow');
    });
  });

  describe('four-eye-hook', () => {
    const hook = createFourEyeHook({
      policy: {
        requiresApproval: (n) => n === 'tenant.evict',
        approvalStatus: async ({ toolName }) =>
          toolName === 'tenant.evict' ? 'none' : 'approved',
      },
    });

    it('returns ask-owner when approval is missing', async () => {
      const r = await hook.fn(tenantCtx, toolCall('tenant.evict'));
      expect(r.kind).toBe('ask-owner');
    });

    it('returns allow when approval is approved', async () => {
      const allowHook = createFourEyeHook({
        policy: {
          requiresApproval: () => true,
          approvalStatus: async () => 'approved',
        },
      });
      expect((await allowHook.fn(tenantCtx, toolCall('x'))).kind).toBe('allow');
    });

    it('returns deny when approval was rejected', async () => {
      const denyHook = createFourEyeHook({
        policy: {
          requiresApproval: () => true,
          approvalStatus: async () => 'rejected',
        },
      });
      const r = await denyHook.fn(tenantCtx, toolCall('x'));
      expect(r.kind).toBe('deny');
      if (r.kind === 'deny') expect(r.code).toBe('four-eye-rejected');
    });
  });

  describe('tool-denylist-hook', () => {
    it('denies globally banned tools', async () => {
      const hook = createToolDenylistHook({
        globalDenylist: ['tenant.delete_all'],
      });
      const r = await hook.fn(tenantCtx, toolCall('tenant.delete_all'));
      expect(r.kind).toBe('deny');
      if (r.kind === 'deny') expect(r.code).toBe('tool-globally-denied');
    });

    it('respects the dynamic killswitch port', async () => {
      const hook = createToolDenylistHook({
        dynamic: { isDenied: async (n) => n === 'cost.spike' },
      });
      expect((await hook.fn(tenantCtx, toolCall('cost.spike'))).kind).toBe('deny');
      expect((await hook.fn(tenantCtx, toolCall('cost.normal'))).kind).toBe('allow');
    });
  });

  describe('rate-limit-hook', () => {
    it('allows under the threshold and denies past it', async () => {
      const counter = createInMemoryRateLimitCounter();
      const hook = createRateLimitHook({
        counter,
        maxCallsPerWindow: 2,
        windowMs: 1_000,
      });
      expect((await hook.fn(tenantCtx, toolCall('t1'))).kind).toBe('allow');
      expect((await hook.fn(tenantCtx, toolCall('t1'))).kind).toBe('allow');
      const third = await hook.fn(tenantCtx, toolCall('t1'));
      expect(third.kind).toBe('deny');
      if (third.kind === 'deny') expect(third.code).toBe('rate-limit-exceeded');
    });
  });

  describe('cost-circuit-hook', () => {
    it('denies when projection breaches the ceiling', async () => {
      const hook = createCostCircuitHook({
        breaker: {
          project: async ({ estimatedCostUsd }) => ({
            projectedUsd: estimatedCostUsd + 90,
            ceilingUsd: 100,
          }),
        },
      });
      const allow = await hook.fn(tenantCtx, toolCall('x', {}, 5));
      expect(allow.kind).toBe('allow');
      const deny = await hook.fn(tenantCtx, toolCall('x', {}, 50));
      expect(deny.kind).toBe('deny');
      if (deny.kind === 'deny') expect(deny.code).toBe('cost-ceiling-breach');
    });

    it('uses _platform as the tenantId for platform scope', async () => {
      let receivedTenant = '';
      const hook = createCostCircuitHook({
        breaker: {
          project: async ({ tenantId }) => {
            receivedTenant = tenantId;
            return { projectedUsd: 1, ceilingUsd: 10 };
          },
        },
      });
      await hook.fn(platformCtx, toolCall('x', {}, 1));
      expect(receivedTenant).toBe('_platform');
    });

    // H2 — Asymmetric default fix. A non-read tool with no cost
    // estimate must NOT silently pass at $0; either deny with
    // cost-estimate-missing or use the sentinel.
    it('denies a non-read tool with explicit estimatedCostUsd=0 (H2)', async () => {
      const hook = createCostCircuitHook({
        breaker: {
          project: async () => ({ projectedUsd: 0, ceilingUsd: 100 }),
        },
        toolRiskTier: () => 'mutate',
      });
      const out = await hook.fn(tenantCtx, toolCall('mut.tool', {}, 0));
      expect(out.kind).toBe('deny');
      if (out.kind === 'deny') expect(out.code).toBe('cost-estimate-missing');
    });

    it('uses the sentinel cost for an unknown mutate-tier tool with no estimate (H2)', async () => {
      let projectedReceived = -1;
      const hook = createCostCircuitHook({
        breaker: {
          project: async ({ estimatedCostUsd }) => {
            projectedReceived = estimatedCostUsd;
            return { projectedUsd: estimatedCostUsd, ceilingUsd: 100 };
          },
        },
        toolRiskTier: () => 'mutate',
        unknownToolCostSentinelUsd: 2.5,
      });
      const out = await hook.fn(tenantCtx, toolCall('unknown.mut'));
      expect(out.kind).toBe('allow');
      expect(projectedReceived).toBe(2.5);
    });

    it('keeps a read-tier tool at $0 when no estimate is supplied (H2)', async () => {
      let projectedReceived = -1;
      const hook = createCostCircuitHook({
        breaker: {
          project: async ({ estimatedCostUsd }) => {
            projectedReceived = estimatedCostUsd;
            return { projectedUsd: estimatedCostUsd, ceilingUsd: 100 };
          },
        },
        toolRiskTier: () => 'read',
      });
      const out = await hook.fn(tenantCtx, toolCall('read.tool'));
      expect(out.kind).toBe('allow');
      expect(projectedReceived).toBe(0);
    });
  });

  describe('sandbox-divert-hook', () => {
    it('returns sandbox when the resolver supplies a sandbox id', async () => {
      const hook = createSandboxDivertHook({
        resolver: { resolve: async () => 'sbx_42' },
      });
      const r = await hook.fn(tenantCtx, toolCall('x'));
      expect(r.kind).toBe('sandbox');
      if (r.kind === 'sandbox') expect(r.sandboxId).toBe('sbx_42');
    });

    it('passes through when the resolver returns null', async () => {
      const hook = createSandboxDivertHook({
        resolver: { resolve: async () => null },
      });
      expect((await hook.fn(tenantCtx, toolCall('x'))).kind).toBe('allow');
    });
  });

  describe('audit-emission-hook', () => {
    it('records both tool_ok and tool_error dispatch outcomes', async () => {
      const sink = createInMemoryAuditEmissionSink();
      const hook = createAuditEmissionHook({ sink });
      await hook.fn(tenantCtx, toolCall('x'), {
        kind: 'tool_ok',
        callId: 'cx',
        output: { ok: true },
        latencyMs: 5,
        tokensIn: 10,
        tokensOut: 20,
        usdCost: 0.5,
      });
      await hook.fn(tenantCtx, toolCall('y'), {
        kind: 'tool_error',
        callId: 'cy',
        message: 'boom',
        latencyMs: 1,
      });
      expect(sink.rows.length).toBe(2);
      expect(sink.rows[0]?.outcome).toBe('ok');
      expect(sink.rows[1]?.outcome).toBe('error');
      expect(sink.rows[1]?.errorMessage).toBe('boom');
    });

    it('never throws when the sink fails', async () => {
      const hook = createAuditEmissionHook({
        sink: {
          record: async () => {
            throw new Error('sink down');
          },
        },
      });
      const r = await hook.fn(tenantCtx, toolCall('x'), {
        kind: 'tool_ok',
        callId: 'cx',
        output: null,
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        usdCost: 0,
      });
      expect(r.kind).toBe('allow');
    });
  });

  describe('ledger-seal-hook', () => {
    it('writes one seal per stop invocation', async () => {
      const ledger = createInMemoryLedgerSeal();
      const hook = createLedgerSealHook({ ledger });
      await hook.fn(tenantCtx, {
        threadId: 'th_1',
        turnCount: 4,
        finalText: 'bye',
        exhaustedAxis: null,
      });
      expect(ledger.seals.length).toBe(1);
      expect(ledger.seals[0]?.turnCount).toBe(4);
    });

    it('records the exhaustion axis on the seal envelope', async () => {
      const ledger = createInMemoryLedgerSeal();
      const hook = createLedgerSealHook({ ledger });
      await hook.fn(tenantCtx, {
        threadId: 'th_1',
        turnCount: 20,
        finalText: null,
        exhaustedAxis: 'turns',
      });
      expect(ledger.seals[0]?.exhaustedAxis).toBe('turns');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Gap-2 — four new HookResult variants on the pre-tool-use chain.
// ─────────────────────────────────────────────────────────────────────

describe('HookResult ADT extensions', () => {
  it('updated-input rewrites the decision and continues the chain', async () => {
    const rewriter: PreToolUseHook = {
      name: 'rewrite',
      stage: 'pre-tool-use',
      async fn(_ctx, decision): Promise<HookResult> {
        if (decision.kind !== 'tool_call') return { kind: 'allow' };
        return {
          kind: 'updated-input',
          replacement: {
            kind: 'tool_call',
            call: {
              ...decision.call,
              input: { ...decision.call.input, scrubbed: true },
            },
          },
        };
      },
    };
    const downstream: PreToolUseHook = {
      name: 'verifier',
      stage: 'pre-tool-use',
      async fn(_ctx, decision): Promise<HookResult> {
        if (
          decision.kind === 'tool_call' &&
          decision.call.input.scrubbed === true
        ) {
          return { kind: 'allow' };
        }
        return { kind: 'deny', code: 'D', reason: 'not scrubbed' };
      },
    };
    const chain = createHookChain([rewriter, downstream]);
    const out = await chain.runPreToolUse(toolCall('x'), tenantCtx);
    expect(out.outcome.kind).toBe('allow');
    expect(out.effectiveDecision).not.toBeNull();
    if (out.effectiveDecision?.kind === 'tool_call') {
      expect(out.effectiveDecision.call.input.scrubbed).toBe(true);
    }
  });

  it('additional-context accumulates injected messages', async () => {
    const policyReminder: PreToolUseHook = {
      name: 'policy',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        return {
          kind: 'additional-context',
          messages: [
            { role: 'system', content: 'Remember: never expose tenant emails.' },
          ],
        };
      },
    };
    const citation: PreToolUseHook = {
      name: 'citation',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        return {
          kind: 'additional-context',
          messages: [{ role: 'system', content: 'Citation: RFC-1234' }],
        };
      },
    };
    const chain = createHookChain([policyReminder, citation]);
    const out = await chain.runPreToolUse(toolCall('x'), tenantCtx);
    expect(out.outcome.kind).toBe('allow');
    expect(out.contextInjections.length).toBe(2);
    expect(out.contextInjections[0]?.content).toContain('never expose');
  });

  it('defer returns the defer outcome to the main-loop', async () => {
    const deferHook: PreToolUseHook = {
      name: 'rate-pause',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        return {
          kind: 'defer',
          resumeAfterMs: 5_000,
          reason: 'upstream rate-limit cooldown',
        };
      },
    };
    const chain = createHookChain([deferHook]);
    const out = await chain.runPreToolUse(toolCall('x'), tenantCtx);
    expect(out.outcome.kind).toBe('defer');
    if (out.outcome.kind === 'defer') {
      expect(out.outcome.resumeAfterMs).toBe(5_000);
      expect(out.outcome.reason).toContain('cooldown');
    }
  });

  it('stop aborts the chain immediately', async () => {
    let downstreamRan = false;
    const stopper: PreToolUseHook = {
      name: 'stopper',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        return { kind: 'stop', reason: 'system shutting down' };
      },
    };
    const after: PreToolUseHook = {
      name: 'never',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        downstreamRan = true;
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([stopper, after]);
    const out = await chain.runPreToolUse(toolCall('x'), tenantCtx);
    expect(out.outcome.kind).toBe('stop');
    expect(downstreamRan).toBe(false);
  });

  it('chain composition — two hooks both updating input', async () => {
    const piiScrub: PreToolUseHook = {
      name: 'pii',
      stage: 'pre-tool-use',
      async fn(_c, d): Promise<HookResult> {
        if (d.kind !== 'tool_call') return { kind: 'allow' };
        return {
          kind: 'updated-input',
          replacement: {
            kind: 'tool_call',
            call: {
              ...d.call,
              input: { ...d.call.input, pii: '[redacted]' },
            },
          },
        };
      },
    };
    const tag: PreToolUseHook = {
      name: 'tag',
      stage: 'pre-tool-use',
      async fn(_c, d): Promise<HookResult> {
        if (d.kind !== 'tool_call') return { kind: 'allow' };
        return {
          kind: 'updated-input',
          replacement: {
            kind: 'tool_call',
            call: {
              ...d.call,
              input: { ...d.call.input, tagged: 'v1' },
            },
          },
        };
      },
    };
    const chain = createHookChain([piiScrub, tag]);
    const out = await chain.runPreToolUse(
      toolCall('x', { phone: '+255700' }),
      tenantCtx,
    );
    expect(out.outcome.kind).toBe('allow');
    if (out.effectiveDecision?.kind === 'tool_call') {
      // Both hooks composed onto the same final Decision.
      expect(out.effectiveDecision.call.input.pii).toBe('[redacted]');
      expect(out.effectiveDecision.call.input.tagged).toBe('v1');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Gap-3 — six new lifecycle stages.
// ─────────────────────────────────────────────────────────────────────

describe('HookChain extended stages', () => {
  it('session-start fires the registered hook once per invocation', async () => {
    let firedCount = 0;
    const hook: SessionStartHook = {
      name: 'seed',
      stage: 'session-start',
      async fn(): Promise<HookResult> {
        firedCount += 1;
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([hook]);
    await chain.runSessionStart(
      { threadId: 'th', tier: 'tenant', resumed: false },
      tenantCtx,
    );
    expect(firedCount).toBe(1);
  });

  it('user-prompt-submit can deny a hostile prompt', async () => {
    const hook: UserPromptSubmitHook = {
      name: 'profanity',
      stage: 'user-prompt-submit',
      async fn(_c, payload): Promise<HookResult> {
        if (payload.text.includes('drop-table')) {
          return { kind: 'deny', code: 'profanity', reason: 'sql probe' };
        }
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([hook]);
    expect(
      (await chain.runUserPromptSubmit({ text: 'hi' }, tenantCtx)).kind,
    ).toBe('allow');
    expect(
      (await chain.runUserPromptSubmit({ text: 'drop-table' }, tenantCtx)).kind,
    ).toBe('deny');
  });

  it('pre-compact sees the current token usage', async () => {
    let observed = 0;
    const hook: PreCompactHook = {
      name: 'audit',
      stage: 'pre-compact',
      async fn(_c, payload): Promise<HookResult> {
        observed = payload.currentTokens;
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([hook]);
    await chain.runPreCompact(
      { currentTokens: 90_000, windowTokens: 100_000, ratio: 0.9 },
      tenantCtx,
    );
    expect(observed).toBe(90_000);
  });

  it('post-compact records what was dropped', async () => {
    let dropped = 0;
    const hook: PostCompactHook = {
      name: 'audit-after',
      stage: 'post-compact',
      async fn(_c, payload): Promise<HookResult> {
        dropped = payload.droppedTurnCount;
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([hook]);
    await chain.runPostCompact(
      { originalTokens: 100_000, finalTokens: 40_000, droppedTurnCount: 12 },
      tenantCtx,
    );
    expect(dropped).toBe(12);
  });

  it('subagent-start fires when a sub-MD spawns', async () => {
    let observedPersona = '';
    const hook: SubagentStartHook = {
      name: 'audit-spawn',
      stage: 'subagent-start',
      async fn(_c, payload): Promise<HookResult> {
        observedPersona = payload.persona;
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([hook]);
    await chain.runSubagentStart(
      {
        subMdId: 'sm_1',
        persona: 'maintenance-dispatch',
        parentThreadId: 'th',
      },
      tenantCtx,
    );
    expect(observedPersona).toBe('maintenance-dispatch');
  });

  it('subagent-stop receives the child outcome', async () => {
    let observedKind = '';
    const hook: SubagentStopHook = {
      name: 'audit-stop',
      stage: 'subagent-stop',
      async fn(_c, payload): Promise<HookResult> {
        observedKind = payload.outcome?.kind ?? 'absent';
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([hook]);
    await chain.runSubagentStop(
      {
        subMdId: 'sm_1',
        persona: 'p',
        parentThreadId: 'th',
        outcome: {
          kind: 'spawn_ack',
          subMdId: 'sm_1',
          handoffToken: 'h_1',
        },
      },
      tenantCtx,
    );
    expect(observedKind).toBe('spawn_ack');
  });

  it('ordering — session-start fires once across many runSessionStart calls', async () => {
    let firedCount = 0;
    const hook: SessionStartHook = {
      name: 'seed',
      stage: 'session-start',
      async fn(): Promise<HookResult> {
        firedCount += 1;
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([hook]);
    await chain.runSessionStart(
      { threadId: 'th', tier: 'tenant', resumed: false },
      tenantCtx,
    );
    // Subsequent stages should NOT re-fire session-start.
    await chain.runUserPromptSubmit({ text: 'hi' }, tenantCtx);
    await chain.runPreCompact(
      { currentTokens: 1, windowTokens: 10, ratio: 0.1 },
      tenantCtx,
    );
    expect(firedCount).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────
  // CRITICAL #8 regression — thrown hooks must produce a typed deny
  // result, NOT unwind the chain with an unhandled rejection.
  // ─────────────────────────────────────────────────────────────────
  it('thrown pre-tool-use hook maps to deny code=hook-threw (CRITICAL #8)', async () => {
    const throwing: PreToolUseHook = {
      name: 'throwing-pre',
      stage: 'pre-tool-use',
      async fn(): Promise<HookResult> {
        throw new Error('boom-pre');
      },
    };
    const chain = createHookChain([throwing]);
    const decision: Decision = {
      kind: 'tool_call',
      call: { toolName: 'demo.read', input: {}, callId: 'c1' },
    };
    const out = await chain.runPreToolUse(decision, tenantCtx);
    expect(out.outcome.kind).toBe('deny');
    if (out.outcome.kind === 'deny') {
      expect(out.outcome.code).toBe('hook-threw');
      expect(out.outcome.reason).toContain('boom-pre');
    }
  });

  it('thrown post-tool-use hook maps to deny code=hook-threw (CRITICAL #8)', async () => {
    const throwing: PostToolUseHook = {
      name: 'throwing-post',
      stage: 'post-tool-use',
      async fn(): Promise<HookResult> {
        throw new Error('boom-post');
      },
    };
    const chain = createHookChain([throwing]);
    const decision: Decision = {
      kind: 'tool_call',
      call: { toolName: 'demo.read', input: {}, callId: 'c1' },
    };
    const dispatch: DispatchResult = {
      kind: 'tool_ok',
      callId: 'c1',
      output: {},
      latencyMs: 1,
      tokensIn: 1,
      tokensOut: 1,
      usdCost: 0,
    };
    const out = await chain.runPostToolUse(decision, dispatch, tenantCtx);
    expect(out.kind).toBe('deny');
    if (out.kind === 'deny') expect(out.code).toBe('hook-threw');
  });

  it('runPostToolUse runs ALL hooks even when an early hook denies (H3)', async () => {
    const fired: string[] = [];
    const throwing: PostToolUseHook = {
      name: 'audit',
      stage: 'post-tool-use',
      async fn() {
        fired.push('audit');
        throw new Error('audit-sink-down');
      },
    };
    const telemetry: PostToolUseHook = {
      name: 'telemetry',
      stage: 'post-tool-use',
      async fn(): Promise<HookResult> {
        fired.push('telemetry');
        return { kind: 'allow' };
      },
    };
    const ledgerSeal: PostToolUseHook = {
      name: 'ledger-seal',
      stage: 'post-tool-use',
      async fn(): Promise<HookResult> {
        fired.push('ledger-seal');
        return { kind: 'allow' };
      },
    };
    const chain = createHookChain([throwing, telemetry, ledgerSeal]);
    const decision: Decision = {
      kind: 'tool_call',
      call: { toolName: 'demo.read', input: {}, callId: 'c1' },
    };
    const dispatch: DispatchResult = {
      kind: 'tool_ok',
      callId: 'c1',
      output: {},
      latencyMs: 1,
      tokensIn: 1,
      tokensOut: 1,
      usdCost: 0,
    };
    const out = await chain.runPostToolUse(decision, dispatch, tenantCtx);
    // Returned the first non-allow but still ran every hook.
    expect(out.kind).toBe('deny');
    expect(fired).toEqual(['audit', 'telemetry', 'ledger-seal']);
  });

  it('thrown session-start hook maps to deny code=hook-threw', async () => {
    const throwing: SessionStartHook = {
      name: 'seed-bad',
      stage: 'session-start',
      async fn(): Promise<HookResult> {
        throw new Error('boom-start');
      },
    };
    const chain = createHookChain([throwing]);
    const out = await chain.runSessionStart(
      { threadId: 'th', tier: 'tenant', resumed: false },
      tenantCtx,
    );
    expect(out.kind).toBe('deny');
    if (out.kind === 'deny') expect(out.code).toBe('hook-threw');
  });
});
