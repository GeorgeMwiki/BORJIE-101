/**
 * Tier-2 Capability-Composition Engine — focused suite.
 *
 * Proves the five contract guarantees:
 *  (1) CI-INERTNESS — with NO engine set, the unknown-verb path returns the
 *      UNCHANGED deferToBrain shape (regression lock).
 *  (2) COMPOSED FULFILLMENT — with a MOCKED engine returning a composed
 *      result, the unknown-verb path returns `{ composed:true }`.
 *  (3) HAPPY-PATH — a mocked LATS yielding a winning composition whose every
 *      step authorizes executes via a mocked `registry.invoke('compose')` and
 *      returns the result.
 *  (4) GOVERNANCE — a winning composition containing a step the gate denies is
 *      NOT executed → `attempt` returns null (the inhibition membrane).
 *  (5) FAIL-SAFE — a mocked `registry.invoke` that throws → `attempt` returns
 *      null (no throw).
 *
 * The engine is constructor-injected with a fake model port + a fake registry,
 * so the suite needs NO real model and NO Postgres.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

import { createCapabilityCompositionEngine } from '../capability-composition-engine.js';
import type {
  CompositionModelPort,
  StepGovernanceGate,
} from '../capability-composition-types.js';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// ─────────────────────────────────────────────────────────────────────
// Route-level harness (cases 1 + 2) — mock middleware + gate so control
// reaches the generative deferToBrain branch deterministically.
// ─────────────────────────────────────────────────────────────────────

vi.mock('../../middleware/hono-auth', () => ({
  authMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('auth', { tenantId: 'tenant-cc-1', userId: 'owner-cc-1' });
    await next();
  },
}));

vi.mock('../../middleware/database', () => ({
  databaseMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', { __fake: true });
    await next();
  },
}));

// The verb is UNKNOWN (isKnownVerb=false) and clears the hard rails
// (screenGenerativeVerb.allowed=true) so control reaches the deferToBrain
// branch where the composition engine attempt lives.
vi.mock('../../services/auto-authorize-gate/index.js', () => ({
  decideAutoAuthorization: () => ({ authorized: true, reason: 'authorized', autonomyDecision: 'auto' }),
  screenGenerativeVerb: () => ({ allowed: true, reason: 'authorized' }),
}));
vi.mock('../../services/auto-authorize-gate/audit.js', () => ({
  appendAutoAuthorizedAudit: vi.fn(async () => undefined),
}));
vi.mock('../../services/action-executor/index.js', () => ({
  dispatchAction: vi.fn(async () => ({ executed: false, reason: 'noop' })),
  requiresConfirmation: () => false,
  isKnownVerb: () => false,
}));
vi.mock('../../routes/owner/four-eye-approvals.hono.js', () => ({
  enqueueFourEyeRequest: vi.fn(async () => null),
}));

async function mountRoute(): Promise<{
  app: Hono;
  setCompositionEngine: (e: unknown) => void;
}> {
  const mod = await import('../../routes/owner/chat-actions.hono.js');
  const app = new Hono();
  app.route('/owner/chat', mod.ownerChatActionsRouter);
  return {
    app,
    setCompositionEngine: mod.setCompositionEngine as (e: unknown) => void,
  };
}

function postUnknownVerb(app: Hono) {
  return app.request('/owner/chat/micro-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ verb: 'synthesize_quarterly_briefing', params: { q: 2 } }),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Engine-level fakes (cases 3-5).
// ─────────────────────────────────────────────────────────────────────

const scope = {
  kind: 'tenant' as const,
  tenantId: 'tenant-cc-1',
  actorUserId: 'owner-cc-1',
  roles: [] as string[],
  personaId: 'mr-mwikila-head',
};

const ctx = {
  callerId: 'owner-cc-1',
  tier: 'estate-manager' as const,
  tenantId: 'tenant-cc-1',
  threadId: 'thr-1',
  approvalRecordId: null,
  auditSink: null,
  clock: () => new Date('2026-06-10T00:00:00.000Z'),
};

/**
 * A model port that drives the LATS search to a winning, parseable
 * composition: the expander always proposes ONE valid `schedule` tool-call;
 * the evaluator always scores 1 (above the winning threshold).
 */
function winningModel(): CompositionModelPort {
  return {
    async complete(args): Promise<string> {
      // The evaluator system asks for a 0..1 number.
      if (args.system.includes('evaluator')) return '1';
      // The expander system asks for tool-call lines.
      return JSON.stringify({ toolId: 'schedule', args: { callIn: '1h' } });
    },
  };
}

/** A model port whose expander proposes a HIGH-consequence tool. */
function dangerousModel(): CompositionModelPort {
  return {
    async complete(args): Promise<string> {
      if (args.system.includes('evaluator')) return '1';
      return JSON.stringify({ toolId: 'cross_tenant', args: {} });
    },
  };
}

/** A fake registry exposing only what the engine touches. */
function fakeRegistry(opts: {
  readonly toolIds: ReadonlyArray<string>;
  readonly invoke: (id: string, args?: unknown) => Promise<unknown>;
}) {
  const tools = opts.toolIds.map((id) => ({
    id,
    name: id,
    description: `fake ${id}`,
    requiredTier: 'estate-manager' as const,
    requiresApproval: false,
    auditDestination: 'audit-events' as const,
    // schema/execute are never read by the engine (it only lists + invokes).
    schema: { safeParse: () => ({ success: true, data: {} }) } as never,
    execute: (async () => ({ kind: 'ok', output: {} })) as never,
  }));
  return {
    register: () => undefined,
    get: (id: string) => tools.find((t) => t.id === id) ?? null,
    list: () => tools,
    listForTier: () => tools,
    invoke: ((id: string, args?: unknown) => opts.invoke(id, args)) as never,
    clear: () => undefined,
  } as never;
}

/** A gate that authorizes every benign step (autonomyDecision='auto'). */
const allowAllGate: StepGovernanceGate = () => ({
  authorized: true,
  reason: 'authorized',
  autonomyDecision: 'auto',
});

/** A gate that denies any `sovereign:`-prefixed step (four_eyes). */
const denyDangerousGate: StepGovernanceGate = (a) =>
  a.verb.startsWith('sovereign:')
    ? { authorized: false, reason: 'four_eyes', autonomyDecision: 'four_eyes' }
    : { authorized: true, reason: 'authorized', autonomyDecision: 'auto' };

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('Capability-Composition Engine — route integration', () => {
  beforeEach(async () => {
    // Always start each route case with the engine UNSET.
    const mod = await import('../../routes/owner/chat-actions.hono.js');
    (mod.setCompositionEngine as (e: unknown) => void)(null);
  });

  afterEach(async () => {
    // Test isolation: the route holds a module-global compositionEngine. Clear
    // it after every case so a leaked engine cannot bleed into another suite.
    const mod = await import('../../routes/owner/chat-actions.hono.js');
    (mod.setCompositionEngine as (e: unknown) => void)(null);
  });

  it('(1) CI-INERTNESS: no engine → unknown-verb path returns the UNCHANGED deferToBrain shape', async () => {
    const { app } = await mountRoute();
    const res = await postUnknownVerb(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      executed: false,
      authorized: true,
      reason: 'defer_to_brain',
      deferToBrain: true,
      verb: 'synthesize_quarterly_briefing',
      params: { q: 2 },
    });
  });

  it('(2) COMPOSED: a mocked engine returning a composed result → { composed:true }', async () => {
    const { app, setCompositionEngine } = await mountRoute();
    const composed = {
      kind: 'composed' as const,
      goal: 'g',
      score: 0.9,
      stepCount: 1,
      steps: [{ toolId: 'schedule' }],
      compose: {
        action: 'compose' as const,
        committed: true,
        stepCount: 1,
        stepResults: [],
        rollbackReason: null,
      },
    };
    setCompositionEngine({ attempt: async () => composed });

    const res = await postUnknownVerb(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.executed).toBe(true);
    expect(body.data.composed).toBe(true);
    expect(body.data.reason).toBe('composed');
    expect((body.data.result as { score: number }).score).toBe(0.9);
  });

  it('a throwing engine falls through to the UNCHANGED deferToBrain shape (defence in depth)', async () => {
    const { app, setCompositionEngine } = await mountRoute();
    setCompositionEngine({
      attempt: async () => {
        throw new Error('boom');
      },
    });
    const res = await postUnknownVerb(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.deferToBrain).toBe(true);
    expect(body.data.reason).toBe('defer_to_brain');
  });
});

describe('Capability-Composition Engine — attempt() unit', () => {
  const input = {
    verb: 'synthesize_quarterly_briefing',
    params: { q: 2 },
    rationale: 'owner asked for a quarterly briefing',
    scope,
    ctx,
  };

  it('(3) HAPPY-PATH: a winning, fully-authorized SINGLE-step composition executes via registry.invoke(compose)', async () => {
    let executedSteps = -1;
    const invokeSpy = vi.fn(async (id: string, args: unknown) => {
      expect(id).toBe('compose');
      // Capture the cap: even though the model would happily keep proposing
      // `schedule` calls, the depth-bounded search + single-step cap mean the
      // engine only ever executes ONE step.
      executedSteps = (args as { steps: ReadonlyArray<unknown> }).steps.length;
      return {
        kind: 'ok',
        output: {
          action: 'compose',
          committed: true,
          stepCount: 1,
          stepResults: [{ id: 'step_1', toolId: 'schedule', status: 'ok' }],
          rollbackReason: null,
        },
      };
    });
    const engine = createCapabilityCompositionEngine({
      model: winningModel(),
      registry: fakeRegistry({ toolIds: ['schedule', 'compose'], invoke: invokeSpy }),
      governanceGate: allowAllGate,
      logger: silentLogger,
    });

    const result = await engine.attempt(input);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('composed');
    expect(result?.compose.committed).toBe(true);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    // SINGLE-STEP CAP: the executable chain is exactly one atomically-safe step.
    expect(executedSteps).toBe(1);
    expect(result?.steps.length).toBe(1);
  });

  it('EARLY-OUT: when the gate denies ALL tools, attempt returns null WITHOUT calling the model', async () => {
    const completeSpy = vi.fn(async () => '1');
    const model: CompositionModelPort = { complete: completeSpy };
    const invokeSpy = vi.fn(async () => ({ kind: 'ok', output: {} }));
    // A gate that denies EVERYTHING — no tool is auto-clearable.
    const denyAllGate: StepGovernanceGate = () => ({
      authorized: false,
      reason: 'gate',
      autonomyDecision: 'gate',
    });
    const engine = createCapabilityCompositionEngine({
      model,
      registry: fakeRegistry({ toolIds: ['schedule', 'compose'], invoke: invokeSpy }),
      governanceGate: denyAllGate,
      logger: silentLogger,
    });

    const result = await engine.attempt(input);
    expect(result).toBeNull();
    // The cheap, LLM-free pre-flight short-circuited BEFORE any search ran.
    expect(completeSpy).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('(4) GOVERNANCE: a winning composition with a gate-denied step is NOT executed → null', async () => {
    const invokeSpy = vi.fn(async () => ({ kind: 'ok', output: {} }));
    const engine = createCapabilityCompositionEngine({
      model: dangerousModel(),
      registry: fakeRegistry({
        toolIds: ['cross_tenant', 'compose'],
        invoke: invokeSpy,
      }),
      governanceGate: denyDangerousGate,
      logger: silentLogger,
    });

    const result = await engine.attempt(input);
    expect(result).toBeNull();
    // The inhibition membrane refused BEFORE any execution.
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('(5) FAIL-SAFE: registry.invoke that throws → attempt returns null (no throw)', async () => {
    const engine = createCapabilityCompositionEngine({
      model: winningModel(),
      registry: fakeRegistry({
        toolIds: ['schedule', 'compose'],
        invoke: async () => {
          throw new Error('compose blew up');
        },
      }),
      governanceGate: allowAllGate,
      logger: silentLogger,
    });

    const result = await engine.attempt(input);
    expect(result).toBeNull();
  });

  it('returns null when the registry has no tools (nothing to compose)', async () => {
    const engine = createCapabilityCompositionEngine({
      model: winningModel(),
      registry: fakeRegistry({ toolIds: ['compose'], invoke: async () => ({ kind: 'ok', output: {} }) }),
      governanceGate: allowAllGate,
      logger: silentLogger,
    });
    const result = await engine.attempt(input);
    expect(result).toBeNull();
  });
});
