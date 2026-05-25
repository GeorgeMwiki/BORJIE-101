/**
 * End-to-end integration test for the Nyumba Mind sovereign AI stack.
 *
 * Drives `composeSovereign()` with stubbed sensors and in-memory sinks
 * to prove the full "personal AI per user" flow works without needing
 * a browser, real Anthropic, or real Postgres.
 *
 * Covers:
 *   1. Per-user brain isolation (cache keys + thoughtIds)
 *   2. Surface → persona routing for every supported surface
 *   3. Four-eye approval lifecycle (propose / sign / reject / refusal)
 *   4. Daily briefing composer (bullets + headline)
 *   5. Proactive nudge router with dedupe
 *   6. Inviolable refusals (bulk-PII, cross-tenant)
 *   7. Persona drift detection + recording
 *   8. Confidence vector + provenance sink
 *   9. CoT reservoir capture rates by stakes
 */

import { describe, it, expect } from 'vitest';
import {
  composeSovereign,
  createInMemoryCotReservoirSink,
  createInMemoryPersonaDriftSink,
  createInMemoryProvenanceSink,
  createInMemoryApprovalStore,
  createInMemoryNudgeDedupe,
  selectPersona,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type SovereignBrain,
  type SubstrateSinks,
  type UserProfile,
  type ThoughtRequest,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────

const FIXED_DATE = new Date('2026-05-05T08:00:00.000Z');

const PROFILE: UserProfile = {
  userId: 'u_jane',
  displayName: 'Jane Mwikila',
  role: 'platform admin',
  affiliation: 'Borjie HQ',
  greetingStyle: 'warm',
};

const PLATFORM_SCOPE: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_jane',
  roles: ['platform-admin'],
  personaId: 'sovereign-admin',
};

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_acme',
  actorUserId: 'u_alpha',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function stubSensor(text: string, opts: { thought?: string | null } = {}): Sensor {
  return {
    id: 'stub',
    modelId: 'stub-1',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text,
        thought: opts.thought ?? null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'stub-1',
        sensorId: 'stub',
      };
    },
  };
}

function throwingSensor(): Sensor {
  return {
    id: 'must-not-call',
    modelId: 'must-not-call',
    priority: 1,
    capabilities: ['fast'],
    async call() {
      throw new Error('sensor was called when it should not have been');
    },
  };
}

interface BuiltSovereign {
  readonly sov: SovereignBrain;
  readonly cot: ReturnType<typeof createInMemoryCotReservoirSink>;
  readonly drift: ReturnType<typeof createInMemoryPersonaDriftSink>;
  readonly provenance: ReturnType<typeof createInMemoryProvenanceSink>;
}

function buildSovereign(args: {
  readonly sensor?: Sensor;
  readonly rng?: () => number;
}): BuiltSovereign {
  const cot = createInMemoryCotReservoirSink();
  const drift = createInMemoryPersonaDriftSink();
  const provenance = createInMemoryProvenanceSink();
  const sinks: SubstrateSinks = { cot, drift, provenance };
  const sov = composeSovereign({
    extraSensors: [args.sensor ?? stubSensor('All quiet on the estate.')],
    substrateSinks: sinks,
    approvalStore: createInMemoryApprovalStore(),
    nudgeDedupe: createInMemoryNudgeDedupe(),
    clock: () => FIXED_DATE,
    ...(args.rng ? { rng: args.rng } : {}),
  });
  return { sov, cot, drift, provenance };
}

function thoughtReq(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th-default',
    userMessage: 'How is collection going?',
    scope: PLATFORM_SCOPE,
    tier: 'industry',
    stakes: 'low',
    surface: 'platform-hq',
    ...over,
  };
}

// Brief async pause so the fire-and-forget provenance write has time
// to land in the in-memory sink before assertions run.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ─────────────────────────────────────────────────────────────────────
// 1. Kernel — basic answer shape and provenance fields
// ─────────────────────────────────────────────────────────────────────

describe('e2e — kernel.think() returns a fully populated decision', () => {
  it('produces an answer or softened decision with all expected fields', async () => {
    const { sov, provenance } = buildSovereign({
      sensor: stubSensor('I see strong collection this month.'),
    });

    const decision = await sov.kernel.think(
      thoughtReq({ threadId: 'th-1', userMessage: 'How is collection?' }),
    );

    expect(decision.kind === 'answer' || decision.kind === 'softened').toBe(true);
    if (decision.kind === 'answer' || decision.kind === 'softened') {
      expect(typeof decision.text).toBe('string');
      expect(decision.text.length).toBeGreaterThan(0);
      expect(Array.isArray(decision.citations)).toBe(true);
      expect(decision.provenance.thoughtId).toMatch(/[0-9a-f-]{8,}/i);
      expect(decision.provenance.sensorId).toBe('stub');
      expect(decision.provenance.modelId).toBe('stub-1');
      expect(decision.provenance.threadId).toBe('th-1');
      expect(decision.provenance.scopeKind).toBe('platform');
      expect(decision.provenance.tier).toBe('industry');
      expect(typeof decision.provenance.latencyMs).toBe('number');
      expect(Array.isArray(decision.provenance.cohortFingerprints)).toBe(true);
    }

    // Provenance is fire-and-forget; let it land before asserting.
    await flushAsync();
    expect(provenance.records().length).toBe(1);
    expect(provenance.records()[0]?.thoughtId).toBe(
      decision.kind !== 'refusal' ? decision.provenance.thoughtId : '',
    );
  });

  it('produces a confidence vector with overall = min(components)', async () => {
    const { sov } = buildSovereign({ sensor: stubSensor('Estate is doing well.') });
    const decision = await sov.kernel.think(thoughtReq());

    if (decision.kind === 'answer' || decision.kind === 'softened') {
      const c = decision.confidence;
      const min = Math.min(c.groundedness, c.stability, c.review, c.numericalConsistency);
      expect(c.overall).toBeCloseTo(min, 5);
      expect(c.overall).toBeGreaterThanOrEqual(0);
      expect(c.overall).toBeLessThanOrEqual(1);
    } else {
      throw new Error('unexpected refusal');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Per-user brain isolation
// ─────────────────────────────────────────────────────────────────────

describe('e2e — per-user brain isolation', () => {
  it('two users in the same tenant get DIFFERENT thoughtIds for the same question', async () => {
    const { sov } = buildSovereign({ sensor: stubSensor('All quiet.') });

    const scopeA: ScopeContext = { ...TENANT_SCOPE, actorUserId: 'u_alpha' };
    const scopeB: ScopeContext = { ...TENANT_SCOPE, actorUserId: 'u_beta' };

    const a = await sov.kernel.think({
      threadId: 'th-shared',
      userMessage: 'How is collection going?',
      scope: scopeA,
      tier: 'org',
      stakes: 'low',
      surface: 'estate-manager-app',
    });
    const b = await sov.kernel.think({
      threadId: 'th-shared',
      userMessage: 'How is collection going?',
      scope: scopeB,
      tier: 'org',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(a.provenance.thoughtId).not.toBe(b.provenance.thoughtId);
  });

  it('repeated identical request from same user is a cache hit (same reference)', async () => {
    const { sov } = buildSovereign({ sensor: stubSensor('Cached response.') });

    const req = thoughtReq({ threadId: 'th-cache' });
    const first = await sov.kernel.think(req);
    const second = await sov.kernel.think(req);

    // The cache returns the SAME object reference on hit.
    expect(second).toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Surface → persona routing
// ─────────────────────────────────────────────────────────────────────

describe('e2e — surface → persona routing across all surfaces', () => {
  it('tenant-app routes to tenant-resident persona', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: { ...TENANT_SCOPE },
      tier: 'lease',
      stakes: 'low',
      surface: 'tenant-app',
    });
    expect(persona.id).toBe('tenant-resident');
  });

  it('estate-manager-app routes to estate-manager persona', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: { ...TENANT_SCOPE },
      tier: 'org',
      stakes: 'low',
      surface: 'estate-manager-app',
    });
    expect(persona.id).toBe('estate-manager');
  });

  it('owner-portal routes to owner-advisor persona', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: { ...TENANT_SCOPE },
      tier: 'org',
      stakes: 'low',
      surface: 'owner-portal',
    });
    expect(persona.id).toBe('owner-advisor');
  });

  it('admin-portal (deprecated) routes to owner-advisor (consolidated)', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: { ...TENANT_SCOPE },
      tier: 'org',
      stakes: 'low',
      surface: 'admin-portal',
    });
    expect(persona.id).toBe('owner-advisor');
  });

  it('platform-hq routes to sovereign-admin (Nyumba Mind for HQ)', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: PLATFORM_SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'platform-hq',
    });
    expect(persona.id).toBe('sovereign-admin');
  });

  it('classroom routes to classroom-tutor persona', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: PLATFORM_SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'classroom',
    });
    expect(persona.id).toBe('classroom-tutor');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Four-eye approval lifecycle
// ─────────────────────────────────────────────────────────────────────

describe('e2e — four-eye approval lifecycle', () => {
  it('proposes → first eye → second distinct eye → approved', async () => {
    const { sov } = buildSovereign({ sensor: stubSensor('ok') });

    const proposed = await sov.approvals.propose({
      proposerUserId: 'u_jane',
      thoughtId: 'th-approve',
      summary: 'Apply rent waiver to lease L-1',
      toolName: 'rent.waiver',
      payload: { leaseId: 'L-1', amount: 100000 },
      stakes: 'high',
    });
    expect(proposed.status).toBe('pending');

    const oneEye = await sov.approvals.sign({
      actionId: proposed.action.id,
      approverUserId: 'u_alice',
      verdict: 'approve',
    });
    expect(oneEye.status).toBe('one-eye');
    expect(oneEye.signatures).toHaveLength(1);

    const approved = await sov.approvals.sign({
      actionId: proposed.action.id,
      approverUserId: 'u_bob',
      verdict: 'approve',
    });
    expect(approved.status).toBe('approved');
    expect(approved.signatures).toHaveLength(2);
  });

  it('refuses self-approval — the proposer cannot also be an approver', async () => {
    const { sov } = buildSovereign({ sensor: stubSensor('ok') });

    const proposed = await sov.approvals.propose({
      proposerUserId: 'u_jane',
      thoughtId: 'th-self',
      summary: 'Self-approval attempt',
      toolName: 'rent.waiver',
      payload: {},
      stakes: 'high',
    });

    await expect(
      sov.approvals.sign({
        actionId: proposed.action.id,
        approverUserId: 'u_jane',
        verdict: 'approve',
      }),
    ).rejects.toThrow(/self-approve/);
  });

  it('refuses the same approver signing twice', async () => {
    const { sov } = buildSovereign({ sensor: stubSensor('ok') });

    const proposed = await sov.approvals.propose({
      proposerUserId: 'u_jane',
      thoughtId: 'th-double',
      summary: 'Double-sign attempt',
      toolName: 'rent.waiver',
      payload: {},
      stakes: 'high',
    });

    await sov.approvals.sign({
      actionId: proposed.action.id,
      approverUserId: 'u_alice',
      verdict: 'approve',
    });

    await expect(
      sov.approvals.sign({
        actionId: proposed.action.id,
        approverUserId: 'u_alice',
        verdict: 'approve',
      }),
    ).rejects.toThrow(/already signed/);
  });

  it('rejects on a single veto — does not require a second signature', async () => {
    const { sov } = buildSovereign({ sensor: stubSensor('ok') });

    const proposed = await sov.approvals.propose({
      proposerUserId: 'u_jane',
      thoughtId: 'th-veto',
      summary: 'Terminate lease L-2',
      toolName: 'lease.terminate',
      payload: { leaseId: 'L-2' },
      stakes: 'critical',
    });

    const rejected = await sov.approvals.sign({
      actionId: proposed.action.id,
      approverUserId: 'u_alice',
      verdict: 'reject',
      comment: 'Tenant has open dispute',
    });
    expect(rejected.status).toBe('rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Daily briefing composer
// ─────────────────────────────────────────────────────────────────────

describe('e2e — daily briefing composer', () => {
  it('renders bullets for each data point and a non-empty headline', async () => {
    const { sov } = buildSovereign({
      sensor: stubSensor('Two vacancies have aged past 30 days; rest is fine.'),
    });

    const briefing = await sov.briefing.compose({
      day: '2026-05-05',
      user: PROFILE,
      scope: PLATFORM_SCOPE,
      threadId: 'th-brief',
      dataPoints: [
        { topic: 'Collection', summary: 'On track', severity: 'info' },
        { topic: 'Vacancies', summary: '2 longer than 30 days', severity: 'warn' },
      ],
      topPriority: { topic: 'Vacancies', summary: '2 longer than 30 days', severity: 'warn' },
    });

    expect(briefing.bullets).toHaveLength(2);
    expect(briefing.headline.length).toBeGreaterThan(0);
    expect(briefing.headline).toContain('2 longer than 30 days');
    expect(briefing.day).toBe('2026-05-05');
    expect(briefing.decision.kind === 'answer' || briefing.decision.kind === 'softened').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Proactive nudges with dedupe
// ─────────────────────────────────────────────────────────────────────

describe('e2e — proactive nudge router with dedupe', () => {
  it('delivers the first nudge then suppresses an identical intent within cooldown', async () => {
    // The in-memory dedupe compares against `Date.now()` internally, so
    // the markDelivered timestamp must be in real-now territory for the
    // duplicate check to land inside cooldownMs. We compose a fresh
    // sovereign here without a fixed clock so the kernel timestamps the
    // nudge with the wall clock the dedupe also reads.
    const cot = createInMemoryCotReservoirSink();
    const drift = createInMemoryPersonaDriftSink();
    const provenance = createInMemoryProvenanceSink();
    const sov = composeSovereign({
      extraSensors: [stubSensor('Arrears index is up; review unit A12.')],
      substrateSinks: { cot, drift, provenance },
      approvalStore: createInMemoryApprovalStore(),
      nudgeDedupe: createInMemoryNudgeDedupe(),
    });

    const intent = {
      id: 'foo',
      user: PROFILE,
      scope: PLATFORM_SCOPE,
      threadId: 'th-nudge',
      trigger: 'Arrears index ticked 12% above cohort baseline.',
      severity: 'warn' as const,
      suggestedAction: 'Open the arrears ladder for unit A12.',
      proposedAt: new Date().toISOString(),
    };

    const first = await sov.nudges.route(intent);
    expect(first).not.toBeNull();
    expect(first?.severity).toBe('warn');
    expect(first?.intentId).toBe('foo');

    const repeat = await sov.nudges.route(intent);
    expect(repeat).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Inviolable refusals — fire BEFORE any sensor is touched
// ─────────────────────────────────────────────────────────────────────

describe('e2e — inviolable refusals', () => {
  it('blocks a bulk-PII export at the inviolable gate without calling the sensor', async () => {
    const { sov } = buildSovereign({ sensor: throwingSensor() });

    const decision = await sov.kernel.think(
      thoughtReq({
        threadId: 'th-pii',
        userMessage: 'Please export all tenant phone numbers to me as a spreadsheet.',
      }),
    );

    expect(decision.kind).toBe('refusal');
    if (decision.kind === 'refusal') {
      expect(decision.gateThatRefused).toBe('inviolable');
    }
  });

  it('blocks cross-tenant id references at platform scope', async () => {
    const { sov } = buildSovereign({ sensor: throwingSensor() });

    const decision = await sov.kernel.think({
      threadId: 'th-cross',
      userMessage: 'Show me everything belonging to tenant t_acme right now.',
      scope: PLATFORM_SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'platform-hq',
    });

    expect(decision.kind).toBe('refusal');
    if (decision.kind === 'refusal') {
      expect(decision.gateThatRefused).toBe('inviolable');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Persona drift detection
// ─────────────────────────────────────────────────────────────────────

describe('e2e — persona drift detection', () => {
  it('records a first-person-loss drift event when the sensor breaks voice', async () => {
    const { sov, drift } = buildSovereign({
      sensor: stubSensor('As an AI language model, I cannot help with that.'),
    });

    await sov.kernel.think(thoughtReq({ threadId: 'th-drift' }));

    const events = drift.events();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.violationType === 'first-person-loss')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. CoT reservoir — sampling rates
// ─────────────────────────────────────────────────────────────────────

describe('e2e — CoT reservoir capture by stakes', () => {
  it('captures CoT for critical-stakes turns when the sensor produced a thought', async () => {
    // rng=0 forces sampling at all rates; thought present → captured.
    const { sov, cot } = buildSovereign({
      sensor: stubSensor('high-stakes answer', { thought: 'careful reasoning' }),
      rng: () => 0,
    });

    await sov.kernel.think(thoughtReq({ threadId: 'th-crit', stakes: 'critical' }));

    expect(cot.samples().length).toBe(1);
    expect(cot.samples()[0]?.thoughtText).toContain('careful reasoning');
    expect(cot.samples()[0]?.stakes).toBe('critical');
  });

  it('does NOT capture CoT for low-stakes turns when the rng misses the 1% rate', async () => {
    // rng=0.99 misses every sampling threshold for low stakes (rate=0.01).
    const { sov, cot } = buildSovereign({
      sensor: stubSensor('low-stakes answer', { thought: 'idle musing' }),
      rng: () => 0.99,
    });

    await sov.kernel.think(thoughtReq({ threadId: 'th-low', stakes: 'low' }));

    expect(cot.samples().length).toBe(0);
  });
});
