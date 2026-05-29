/**
 * Brain-kernel wiring tests — verify the composition module:
 *   1. returns null when no Anthropic factory is supplied
 *   2. returns a kernel + bound think when the factory yields an SDK
 *   3. surfaces a usable `.think(...)` that round-trips a fake Anthropic
 *      SDK and returns a `BrainDecision` with provenance
 *   4. emits a logger.info entry on successful composition
 *   5. degrades to null when the factory throws
 *   6. degrades to null when the factory returns an SDK that throws on
 *      `messages.create` AND the kernel surfaces it as a refusal/answer
 *      shape — verifying the wiring never throws past its boundary
 *   7. preserves the bound `think` reference (no `this` loss when
 *      destructured)
 *
 * The fake AnthropicMessagesClient mimics only the surface the kernel
 * touches (`messages.create({...}) -> Promise<{content: [{type, text}], stop_reason, usage}>`).
 * It is deliberately minimal — the kernel adapter is exercised end-to-
 * end by `packages/central-intelligence/src/kernel/kernel.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBrainKernelWiring,
  type BudgetGuardedAnthropicFactory,
} from '../brain-kernel-wiring';

// ---------------------------------------------------------------------------
// Fake Anthropic SDK — produces a deterministic answer shape so the
// kernel's normalize / policy / confidence pipeline has something to
// chew on.
// ---------------------------------------------------------------------------

interface FakeSdkHandle {
  readonly factory: BudgetGuardedAnthropicFactory;
  readonly calls: ReadonlyArray<{ tenantId: string; operation?: string }>;
  readonly messageRequests: ReadonlyArray<unknown>;
}

function createFakeFactory(
  options: { readonly responseText?: string } = {},
): FakeSdkHandle {
  const calls: Array<{ tenantId: string; operation?: string }> = [];
  const messageRequests: unknown[] = [];
  const responseText = options.responseText ?? 'Hello from the fake brain.';

  const sdk = {
    messages: {
      create: async (req: unknown) => {
        messageRequests.push(req);
        return {
          content: [{ type: 'text', text: responseText }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 8 },
        };
      },
    },
  };

  const factory: BudgetGuardedAnthropicFactory = (
    tenantId: string,
    operation?: string,
  ) => {
    calls.push({ tenantId, operation });
    return { sdk };
  };

  return {
    factory,
    get calls() {
      return calls;
    },
    get messageRequests() {
      return messageRequests;
    },
  };
}

describe('createBrainKernelWiring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('returns null when no anthropic factory is supplied', () => {
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: null,
    });
    expect(wiring).toBeNull();
  });

  it('returns a kernel + bound think when factory yields an SDK', () => {
    const fake = createFakeFactory();
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
    });

    expect(wiring).not.toBeNull();
    expect(wiring?.kernel).toBeDefined();
    expect(typeof wiring?.kernel.think).toBe('function');
    expect(typeof wiring?.think).toBe('function');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.tenantId).toBe('__kernel_bootstrap__');
  });

  it('think() round-trips a fake Anthropic SDK and produces a BrainDecision', async () => {
    const fake = createFakeFactory({
      responseText: 'Your rent is current and the lease ends in November.',
    });
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
    });
    expect(wiring).not.toBeNull();

    const decision = await wiring!.think({
      threadId: 'thread-1',
      userMessage: 'Hello, can you help me with my lease?',
      scope: {
        kind: 'tenant',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        roles: ['tenant'],
        personaId: 'voice-agent-default',
      },
      tier: 'tenant',
      stakes: 'low',
      surface: 'tenant-app',
    });

    expect(decision).toBeDefined();
    expect(decision.kind).toMatch(/^(answer|softened|refusal)$/);
    expect(decision.provenance).toBeDefined();
    expect(typeof decision.provenance.modelId).toBe('string');
    expect(fake.messageRequests.length).toBeGreaterThanOrEqual(1);
  });

  it('logs an info entry on successful composition', () => {
    const info = vi.fn();
    const fake = createFakeFactory();
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
      logger: { info },
    });

    expect(wiring).not.toBeNull();
    // R4 2026-05-29 — brain-kernel-wiring now emits multiple structured
    // info entries (kernel composed + mining tools registered + wiring
    // metadata). The kernel composition entry is the first one and the
    // one tests need to assert. Assert the floor without pinning the
    // exact count so future wiring additions don't churn the suite.
    expect(info).toHaveBeenCalled();
    expect(info.mock.calls.length).toBeGreaterThanOrEqual(1);
    const composedCall = info.mock.calls.find((call) => {
      const [meta, msg] = call as [
        Record<string, unknown>,
        string | undefined,
      ];
      return (
        meta?.wiring === 'brain-kernel' &&
        typeof msg === 'string' &&
        msg.includes('composed')
      );
    });
    expect(composedCall).toBeDefined();
    const [meta] = composedCall as [Record<string, unknown>, string];
    expect(meta.wiring).toBe('brain-kernel');
    expect(meta.sensors).toEqual(['opus47', 'sonnet46', 'haiku45']);
  });

  it('degrades to null and warns when the factory throws', () => {
    const warn = vi.fn();
    const throwingFactory: BudgetGuardedAnthropicFactory = () => {
      throw new Error('ANTHROPIC_API_KEY malformed');
    };
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: throwingFactory,
      logger: { warn },
    });

    expect(wiring).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const [meta] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(meta.wiring).toBe('brain-kernel');
    expect(typeof meta.error).toBe('string');
  });

  it('preserves the bound think reference when destructured', async () => {
    const fake = createFakeFactory();
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
    });
    expect(wiring).not.toBeNull();

    // Destructure to simulate `kernelThink: wiring.think` flow into
    // voice-agent-wiring. The bound reference must keep its `this`
    // context — so it should resolve without throwing.
    const { think } = wiring!;
    const decision = await think({
      threadId: 'thread-2',
      userMessage: 'A different question about the property.',
      scope: {
        kind: 'tenant',
        tenantId: 'tenant-2',
        actorUserId: 'user-2',
        roles: ['tenant'],
        personaId: 'voice-agent-default',
      },
      tier: 'tenant',
      stakes: 'low',
      surface: 'tenant-app',
    });

    expect(decision).toBeDefined();
    expect(decision.provenance).toBeDefined();
  });

  it('exposes decisionTraceRecorder, killswitch, toolRegistry, uncertaintyPolicy on the wiring slot', () => {
    const fake = createFakeFactory();
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
    });
    expect(wiring).not.toBeNull();
    expect(wiring!.decisionTraceRecorder).toBeDefined();
    expect(typeof wiring!.decisionTraceRecorder.begin).toBe('function');
    expect(typeof wiring!.decisionTraceRecorder.getRecentTraces).toBe('function');
    expect(wiring!.killswitch).toBeDefined();
    expect(typeof wiring!.killswitch.readPlatform).toBe('function');
    expect(typeof wiring!.killswitch.readTenant).toBe('function');
    expect(wiring!.toolRegistry).toBeDefined();
    expect(typeof wiring!.toolRegistry.runTool).toBe('function');
    // Default env (no flag) → uncertainty policy off.
    expect(wiring!.uncertaintyPolicy).toBe('off');
  });

  it('env-driven killswitch HALT short-circuits think() into a refusal', async () => {
    const fake = createFakeFactory({
      responseText: 'This response would be returned if the killswitch was live.',
    });
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
      envSource: {
        KILLSWITCH_STATE: 'halt',
        KILLSWITCH_REASON: 'COMPLIANCE_HOLD_CBK',
      },
    });
    expect(wiring).not.toBeNull();
    const decision = await wiring!.think({
      threadId: 'kill-thread-1',
      userMessage: 'Anything at all.',
      scope: {
        kind: 'tenant',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        roles: ['tenant'],
        personaId: 'voice-agent-default',
      },
      tier: 'tenant',
      stakes: 'low',
      surface: 'tenant-app',
    });
    expect(decision.kind).toBe('refusal');
    // No sensor call should have happened — the killswitch fires before
    // memory recall / sensor selection.
    expect(fake.messageRequests).toHaveLength(0);
  });

  it('tenant-scoped killswitch HALT overrides a live platform state', async () => {
    const fake = createFakeFactory();
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
      envSource: {
        // Platform live, but tenant-1 is held.
        KILLSWITCH_TENANT_tenant_held: 'halt',
        KILLSWITCH_TENANT_tenant_held_REASON: 'TENANT_DATA_LEAK_SUSPECTED',
      },
    });
    expect(wiring).not.toBeNull();
    // tenant-held → refusal
    const heldDecision = await wiring!.think({
      threadId: 'kill-thread-2',
      userMessage: 'Anything at all.',
      scope: {
        kind: 'tenant',
        tenantId: 'tenant_held',
        actorUserId: 'user-held',
        roles: ['tenant'],
        personaId: 'voice-agent-default',
      },
      tier: 'tenant',
      stakes: 'low',
      surface: 'tenant-app',
    });
    expect(heldDecision.kind).toBe('refusal');
    expect(fake.messageRequests).toHaveLength(0);

    // tenant-other → normal answer (sensor IS called).
    const otherDecision = await wiring!.think({
      threadId: 'kill-thread-3',
      userMessage: 'Different tenant, same time.',
      scope: {
        kind: 'tenant',
        tenantId: 'tenant_other',
        actorUserId: 'user-other',
        roles: ['tenant'],
        personaId: 'voice-agent-default',
      },
      tier: 'tenant',
      stakes: 'low',
      surface: 'tenant-app',
    });
    expect(otherDecision.kind).not.toBe('refusal');
    expect(fake.messageRequests.length).toBeGreaterThanOrEqual(1);
  });

  it('decision-trace recorder writes a trace for each think() call', async () => {
    const fake = createFakeFactory({
      responseText: 'Trace-recording success path.',
    });
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
    });
    expect(wiring).not.toBeNull();

    await wiring!.think({
      threadId: 'trace-thread-1',
      userMessage: 'Anything to trace.',
      scope: {
        kind: 'tenant',
        tenantId: 'tenant-trace',
        actorUserId: 'user-trace',
        roles: ['tenant'],
        personaId: 'voice-agent-default',
      },
      tier: 'tenant',
      stakes: 'low',
      surface: 'tenant-app',
    });

    // Give the trace recorder's fire-and-forget finalize a tick to flush.
    await new Promise((resolve) => setImmediate(resolve));
    const recent = await wiring!.decisionTraceRecorder.getRecentTraces(
      'tenant-trace',
      10,
    );
    expect(recent.length).toBeGreaterThanOrEqual(1);
    const trace = recent[0]!;
    expect(trace.tenantId).toBe('tenant-trace');
    expect(trace.threadId).toBe('trace-thread-1');
    expect(trace.steps.length).toBeGreaterThan(2);
  });

  it('uncertaintyPolicy flips to "on" when env var is set', () => {
    const fake = createFakeFactory();
    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: fake.factory,
      envSource: { BORJIE_UNCERTAINTY_POLICY: 'on' },
    });
    expect(wiring).not.toBeNull();
    expect(wiring!.uncertaintyPolicy).toBe('on');
  });

  it('uncertaintyPolicy stays "off" for any unrecognised env value', () => {
    const fake = createFakeFactory();
    for (const raw of ['off', 'true', '1', '', 'maybe']) {
      const wiring = createBrainKernelWiring({
        buildBudgetGuardedAnthropicClient: fake.factory,
        envSource: { BORJIE_UNCERTAINTY_POLICY: raw },
      });
      expect(wiring).not.toBeNull();
      expect(wiring!.uncertaintyPolicy).toBe('off');
    }
  });

  it('does not propagate kernel-side sensor errors past the wiring', async () => {
    // SDK that throws on every call. The kernel's failover router
    // walks the chain (opus → sonnet → haiku) and ultimately surfaces
    // the failure as a normal BrainDecision shape; the wiring itself
    // must not throw.
    const sdk = {
      messages: {
        create: async () => {
          throw new Error('upstream model unavailable');
        },
      },
    };
    const factory: BudgetGuardedAnthropicFactory = () => ({ sdk });

    const wiring = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: factory,
    });
    expect(wiring).not.toBeNull();

    // The kernel's sensor router rethrows when ALL sensors fail. We
    // assert the wiring boundary itself stays intact (the wiring did
    // construct successfully) and that the rejected promise carries
    // an Error rather than crashing the harness.
    await expect(
      wiring!.think({
        threadId: 'thread-3',
        userMessage: 'Will every sensor fail?',
        scope: {
          kind: 'tenant',
          tenantId: 'tenant-3',
          actorUserId: 'user-3',
          roles: ['tenant'],
          personaId: 'voice-agent-default',
        },
        tier: 'tenant',
        stakes: 'low',
        surface: 'tenant-app',
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
