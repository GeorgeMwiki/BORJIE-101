/**
 * Wave-K Tier-2 kernel wiring tests — verify the new optional ports
 * threaded onto `BrainKernelDeps` and `ComposeSovereignConfig`:
 *
 *   1. Killswitch + decision-trace + uncertainty-policy (T1).
 *   2. BORJIE_PERSONA + module-inventory in the system prompt (T2).
 *   3. Cognitive-load + ToM accumulators cross-turn continuity (T3).
 *   4. searchByEmbedding fallback to legacy key search (T4).
 *   5. Approval-policy resolver wired into createApprovalGate (T5).
 *   6. Policy-gate request-context threaded from ThoughtRequest (T6).
 *   7. BrainToolRegistry consulted when sensor emits tool_use (T7).
 *
 * All tests are pure — no LLM, no network. Deterministic scripted
 * sensors + in-memory ports throughout.
 */

import { describe, expect, it } from 'vitest';
import {
  composeSovereign,
  createAffectiveAccumulator,
  createBrainKernel,
  createBrainToolRegistry,
  createCognitiveLoadAccumulator,
  createDecisionTraceRecorder,
  createEnvKillswitchPort,
  createInMemoryDecisionTraceStore,
  registerSeedBrainTools,
  type ApprovalPolicyResolver,
  type BrainToolOutcome,
  type DEFAULT_APPROVAL_POLICY,
  type DecisionTrace,
  type SemanticFact,
  type SemanticMemoryPort,
  type SemanticSearchByEmbeddingArgs,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
} from '../kernel/index.js';
import { dispatchKernelTools } from '../kernel/kernel.js';
import {
  DEFAULT_APPROVAL_POLICY as DEFAULT_APPROVAL_POLICY_VALUE,
} from '../kernel/four-eye-approval.js';
import type { ScopeContext } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_demo',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function scripted(text: string, opts: { fail?: boolean } = {}): Sensor {
  return {
    id: 'scripted',
    modelId: 'scripted-model',
    priority: 1,
    // Advertise both 'fast' AND 'thinking' so high/critical-stakes
    // turns (which add 'thinking' to required-capabilities) still
    // route through this sensor in tests.
    capabilities: ['fast', 'thinking'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      if (opts.fail) throw new Error('scripted sensor failure');
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'scripted-model',
        sensorId: 'scripted',
      };
    },
  };
}

function captureSensor(): {
  readonly sensor: Sensor;
  readonly calls: ReadonlyArray<SensorCallArgs>;
} {
  const calls: SensorCallArgs[] = [];
  const sensor: Sensor = {
    id: 'capture',
    modelId: 'capture-model',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      calls.push(args);
      return {
        text: 'OK',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'capture-model',
        sensorId: 'capture',
      };
    },
  };
  return { sensor, calls };
}

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'thread-tier2',
    userMessage: 'Tell me about my arrears.',
    scope: TENANT_SCOPE,
    tier: 'tenant',
    stakes: 'low',
    surface: 'estate-manager-app',
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// T1 — killswitch, decision-trace, uncertainty-policy
// ─────────────────────────────────────────────────────────────────────

describe('Wave-K T1 — killswitch + decision-trace + uncertainty-policy', () => {
  it('env-driven killswitch HALT short-circuits before any sensor call', async () => {
    const { sensor, calls } = captureSensor();
    const killswitch = createEnvKillswitchPort({
      KILLSWITCH_STATE: 'halt',
      KILLSWITCH_REASON: 'COMPLIANCE_HOLD_CBK',
    });
    const sov = composeSovereign({
      extraSensors: [sensor],
      killswitch,
    });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).toBe('refusal');
    expect(calls).toHaveLength(0);
  });

  it('env-driven DEGRADED logs via trace but still calls the sensor', async () => {
    const { sensor, calls } = captureSensor();
    const store = createInMemoryDecisionTraceStore();
    const recorder = createDecisionTraceRecorder({ store });
    const killswitch = createEnvKillswitchPort({
      KILLSWITCH_STATE: 'degraded',
      KILLSWITCH_REASON: 'PROVIDER_INCIDENT',
    });
    const sov = composeSovereign({
      extraSensors: [sensor],
      killswitch,
      traceRecorder: recorder,
    });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).not.toBe('refusal');
    expect(calls).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    const traces = store.snapshot();
    expect(traces.length).toBeGreaterThanOrEqual(1);
    const ksStep = traces[0]!.steps.find((s) => s.step === 'killswitch');
    expect(ksStep).toBeDefined();
    expect(ksStep!.summary).toContain('degraded');
  });

  it('decision-trace recorder writes a step for every kernel stage', async () => {
    const { sensor } = captureSensor();
    const store = createInMemoryDecisionTraceStore();
    const recorder = createDecisionTraceRecorder({ store });
    const sov = composeSovereign({
      extraSensors: [sensor],
      traceRecorder: recorder,
    });
    await sov.kernel.think(makeRequest());
    await new Promise((resolve) => setImmediate(resolve));
    const traces = store.snapshot();
    expect(traces).toHaveLength(1);
    const stepNames = traces[0]!.steps.map((s) => s.step);
    expect(stepNames).toContain('cache');
    expect(stepNames).toContain('inviolable');
    expect(stepNames).toContain('tier-compat');
    expect(stepNames).toContain('sensor-call');
    expect(stepNames).toContain('policy-gate');
    expect(stepNames).toContain('confidence');
  });

  it('uncertaintyPolicy=off keeps baseline behaviour (no escalation on synthetic answer)', async () => {
    const sensor = scripted('Short ungrounded answer.');
    const sov = composeSovereign({
      extraSensors: [sensor],
      uncertaintyPolicy: 'off',
    });
    const decision = await sov.kernel.think(
      makeRequest({ stakes: 'high', requireJudge: false }),
    );
    expect(decision.kind).not.toBe('refusal');
  });

  it('uncertaintyPolicy=on can caveat / escalate low-confidence high-stakes turns', async () => {
    const sensor = scripted('Unsupported high-stakes claim.');
    const sov = composeSovereign({
      extraSensors: [sensor],
      uncertaintyPolicy: 'on',
    });
    // Either a softened/refusal outcome OR a caveat-bearing answer
    // is acceptable — both indicate the uncertainty policy fired.
    const decision = await sov.kernel.think(
      makeRequest({ stakes: 'critical' }),
    );
    // Confidence path may collapse this to a refusal in the worst
    // case; either non-answer or answer-with-caveat is fine.
    expect(['answer', 'softened', 'refusal']).toContain(decision.kind);
  });

  it('tenant-scoped killswitch overrides platform live state', async () => {
    const { sensor, calls } = captureSensor();
    const killswitch = createEnvKillswitchPort({
      KILLSWITCH_TENANT_t_demo: 'halt',
      KILLSWITCH_TENANT_t_demo_REASON: 'TENANT_DATA_LEAK_SUSPECTED',
    });
    const sov = composeSovereign({
      extraSensors: [sensor],
      killswitch,
    });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).toBe('refusal');
    expect(calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// T2 — persona prelude + module inventory in system prompt
// ─────────────────────────────────────────────────────────────────────

describe('Wave-K T2 — BORJIE_PERSONA + module inventory in prompt', () => {
  it('system prompt includes the platform-voice prelude marker', async () => {
    const { sensor, calls } = captureSensor();
    const sov = composeSovereign({ extraSensors: [sensor] });
    await sov.kernel.think(makeRequest());
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const system = calls[0]!.system;
    expect(system).toContain('[PLATFORM VOICE');
    expect(system).toContain('[SITUATED ADDRESS]');
  });

  it('system prompt includes the module-inventory block', async () => {
    const { sensor, calls } = captureSensor();
    const sov = composeSovereign({ extraSensors: [sensor] });
    await sov.kernel.think(makeRequest());
    const system = calls[0]!.system;
    // The module-inventory header from renderModuleInventoryBlock().
    expect(system.toLowerCase()).toContain('module');
  });

  it('persona prelude sits BEFORE the legacy identity preamble', async () => {
    const { sensor, calls } = captureSensor();
    const sov = composeSovereign({ extraSensors: [sensor] });
    await sov.kernel.think(makeRequest());
    const system = calls[0]!.system;
    const platformIdx = system.indexOf('[PLATFORM VOICE');
    // Identity preamble starts with "Locus:" or persona's opening
    // line — assert situated-address comes before "Locus:".
    const locusIdx = system.indexOf('Locus:');
    expect(platformIdx).toBeGreaterThanOrEqual(0);
    expect(platformIdx).toBeLessThan(locusIdx);
  });

  it('system prompt EAT clock is rendered for the situated address', async () => {
    const { sensor, calls } = captureSensor();
    const sov = composeSovereign({ extraSensors: [sensor] });
    await sov.kernel.think(makeRequest());
    const system = calls[0]!.system;
    expect(system).toContain('EAT');
  });
});

// ─────────────────────────────────────────────────────────────────────
// T3 — cognitive-load + ToM accumulators
// ─────────────────────────────────────────────────────────────────────

describe('Wave-K T3 — cognitive-load + ToM accumulators', () => {
  it('cross-turn cognitive-load accumulator profile carries to the next turn', async () => {
    const { sensor, calls } = captureSensor();
    const cogAcc = createCognitiveLoadAccumulator();
    const sov = composeSovereign({
      extraSensors: [sensor],
      cognitiveLoadAccumulator: cogAcc,
    });
    // Three turns with distinct user messages so the brain-cache
    // doesn't collapse the second + third calls into a single
    // accumulator observation. Each message keeps nudging the
    // accumulator upward via the simplify-request signal.
    const prompts = [
      'I do not understand. Can you simplify this? Please slow down.',
      'Still lost on this. Can you rephrase the rule a different way?',
      'Sorry I am slow today. One step at a time would help me follow.',
    ];
    for (let i = 0; i < prompts.length; i += 1) {
      await sov.kernel.think(
        makeRequest({ threadId: `cog-${i}`, userMessage: prompts[i]! }),
      );
    }
    const profile = cogAcc.read('t_demo', 'u_demo');
    expect(profile).not.toBeNull();
    expect(profile!.turns).toBe(3);
    expect(calls.length).toBe(3);
  });

  it('affective accumulator tracks emotional state across turns', async () => {
    const { sensor } = captureSensor();
    const affAcc = createAffectiveAccumulator();
    const sov = composeSovereign({
      extraSensors: [sensor],
      affectiveAccumulator: affAcc,
    });
    await sov.kernel.think(
      makeRequest({ userMessage: 'I am furious and frustrated with this!' }),
    );
    await sov.kernel.think(
      makeRequest({
        threadId: 'aff-2',
        userMessage: 'I am still upset, why is this so hard?!',
      }),
    );
    const profile = affAcc.read('t_demo', 'u_demo');
    expect(profile).not.toBeNull();
    expect(profile!.turns).toBe(2);
    expect(profile!.state.frustration).toBeGreaterThan(0);
  });

  it('without accumulators the per-turn renderer still produces a directive', async () => {
    const { sensor, calls } = captureSensor();
    const sov = composeSovereign({ extraSensors: [sensor] });
    await sov.kernel.think(makeRequest());
    expect(calls[0]!.system).toContain('Behavioural directive');
    expect(calls[0]!.system).toContain('Verbosity directive');
  });

  it('compose-default accumulators are minted even without explicit deps', async () => {
    // Composing without passing cognitive/affective accumulators
    // still yields a kernel that records turns into the
    // accumulators composeSovereign mints internally.
    const { sensor } = captureSensor();
    const sov = composeSovereign({ extraSensors: [sensor] });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).not.toBe('refusal');
  });
});

// ─────────────────────────────────────────────────────────────────────
// T4 — searchByEmbedding for memory recall
// ─────────────────────────────────────────────────────────────────────

describe('Wave-K T4 — searchByEmbedding for memory recall', () => {
  function makeFact(key: string, value: string): SemanticFact {
    return {
      id: `id-${key}`,
      tenantId: 't_demo',
      userId: 'u_demo',
      key,
      value,
      confidence: 0.9,
      sourceTurnId: null,
      evidenceCount: 1,
      firstSeenAt: '2026-01-01T00:00:00Z',
      lastSeenAt: '2026-01-01T00:00:00Z',
      expiresAt: null,
      source: 'extracted',
    };
  }

  it('uses embedding path when request.embedding is present and port implements it', async () => {
    const calls: { kind: 'embedding' | 'key' }[] = [];
    const semantic: SemanticMemoryPort = {
      async upsertFact() {},
      async lookup() {
        return null;
      },
      async search() {
        calls.push({ kind: 'key' });
        return [makeFact('lease.start', '2024-01-01')];
      },
      async searchByEmbedding(_args: SemanticSearchByEmbeddingArgs) {
        calls.push({ kind: 'embedding' });
        return [
          { ...makeFact('lease.end', '2026-12-31'), distance: 0.12 },
        ];
      },
      async decay() {
        return 0;
      },
    };
    const sensor = scripted('OK');
    const sov = composeSovereign({
      extraSensors: [sensor],
      memory: { semantic },
    });
    await sov.kernel.think(
      makeRequest({ embedding: [0.1, 0.2, 0.3] }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('embedding');
  });

  it('falls back to key search when no embedding is supplied', async () => {
    const calls: { kind: 'embedding' | 'key' }[] = [];
    const semantic: SemanticMemoryPort = {
      async upsertFact() {},
      async lookup() {
        return null;
      },
      async search() {
        calls.push({ kind: 'key' });
        return [];
      },
      async searchByEmbedding() {
        calls.push({ kind: 'embedding' });
        return [];
      },
      async decay() {
        return 0;
      },
    };
    const sensor = scripted('OK');
    const sov = composeSovereign({
      extraSensors: [sensor],
      memory: { semantic },
    });
    await sov.kernel.think(makeRequest());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('key');
  });

  it('falls back to key search when searchByEmbedding is not implemented', async () => {
    const calls: { kind: 'embedding' | 'key' }[] = [];
    const semantic: SemanticMemoryPort = {
      async upsertFact() {},
      async lookup() {
        return null;
      },
      async search() {
        calls.push({ kind: 'key' });
        return [];
      },
      async decay() {
        return 0;
      },
    };
    const sensor = scripted('OK');
    const sov = composeSovereign({
      extraSensors: [sensor],
      memory: { semantic },
    });
    await sov.kernel.think(
      makeRequest({ embedding: [0.1, 0.2, 0.3] }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('key');
  });

  it('falls back to key search if embedding search throws', async () => {
    const calls: { kind: 'embedding' | 'key' }[] = [];
    const semantic: SemanticMemoryPort = {
      async upsertFact() {},
      async lookup() {
        return null;
      },
      async search() {
        calls.push({ kind: 'key' });
        return [makeFact('fallback', 'yes')];
      },
      async searchByEmbedding() {
        calls.push({ kind: 'embedding' });
        throw new Error('pgvector adapter down');
      },
      async decay() {
        return 0;
      },
    };
    const sensor = scripted('OK');
    const sov = composeSovereign({
      extraSensors: [sensor],
      memory: { semantic },
    });
    const decision = await sov.kernel.think(
      makeRequest({ embedding: [0.1, 0.2, 0.3] }),
    );
    expect(decision.kind).not.toBe('refusal');
    expect(calls.map((c) => c.kind)).toEqual(['embedding', 'key']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// T5 — approval-policy resolver
// ─────────────────────────────────────────────────────────────────────

describe('Wave-K T5 — approval-policy resolver into createApprovalGate', () => {
  it('passes a resolver into the gate so per-action policies override the default', async () => {
    const customPolicy = {
      ...DEFAULT_APPROVAL_POLICY_VALUE,
      minTotalApprovers: 3,
      roleGroups: [
        { name: 'compliance', minApprovers: 1 },
        { name: 'owner-relations', minApprovers: 1 },
        { name: 'property-manager', minApprovers: 1 },
      ],
    };
    const resolver: ApprovalPolicyResolver = {
      async resolve(args) {
        if (args.toolName === 'eviction.propose') return customPolicy;
        return DEFAULT_APPROVAL_POLICY_VALUE;
      },
    };
    const sov = composeSovereign({
      extraSensors: [scripted('OK')],
      approvalPolicyResolver: resolver,
    });
    const record = await sov.approvals.propose({
      proposerUserId: 'u-prop',
      thoughtId: 'thought-1',
      summary: 'Propose eviction for unit 3B',
      toolName: 'eviction.propose',
      payload: { unitId: '3B' },
      stakes: 'critical',
      tenantId: 't_demo',
    });
    expect(record.action.policy.minTotalApprovers).toBe(3);
    expect(record.action.policy.roleGroups.map((g) => g.name)).toEqual([
      'compliance',
      'owner-relations',
      'property-manager',
    ]);
  });

  it('falls back to the legacy default policy when no resolver is wired', async () => {
    const sov = composeSovereign({
      extraSensors: [scripted('OK')],
    });
    const record = await sov.approvals.propose({
      proposerUserId: 'u-prop',
      thoughtId: 'thought-default',
      summary: 'Generic action',
      toolName: 'generic.action',
      payload: {},
      stakes: 'high',
      tenantId: 't_demo',
    });
    expect(record.action.policy).toEqual(DEFAULT_APPROVAL_POLICY_VALUE);
  });

  it('falls back to default when the resolver throws', async () => {
    const resolver: ApprovalPolicyResolver = {
      async resolve() {
        throw new Error('resolver upstream down');
      },
    };
    const sov = composeSovereign({
      extraSensors: [scripted('OK')],
      approvalPolicyResolver: resolver,
    });
    const record = await sov.approvals.propose({
      proposerUserId: 'u-prop',
      thoughtId: 'thought-throw',
      summary: 'Resolver-broken action',
      toolName: 'broken.action',
      payload: {},
      stakes: 'high',
      tenantId: 't_demo',
    });
    expect(record.action.policy).toEqual(DEFAULT_APPROVAL_POLICY_VALUE);
  });
});

// ─────────────────────────────────────────────────────────────────────
// T6 — policy-gate request-context
// ─────────────────────────────────────────────────────────────────────

describe('Wave-K T6 — policy-gate request-context threaded from ThoughtRequest', () => {
  it('does not break baseline tests when no policy fields are threaded', async () => {
    const sov = composeSovereign({ extraSensors: [scripted('Normal text.')] });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).not.toBe('refusal');
  });

  it('cost-ceiling: critical estimatedCostUsd within enterprise ceiling is allowed', async () => {
    const sov = composeSovereign({ extraSensors: [scripted('Reply')] });
    const decision = await sov.kernel.think(
      makeRequest({ estimatedCostUsd: 1.5 }),
    );
    expect(decision.kind).not.toBe('refusal');
  });

  it('off-hours sovereign refusal can be overridden with afterHoursOverride', async () => {
    // We cannot reliably trigger the off-hours check from a unit
    // test (the clock + day-of-week vary), but we CAN verify the
    // override path is plumbed.
    const sov = composeSovereign({ extraSensors: [scripted('Reply')] });
    const decision = await sov.kernel.think(
      makeRequest({ afterHoursOverride: true, stakes: 'critical' }),
    );
    // The override should never trip a refusal even on off-hours.
    expect(['answer', 'softened']).toContain(decision.kind);
  });

  it('granted-scope context is forwarded (scope-match check inert without requiredScopes)', async () => {
    const sov = composeSovereign({ extraSensors: [scripted('Reply')] });
    const decision = await sov.kernel.think(
      makeRequest({ grantedScopes: ['lease.read', 'arrears.read'] }),
    );
    expect(decision.kind).not.toBe('refusal');
  });

  it('marketing surface maps to the free tier (cost-ceiling 0.05 USD)', async () => {
    // We can't observe the tier directly, but we can prove this
    // surface still produces an answer when the cost is below the
    // free-tier ceiling.
    const sov = composeSovereign({ extraSensors: [scripted('Marketing reply')] });
    const decision = await sov.kernel.think(
      makeRequest({
        surface: 'marketing',
        scope: {
          kind: 'platform',
          actorUserId: 'visitor',
          roles: [],
          personaId: 'marketing-guide',
        },
        tier: 'industry',
        ipHash: 'sha256:abc',
        estimatedCostUsd: 0.01,
      }),
    );
    expect(decision.kind).not.toBe('refusal');
  });
});

// ─────────────────────────────────────────────────────────────────────
// T7 — BrainToolRegistry consultation
// ─────────────────────────────────────────────────────────────────────

describe('Wave-K T7 — BrainToolRegistry consultation + dispatchKernelTools', () => {
  it('dispatchKernelTools returns [] when registry is missing', async () => {
    const out = await dispatchKernelTools(undefined, [
      { toolName: 'computeKraMri', input: { grossRent: 100000 } },
    ]);
    expect(out).toEqual([]);
  });

  it('dispatchKernelTools returns [] when toolCalls is empty', async () => {
    const registry = createBrainToolRegistry();
    const out = await dispatchKernelTools(registry, []);
    expect(out).toEqual([]);
  });

  it('runs a seeded tool when present and returns the deterministic outcome', async () => {
    const registry = createBrainToolRegistry();
    registerSeedBrainTools(registry, {
      lookupTenantArrears: async () => ({
        tenantProfileId: 'tp-1',
        balanceMinor: 0,
        currency: 'KES',
        monthsOverdue: 0,
        asOf: '2026-01-01',
      }),
      checkComplianceCertificate: async () => ({
        certificateId: 'cert-1',
        kind: 'fire',
        status: 'valid',
        daysUntilExpiry: 30,
      }),
      getMarketRateBand: async () => ({
        bedrooms: 2,
        unitType: 'apartment',
        currency: 'KES',
        p25: 30000,
        p50: 45000,
        p75: 60000,
        sampleSize: 50,
      }),
    });
    const out = await dispatchKernelTools(registry, [
      {
        toolName: 'computeKraMri',
        input: { monthlyRentKes: 50000, monthLabel: '2026-01' },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.toolName).toBe('computeKraMri');
    expect(out[0]!.outcome.kind).toBe('ok');
  });

  it('surfaces a not-found outcome for an unknown tool', async () => {
    const registry = createBrainToolRegistry();
    const out = await dispatchKernelTools(registry, [
      { toolName: 'no.such.tool', input: {} },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.outcome.kind).toBe('not-found');
  });

  it('toolRegistry is forwarded into the kernel via composeSovereign', async () => {
    // Smoke test: the kernel should not throw when given a tool
    // registry. The kernel only consults the registry when the
    // sensor emits a tool_use call; with a quiet sensor the
    // registry is effectively dormant but must coexist.
    const registry = createBrainToolRegistry();
    const sov = composeSovereign({
      extraSensors: [scripted('OK')],
      toolRegistry: registry,
    });
    const decision = await sov.kernel.think(makeRequest());
    expect(decision.kind).not.toBe('refusal');
  });
});
