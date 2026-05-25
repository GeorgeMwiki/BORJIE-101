/**
 * Wave-13 — kernel integration tests for the 5 newly-ported brain
 * primitives:
 *
 *   F2  → tier-policy gate                  (kernel.ts)
 *   F7  → isolated-vm sandbox primitive     (power-tools/sandbox.ts)
 *   F9  → LATS alternative planner          (orchestrator/planner-dispatcher.ts)
 *   F10 → DecisionTrace store + default     (kernel/decision-trace.ts)
 *   F11 → Reflexion loader + sleep bundle   (kernel.ts → loadReflexions)
 *
 * Each block verifies that the integration actually fires (vs. just
 * being barrel-exported) AND that the kernel still works when the
 * integration is bypassed (the back-compat invariant).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createBrainKernel,
  createDecisionTraceRecorder,
  createInMemoryDecisionTraceStore,
  createSupabaseDecisionTraceStore,
  setDefaultDecisionTraceStore,
  getDefaultDecisionTraceStore,
  _resetDefaultDecisionTraceStoreForTests,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
  type DecisionTrace,
} from '../index.js';
import type { ScopeContext } from '../../types.js';
import {
  assertTierPolicy,
  type RolePolicy,
  type PolicyRule,
} from '../../policy-gate/assertions.js';
import {
  createSandboxPowerTool,
  type SandboxPolicyRunner,
} from '../power-tools/sandbox.js';
import type {
  PowerToolContext,
} from '../power-tools/types.js';
import {
  dispatchPlanner,
  pickPlannerForStakes,
  type Evaluator,
  type Expander,
} from '../orchestrator/index.js';
import type {
  ReflexionLoaderPort,
  LoadedReflexion,
  LoadedGuideline,
} from '../reflexion/index.js';
import type {
  SandboxPolicyInput,
  SandboxPolicyResult,
} from '../sandbox/sandbox-policy.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_wave13',
  actorUserId: 'u_wave13',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: `th-${Math.random().toString(36).slice(2, 8)}`,
    userMessage: 'How is the rent ledger this month?',
    scope: TENANT_SCOPE,
    tier: 'property',
    stakes: 'medium',
    surface: 'estate-manager-app',
    ...over,
  };
}

function scriptedSensor(text: string): Sensor {
  return {
    id: 'fake-sensor',
    modelId: 'fake-model',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'fake-model',
        sensorId: 'fake-sensor',
      };
    },
  };
}

function spySensor(text: string): {
  readonly sensor: Sensor;
  readonly seen: { lastSystem: string };
} {
  const seen = { lastSystem: '' };
  const sensor: Sensor = {
    id: 'spy-sensor',
    modelId: 'spy-model',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      seen.lastSystem = args.system;
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'spy-model',
        sensorId: 'spy-sensor',
      };
    },
  };
  return { sensor, seen };
}

function makePowerToolCtx(
  over: Partial<PowerToolContext> = {},
): PowerToolContext {
  return {
    callerId: 'u_wave13',
    tier: 'estate-manager',
    tenantId: 't_wave13',
    threadId: 'th-1',
    approvalRecordId: null,
    auditSink: null,
    clock: () => new Date('2026-05-22T12:00:00Z'),
    ...over,
  };
}

const READ_RULE: PolicyRule = {
  id: 'rule-read-rent-ledger',
  role: 'ESTATE_MANAGER',
  action: 'md:read-rent-ledger',
  verdict: 'allow',
  reason: 'estate managers may read the rent ledger for their own org',
  principle: 'estate-manager-read-own-org-domain',
  examples: ['md:read-tenant-arrears', 'md:read-property-list'],
};

const WRITE_RULE: PolicyRule = {
  id: 'rule-write-payouts',
  role: 'ESTATE_MANAGER',
  action: 'md:initiate-payout',
  verdict: 'deny',
  reason: 'payouts are owner-only — estate managers cannot move money',
  principle: 'no-money-movement-without-owner',
  examples: ['md:mpesa-disburse', 'md:bank-transfer'],
};

const ESTATE_MANAGER_POLICY: RolePolicy = {
  role: 'ESTATE_MANAGER',
  rules: [READ_RULE, WRITE_RULE],
};

// ─────────────────────────────────────────────────────────────────────
// F2 — tier-policy gate
// ─────────────────────────────────────────────────────────────────────

describe('Wave-13 F2 — tier-policy gate at kernel.think()', () => {
  it('passes when the role can perform the action', async () => {
    const sensor = scriptedSensor('The ledger is healthy.');
    const kernel = createBrainKernel({
      sensors: [sensor],
      tierPolicy: { policy: ESTATE_MANAGER_POLICY },
    });
    const decision = await kernel.think(
      makeRequest({ action: 'md:read-rent-ledger' }),
    );
    expect(decision.kind).toBe('answer');
  });

  it('refuses with tier_refusal: prefix when the action is denied', async () => {
    const sensor = scriptedSensor('should never be called');
    const kernel = createBrainKernel({
      sensors: [sensor],
      tierPolicy: { policy: ESTATE_MANAGER_POLICY },
    });
    const decision = await kernel.think(
      makeRequest({ action: 'md:bank-transfer' }),
    );
    expect(decision.kind).toBe('refusal');
    if (decision.kind === 'refusal') {
      expect(decision.reason.startsWith('tier_refusal:')).toBe(true);
      expect(decision.gateThatRefused).toBe('policy');
    }
  });

  it('skips the gate when the request has no action field', async () => {
    const sensor = scriptedSensor('No action gate fired.');
    const kernel = createBrainKernel({
      sensors: [sensor],
      tierPolicy: { policy: ESTATE_MANAGER_POLICY },
    });
    const decision = await kernel.think(makeRequest());
    expect(decision.kind).toBe('answer');
  });

  it('skips the gate when no policy dep is wired (back-compat)', async () => {
    const sensor = scriptedSensor('Policy gate is a no-op without deps.');
    const kernel = createBrainKernel({ sensors: [sensor] });
    const decision = await kernel.think(
      makeRequest({ action: 'md:bank-transfer' }),
    );
    expect(decision.kind).toBe('answer');
  });

  it('exposes the underlying assertTierPolicy contract for direct callers', () => {
    const ok = assertTierPolicy(ESTATE_MANAGER_POLICY, 'md:read-rent-ledger');
    expect(ok.ok).toBe(true);
    const ko = assertTierPolicy(ESTATE_MANAGER_POLICY, 'md:mpesa-disburse');
    expect(ko.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// F7 — sandbox primitive wired into power_tool.sandbox
// ─────────────────────────────────────────────────────────────────────

describe('Wave-13 F7 — sandbox power-tool wired to runInSandboxWithPolicy', () => {
  it('still refuses with NOT_IMPLEMENTED when neither route is wired', async () => {
    const tool = createSandboxPowerTool(null);
    const out = await tool.execute(makePowerToolCtx(), {
      code: '1+1',
    });
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') {
      expect(out.reasonCode).toBe('NOT_IMPLEMENTED');
    }
  });

  it('routes through the policy runner when supplied (Wave-13 path)', async () => {
    const observed: { lastTier: string | null } = { lastTier: null };
    const policyRunner: SandboxPolicyRunner = {
      async run(input: SandboxPolicyInput): Promise<SandboxPolicyResult> {
        observed.lastTier = input.tier;
        return {
          ok: true,
          result: 42,
          durationMs: 3,
          memoryUsedBytes: 0,
          enforcedCaps: {
            timeoutMs: input.timeoutMs ?? 1000,
            memoryMb: 8,
            codeBytes: 5 * 1024,
          },
        };
      },
    };
    const tool = createSandboxPowerTool(null, { policyRunner });
    const out = await tool.execute(
      makePowerToolCtx({ tier: 'estate-manager' }),
      { code: 'return 41+1' },
    );
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.output.value).toBe(42);
      expect(out.output.action).toBe('sandbox');
    }
    // Tier mapping: estate-manager → enterprise on the F7 ladder.
    expect(observed.lastTier).toBe('enterprise');
  });

  it('forwards policy-runner failures as kind:failed', async () => {
    const policyRunner: SandboxPolicyRunner = {
      async run(_input): Promise<SandboxPolicyResult> {
        return {
          ok: false,
          error: { code: 'SANDBOX_TIMEOUT', message: 'budget exceeded' },
          durationMs: 5000,
          memoryUsedBytes: 0,
          enforcedCaps: { timeoutMs: 5000, memoryMb: 8, codeBytes: 5 * 1024 },
        };
      },
    };
    const tool = createSandboxPowerTool(null, { policyRunner });
    const out = await tool.execute(makePowerToolCtx(), {
      code: 'while (true) {}',
    });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.message).toContain('budget exceeded');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// F9 — LATS planner dispatcher (stakes-aware switch)
// ─────────────────────────────────────────────────────────────────────

describe('Wave-13 F9 — stakes-aware planner dispatcher', () => {
  // Each `expander` returns one trivial child so the search runs at
  // least one expansion regardless of the planner backend; the
  // `evaluator` scores by string length so the tree converges quickly.
  const expander: Expander = async (parent, k) => {
    const out = [] as Array<ReturnType<typeof makeChild>>;
    for (let i = 0; i < k; i += 1) {
      out.push(makeChild(parent.id, parent.depth + 1, `${parent.content}-child${i}`));
    }
    return out;
  };
  const evaluator: Evaluator = async (thought) => {
    // Higher score the deeper we go — encourages convergence.
    return Math.min(1, thought.depth * 0.3);
  };

  function makeChild(parentId: string, depth: number, content: string) {
    return {
      id: 'placeholder',
      content,
      depth,
      parentId,
      score: 0,
      explored: false,
    };
  }

  it('routes low/medium stakes to ToT', () => {
    expect(pickPlannerForStakes('low')).toBe('tot');
    expect(pickPlannerForStakes('medium')).toBe('tot');
  });

  it('routes high/critical stakes to LATS', () => {
    expect(pickPlannerForStakes('high')).toBe('lats');
    expect(pickPlannerForStakes('critical')).toBe('lats');
  });

  it('runs the ToT planner for low stakes', async () => {
    const result = await dispatchPlanner('root goal', {
      stakes: 'low',
      evaluator,
      expander,
      tot: { maxDepth: 2, branchingFactor: 2 },
    });
    expect(result.planner).toBe('tot');
    expect(result.bestPath.length).toBeGreaterThan(0);
    if (result.raw.kind === 'tot') {
      // Discriminator narrows so we can read the ToT-only field.
      expect(result.raw.plan.rootGoal).toBe('root goal');
    }
  });

  it('runs the LATS planner for critical stakes', async () => {
    const result = await dispatchPlanner('root goal', {
      stakes: 'critical',
      evaluator,
      expander,
      lats: { maxIterations: 3, maxDepth: 2, branchingFactor: 2 },
    });
    expect(result.planner).toBe('lats');
    expect(result.bestPath.length).toBeGreaterThan(0);
    if (result.raw.kind === 'lats') {
      expect(result.raw.plan.iterationsUsed).toBeGreaterThan(0);
    }
  });

  it('respects forcePlanner override regardless of stakes', async () => {
    const result = await dispatchPlanner('root goal', {
      stakes: 'low',
      forcePlanner: 'lats',
      evaluator,
      expander,
      lats: { maxIterations: 2, maxDepth: 2, branchingFactor: 2 },
    });
    expect(result.planner).toBe('lats');
  });

  it('runs both planners in parallel and picks the better score', async () => {
    const result = await dispatchPlanner('root goal', {
      stakes: 'low',
      parallel: true,
      evaluator,
      expander,
      tot: { maxDepth: 2, branchingFactor: 2 },
      lats: { maxIterations: 2, maxDepth: 2, branchingFactor: 2 },
    });
    expect(['tot', 'lats']).toContain(result.planner);
  });
});

// ─────────────────────────────────────────────────────────────────────
// F10 — DecisionTrace store + default-store singleton
// ─────────────────────────────────────────────────────────────────────

describe('Wave-13 F10 — DecisionTrace store wiring', () => {
  beforeEach(() => {
    _resetDefaultDecisionTraceStoreForTests();
  });
  afterEach(() => {
    _resetDefaultDecisionTraceStoreForTests();
  });

  it('records branches when the recorder is wired into the kernel', async () => {
    const store = createInMemoryDecisionTraceStore();
    const traceRecorder = createDecisionTraceRecorder({ store });
    const sensor = scriptedSensor('Answer for trace.');
    const kernel = createBrainKernel({ sensors: [sensor], traceRecorder });
    await kernel.think(makeRequest());
    // The trace is finalised fire-and-forget; allow microtasks to drain.
    await new Promise((r) => setImmediate(r));
    const recent = await store.recent({ tenantId: 't_wave13', limit: 10 });
    expect(recent.length).toBe(1);
    expect(recent[0]!.steps.length).toBeGreaterThan(2);
  });

  it('setDefaultDecisionTraceStore installs a global and returns prior', () => {
    expect(getDefaultDecisionTraceStore()).toBeNull();
    const inner = createInMemoryDecisionTraceStore();
    const wrapped = createSupabaseDecisionTraceStore({ inner });
    const previous = setDefaultDecisionTraceStore(wrapped);
    expect(previous).toBeNull();
    expect(getDefaultDecisionTraceStore()).toBe(wrapped);
  });

  it('createSupabaseDecisionTraceStore delegates to inner + fires onWrite', async () => {
    const inner = createInMemoryDecisionTraceStore();
    const seen: DecisionTrace[] = [];
    const supa = createSupabaseDecisionTraceStore({
      inner,
      onWrite: (t) => seen.push(t),
    });
    const trace: DecisionTrace = {
      thoughtId: 'thought-1',
      tenantId: 't_wave13',
      threadId: 'th-1',
      startedAt: '2026-05-22T12:00:00Z',
      finishedAt: '2026-05-22T12:00:01Z',
      totalDurationMs: 1000,
      steps: [],
      outcome: 'answer',
    };
    await supa.record(trace);
    expect(seen.length).toBe(1);
    expect(seen[0]!.thoughtId).toBe('thought-1');
    const recent = await supa.recent({ tenantId: 't_wave13', limit: 1 });
    expect(recent[0]?.thoughtId).toBe('thought-1');
  });

  it('kernel works when no trace recorder is wired (back-compat)', async () => {
    const sensor = scriptedSensor('No-trace answer.');
    const kernel = createBrainKernel({ sensors: [sensor] });
    const decision = await kernel.think(makeRequest());
    expect(decision.kind).toBe('answer');
  });
});

// ─────────────────────────────────────────────────────────────────────
// F11 — Reflexion loader → prepended to system prompt
// ─────────────────────────────────────────────────────────────────────

describe('Wave-13 F11 — reflexion loader prepended at step 6', () => {
  function makeLoader(opts?: {
    readonly throwOnReflexions?: boolean;
    readonly reflexions?: ReadonlyArray<LoadedReflexion>;
    readonly guidelines?: ReadonlyArray<LoadedGuideline>;
  }): ReflexionLoaderPort {
    return {
      async recentReflexions() {
        if (opts?.throwOnReflexions) throw new Error('boom');
        return opts?.reflexions ?? [];
      },
      async recentGuidelines() {
        return opts?.guidelines ?? [];
      },
    };
  }

  const sampleReflexion: LoadedReflexion = {
    id: 'r1',
    tenantId: 't_wave13',
    userId: 'u_wave13',
    sessionId: 'sess-1',
    taskId: null,
    reflection: 'When user asks for arrears, always cite the source row id.',
    outcome: 'success',
    importance: 0.8,
    recordedAt: '2026-05-20T00:00:00Z',
    clusterId: null,
  };

  const sampleGuideline: LoadedGuideline = {
    id: 'g1',
    tenantId: 't_wave13',
    userId: null,
    slug: 'cite-row-ids',
    body: 'Always cite the row id when quoting an arrears figure.',
    confidence: 0.9,
    updatedAt: '2026-05-21T00:00:00Z',
  };

  it('prepends a "Recent self-critiques" block when the loader returns content', async () => {
    const { sensor, seen } = spySensor('Cited as requested.');
    const reflexionLoader = makeLoader({
      reflexions: [sampleReflexion],
      guidelines: [sampleGuideline],
    });
    const kernel = createBrainKernel({ sensors: [sensor], reflexionLoader });
    await kernel.think(makeRequest());
    expect(seen.lastSystem).toContain('Recent self-critiques');
    expect(seen.lastSystem).toContain('cite the row id');
  });

  it('omits the block when the loader returns an empty bundle', async () => {
    const { sensor, seen } = spySensor('Nothing to cite yet.');
    const reflexionLoader = makeLoader({ reflexions: [], guidelines: [] });
    const kernel = createBrainKernel({ sensors: [sensor], reflexionLoader });
    await kernel.think(makeRequest());
    expect(seen.lastSystem).not.toContain('Recent self-critiques');
  });

  it('swallows loader errors and still produces an answer (side-channel)', async () => {
    const { sensor, seen } = spySensor('Loader threw, kernel kept going.');
    const reflexionLoader = makeLoader({ throwOnReflexions: true });
    const kernel = createBrainKernel({ sensors: [sensor], reflexionLoader });
    const decision = await kernel.think(makeRequest());
    expect(decision.kind).toBe('answer');
    // Even with the loader throwing, the kernel never propagates the
    // error — the system prompt simply skips the section.
    expect(seen.lastSystem).not.toContain('Recent self-critiques');
  });

  it('skips the loader entirely when no dep is wired (back-compat)', async () => {
    const { sensor, seen } = spySensor('No loader wired.');
    const kernel = createBrainKernel({ sensors: [sensor] });
    await kernel.think(makeRequest());
    expect(seen.lastSystem).not.toContain('Recent self-critiques');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-cutting — all five gates can coexist
// ─────────────────────────────────────────────────────────────────────

describe('Wave-13 — all five integrations coexist on one kernel', () => {
  it('answer path passes through F2 + F10 + F11 without interference', async () => {
    const sensor = scriptedSensor('Composite answer.');
    const store = createInMemoryDecisionTraceStore();
    const traceRecorder = createDecisionTraceRecorder({ store });
    const reflexionLoader: ReflexionLoaderPort = {
      async recentReflexions() {
        return [];
      },
      async recentGuidelines() {
        return [];
      },
    };
    const kernel = createBrainKernel({
      sensors: [sensor],
      tierPolicy: { policy: ESTATE_MANAGER_POLICY },
      traceRecorder,
      reflexionLoader,
    });
    const decision = await kernel.think(
      makeRequest({ action: 'md:read-rent-ledger' }),
    );
    expect(decision.kind).toBe('answer');
    await new Promise((r) => setImmediate(r));
    const recent = await store.recent({ tenantId: 't_wave13', limit: 5 });
    expect(recent.length).toBe(1);
  });
});

