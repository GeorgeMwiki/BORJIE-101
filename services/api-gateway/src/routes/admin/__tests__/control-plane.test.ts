/**
 * Control Plane route — contract tests.
 *
 * The Borjie-internal control plane over the brain exposes four admin knobs:
 *   - POWERS         GET/PUT power flags (global + per-tenant)
 *   - LLM ROUTING    GET/PUT core + ordered fallbacks + ensemble + perUseCase
 *   - MODEL CATALOG  GET catalog with cost/capability/latency
 *   - AI-SUGGEST     POST recommender (suggest-only, HITL)
 *
 * This suite validates, with a stubbed auth + db + services harness:
 *   - PUT mutations drive the REAL platform services + emit a SOC2 security
 *     event AND record an undo_journal audit row
 *   - bad input is rejected (400)
 *   - a power-flag write that targets a sovereign / kill-switch rail is
 *     refused (403) — the routing config never changes WHETHER a sovereign
 *     action runs
 *   - LLM-routing drops locked / sovereign use-cases from perUseCase
 *   - ensemble config is surfaced cost-aware (N x cost)
 *   - ai-suggest returns ranked suggestions and NEVER writes config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// Pin env BEFORE any router import so config loaders succeed.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-control-plane-32-chars-longer';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ||
  'test-supabase-control-plane-32-chars-longer';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'anon-key-aaaaaaaaaaaaaaaaaaaaaaaa';

import {
  setSecurityEventSink,
  resetSecurityEventSink,
  type SecurityEvent,
} from '@borjie/observability';
// Pre-warm the heavy @borjie/database barrel during module-init so the in-body
// dynamic import does not trip the test timeout on a cold vitest worker.
import '@borjie/database';

// ─── Mock the middlewares (pass-through; harness pins auth + db + services) ──
vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

type Row = Record<string, unknown>;

interface DbState {
  insertRows: Row[];
  insertCalls: number;
}

function makeDbStub(state: DbState) {
  return {
    insert(_t: unknown) {
      return {
        values(input: Record<string, unknown>) {
          return {
            async returning() {
              state.insertCalls += 1;
              const row = { ...input, id: `j_${state.insertCalls}` };
              state.insertRows.push(row);
              return [row];
            },
          };
        },
      };
    },
  };
}

interface AuthShape {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
}

interface ServiceSpies {
  ffRead: ReturnType<typeof vi.fn>;
  setFlag: ReturnType<typeof vi.fn>;
  routingRead: ReturnType<typeof vi.fn>;
  setRouting: ReturnType<typeof vi.fn>;
}

function makeServices(opts?: { setFlagThrows?: boolean }): {
  services: Record<string, unknown>;
  spies: ServiceSpies;
} {
  const ffRead = vi.fn(async (flag: string) => ({
    flagName: flag,
    globalValue: null,
    tenantOverrides: [],
  }));
  const setFlag = vi.fn(async () => {
    if (opts?.setFlagThrows) throw new Error('feature-flag backend down');
    return { flagName: 'x', scope: 'global', previousValue: null, value: true, updatedAt: new Date().toISOString() };
  });
  const routingRead = vi.fn(async (scope: string) => ({
    scope,
    config: null,
    lastSetAt: null,
  }));
  const setRouting = vi.fn(async (args: { scope: string; config: unknown }) => ({
    scope: args.scope,
    previousConfig: null,
    config: args.config,
    updatedAt: new Date().toISOString(),
  }));
  const spies: ServiceSpies = { ffRead, setFlag, routingRead, setRouting };
  const services = {
    platformFeatureFlags: { read: ffRead, setFlag },
    platformLlmRoutingConfig: { read: routingRead, setRouting },
  };
  return { services, spies };
}

async function buildApp(
  state: DbState,
  auth: AuthShape,
  services: Record<string, unknown>,
) {
  const { adminControlPlaneRouter } = await import('../control-plane.hono');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as unknown as never, auth as unknown as never);
    c.set('db' as unknown as never, makeDbStub(state) as unknown as never);
    c.set('services' as unknown as never, services as unknown as never);
    await next();
  });
  app.route('/admin/control-plane', adminControlPlaneRouter);
  return app;
}

function freshState(): DbState {
  return { insertRows: [], insertCalls: 0 };
}

const ADMIN: AuthShape = {
  tenantId: 'admin_tn',
  userId: 'admin_a',
  role: 'SUPER_ADMIN',
};

let events: SecurityEvent[] = [];
beforeEach(() => {
  events = [];
  setSecurityEventSink((e) => {
    events.push(e);
  });
});
afterEach(() => {
  resetSecurityEventSink();
});

// ─── POWERS ──────────────────────────────────────────────────────────────────

describe('PUT /powers — set a power flag', () => {
  it('drives the feature-flag service, emits a security event + audit row', async () => {
    const { services, spies } = makeServices();
    const state = freshState();
    const app = await buildApp(state, ADMIN, services);
    const res = await app.request('/admin/control-plane/powers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flag: 'junior_agent_autonomy',
        enabled: true,
        scope: 'global',
        reason: 'enable-full-powers-default-on',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { journalId: string | null } };
    expect(body.success).toBe(true);
    // Real backend was driven.
    expect(spies.setFlag).toHaveBeenCalledTimes(1);
    expect(spies.setFlag.mock.calls[0]?.[0]).toMatchObject({
      flagName: 'junior_agent_autonomy',
      value: true,
      scope: 'global',
    });
    // Mutation was audited (undo_journal row) + SOC2 event.
    expect(state.insertRows[0]?.provenance).toMatchObject({ status: 'applied' });
    const evt = events.find((e) => e.action === 'platform.control_plane.set_power_flag');
    expect(evt).toBeDefined();
    expect(evt?.severity).toBe('critical');
  });

  it('sets a per-tenant power-flag override', async () => {
    const { services, spies } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/powers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flag: 'predictions_append_mode',
        enabled: false,
        scope: 'tenant:tn_42',
        reason: 'tenant-specific-override-window',
      }),
    });
    expect(res.status).toBe(200);
    expect(spies.setFlag.mock.calls[0]?.[0]).toMatchObject({
      flagName: 'predictions_append_mode',
      scope: 'tenant:tn_42',
    });
  });

  it('REJECTS a sovereign / kill-switch flag with 403', async () => {
    const { services, spies } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/powers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flag: 'killswitch_account_deletion',
        enabled: false,
        scope: 'global',
        reason: 'must-not-be-flippable-from-control-plane',
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SOVEREIGN_FLAG_FORBIDDEN');
    // The sovereign rail was never touched.
    expect(spies.setFlag).not.toHaveBeenCalled();
  });

  it('rejects an invalid flag name (400)', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/powers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flag: 'Not Snake Case',
        enabled: true,
        scope: 'global',
        reason: 'should-be-rejected',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a too-short reason (400)', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/powers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flag: 'junior_agent_autonomy',
        enabled: true,
        scope: 'global',
        reason: 'oops',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('surfaces a backend write failure as 500 (never swallowed)', async () => {
    const { services } = makeServices({ setFlagThrows: true });
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/powers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flag: 'junior_agent_autonomy',
        enabled: true,
        scope: 'global',
        reason: 'backend-will-throw-here',
      }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('POWER_FLAG_WRITE_FAILED');
  });
});

describe('GET /powers — read', () => {
  it('returns global + tenant overrides + sovereign marker', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request(
      '/admin/control-plane/powers?flags=junior_agent_autonomy,killswitch_refund',
      { method: 'GET' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { powers: Array<{ flag: string; sovereign: boolean }> };
    };
    const sovereign = body.data.powers.find((p) => p.flag === 'killswitch_refund');
    expect(sovereign?.sovereign).toBe(true);
  });
});

// ─── LLM ROUTING ─────────────────────────────────────────────────────────────

describe('PUT /llm-routing — set routing config', () => {
  it('persists core + fallbacks + ensemble, audits, and surfaces ensemble cost', async () => {
    const { services, spies } = makeServices();
    const state = freshState();
    const app = await buildApp(state, ADMIN, services);
    const res = await app.request('/admin/control-plane/llm-routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        reason: 'set-core-opus-with-sonnet-fallback',
        coreModel: 'claude-opus-4-8',
        orderedFallbacks: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
        ensemble: {
          enabled: true,
          members: ['claude-opus-4-8', 'gpt-5'],
          combineStrategy: 'judge-synthesis',
          judgeModel: 'claude-opus-4-8',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { ensembleCost?: { costMultiplier: number; memberCount: number } };
    };
    expect(body.success).toBe(true);
    expect(spies.setRouting).toHaveBeenCalledTimes(1);
    expect(spies.setRouting.mock.calls[0]?.[0]).toMatchObject({ scope: 'global' });
    // Cost-aware: ensemble surfaces the N x cost multiplier.
    expect(body.data.ensembleCost?.memberCount).toBe(2);
    expect(body.data.ensembleCost?.costMultiplier).toBe(2);
    // Audited.
    expect(state.insertRows[0]?.actionKind).toBe('control_plane_set_llm_routing');
    const evt = events.find((e) => e.action === 'platform.control_plane.set_llm_routing');
    expect(evt?.severity).toBe('critical');
  });

  it('DROPS locked / sovereign use-cases from perUseCase', async () => {
    const { services, spies } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/llm-routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        reason: 'attempt-to-route-locked-usecase',
        coreModel: 'claude-sonnet-4-6',
        perUseCase: {
          casual_chat: 'claude-haiku-4-5',
          legal_review: 'claude-haiku-4-5', // LOCKED — must be dropped
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { droppedLockedUseCases?: string[]; config: { perUseCase?: Record<string, string> } };
    };
    expect(body.data.droppedLockedUseCases).toContain('legal_review');
    // The persisted config must NOT contain the locked use-case.
    const persisted = spies.setRouting.mock.calls[0]?.[0] as {
      config: { perUseCase?: Record<string, string> };
    };
    expect(persisted.config.perUseCase).not.toHaveProperty('legal_review');
    expect(persisted.config.perUseCase).toHaveProperty('casual_chat');
  });

  it('rejects a routing config with no coreModel (400)', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/llm-routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        reason: 'missing-core-model-here',
        orderedFallbacks: ['claude-haiku-4-5'],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an ensemble with empty members (400)', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/llm-routing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'global',
        reason: 'empty-ensemble-members-here',
        coreModel: 'claude-opus-4-8',
        ensemble: { enabled: true, members: [], combineStrategy: 'first-wins' },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /llm-routing — read', () => {
  it('reads the config for the requested scope', async () => {
    const { services, spies } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request(
      '/admin/control-plane/llm-routing?scope=tenant:tn_9',
      { method: 'GET' },
    );
    expect(res.status).toBe(200);
    expect(spies.routingRead).toHaveBeenCalledWith('tenant:tn_9');
  });
});

// ─── MODEL CATALOG ───────────────────────────────────────────────────────────

describe('GET /model-catalog', () => {
  it('returns models with cost/capability/latency + locked use-cases', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/model-catalog', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        models: Array<{ model: string; costPerMillionUsd: number; capabilityRank: number; p50LatencyMs: number }>;
        lockedUseCases: string[];
        combineStrategies: string[];
      };
    };
    expect(body.data.models.length).toBeGreaterThan(0);
    const opus = body.data.models.find((m) => m.model === 'claude-opus-4-8');
    expect(opus?.costPerMillionUsd).toBeGreaterThan(0);
    expect(opus?.capabilityRank).toBeGreaterThan(0);
    expect(body.data.lockedUseCases).toContain('legal_review');
    expect(body.data.combineStrategies).toContain('judge-synthesis');
  });
});

// ─── AI-SUGGEST ──────────────────────────────────────────────────────────────

describe('POST /ai-suggest — recommender (suggest-only, HITL)', () => {
  it('returns ranked per-use-case suggestions and NEVER writes config', async () => {
    const { services, spies } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/ai-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        useCases: ['casual_chat', 'royalty_calculation'],
        weights: { cost: 0.5, capability: 0.3, latency: 0.2 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        applied: boolean;
        perUseCase: Array<{ useCase: string; top: { model: string } | null }>;
      };
    };
    expect(body.success).toBe(true);
    // HITL: suggest-only.
    expect(body.data.applied).toBe(false);
    expect(body.data.perUseCase.length).toBe(2);
    const chat = body.data.perUseCase.find((u) => u.useCase === 'casual_chat');
    expect(chat?.top?.model).toBeTruthy();
    // No write path touched.
    expect(spies.setRouting).not.toHaveBeenCalled();
    expect(spies.setFlag).not.toHaveBeenCalled();
  });

  it('defaults to the assignable use-case set when none provided', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/ai-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { perUseCase: unknown[] } };
    expect(body.data.perUseCase.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range weight (400)', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-plane/ai-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weights: { cost: 5 } }),
    });
    expect(res.status).toBe(400);
  });
});
