/**
 * Control Tower route — contract tests.
 *
 * The Control Tower toggles drive REAL platform state:
 *   - global-kill        -> platform killswitch-write service (scope=platform)
 *   - jr-autonomy        -> feature flag junior_agent_autonomy (global)
 *   - predictions-mode   -> feature flag predictions_append_mode (global)
 *   - webhook-rate-cap   -> autonomy-settings webhook_rate_cap_per_min
 *   - embed-throttle     -> autonomy-settings embed_token_throttle_per_min
 *
 * This suite validates, with a stubbed auth + db + services harness:
 *   - GET /controls hydrates the real persisted state of each toggle
 *   - HIGH-impact toggles (kill / autonomy) land as pending_approval, do NOT
 *     mutate real state on the propose call, and emit a SOC2 security event
 *   - LOW-impact toggles (rate caps) apply immediately + drive the real service
 *   - the four-eye approval endpoint refuses the same-actor path, then on a
 *     distinct approver actually invokes the backing service (real mutation)
 *   - kill-switch is FAIL-CLOSED: when the killswitch write throws, the approve
 *     endpoint surfaces 500 (never a swallowed success)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// Pin env BEFORE any router import so config loaders succeed.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-control-tower-32-chars-longer';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ||
  'test-supabase-control-tower-32-chars-longer';
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
// `await import('../control-tower.hono')` does not trip the 10s test timeout on
// a cold vitest worker (a STATIC import is evaluated outside the per-test clock).
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
  selectRows: Row[];
  updateRows: Row[];
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
    select() {
      return {
        from(_t: unknown) {
          return {
            where(_w: unknown) {
              return {
                async limit(_n: number) {
                  return state.selectRows;
                },
              };
            },
          };
        },
      };
    },
    update(_t: unknown) {
      return {
        set(input: Record<string, unknown>) {
          return {
            where(_w: unknown) {
              return {
                async returning() {
                  if (state.selectRows.length === 0) return [];
                  const merged = { ...state.selectRows[0], ...input };
                  state.updateRows.push(merged);
                  return [merged];
                },
              };
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
  writeKillswitch: ReturnType<typeof vi.fn>;
  setFlag: ReturnType<typeof vi.fn>;
  setSetting: ReturnType<typeof vi.fn>;
}

function makeServices(opts?: { killswitchThrows?: boolean }): {
  services: Record<string, unknown>;
  spies: ServiceSpies;
} {
  const writeKillswitch = vi.fn(async () => {
    if (opts?.killswitchThrows) throw new Error('killswitch backend down');
    return { scope: 'platform', level: 'halt' };
  });
  const setFlag = vi.fn(async () => ({ flagName: 'x', value: true }));
  const setSetting = vi.fn(async () => ({
    settingKey: 'webhook_rate_cap_per_min',
    enabled: true,
    intValue: 300,
  }));
  const spies: ServiceSpies = { writeKillswitch, setFlag, setSetting };
  const services = {
    platformKillswitchWrite: { writeKillswitch, readCurrent: vi.fn(async () => null) },
    platformFeatureFlagsWrite: { setFlag, read: vi.fn(async () => ({ globalValue: null, tenantOverrides: [] })) },
    platformAutonomySettings: { setSetting, readSetting: vi.fn(async () => null) },
  };
  return { services, spies };
}

async function buildApp(
  state: DbState,
  auth: AuthShape,
  services: Record<string, unknown>,
) {
  const { adminControlTowerRouter } = await import('../control-tower.hono');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as unknown as never, auth as unknown as never);
    c.set('db' as unknown as never, makeDbStub(state) as unknown as never);
    c.set('services' as unknown as never, services as unknown as never);
    await next();
  });
  app.route('/admin/control-tower', adminControlTowerRouter);
  return app;
}

function freshState(seed?: Partial<DbState>): DbState {
  return {
    insertRows: [],
    selectRows: [],
    updateRows: [],
    insertCalls: 0,
    ...seed,
  };
}

const ADMIN: AuthShape = {
  tenantId: 'admin_tn',
  userId: 'admin_a',
  role: 'SUPER_ADMIN',
};

// Collect emitted SOC2 security events for assertions.
let events: SecurityEvent[] = [];
beforeEach(() => {
  events = [];
  setSecurityEventSink((e) => {
    events.push(e);
  });
});

describe('GET /controls — hydrate real state', () => {
  it('returns the five controls with persisted state', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-tower/controls', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { controls: Array<{ id: string; state: string }> };
    };
    expect(body.success).toBe(true);
    const ids = body.data.controls.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        'embed-throttle',
        'global-kill',
        'jr-autonomy',
        'predictions-mode',
        'webhook-rate-cap',
      ].sort(),
    );
  });
});

describe('POST /toggle — propose', () => {
  it('lands a HIGH-impact toggle (global-kill) as pending_approval WITHOUT mutating real state', async () => {
    const { services, spies } = makeServices();
    const state = freshState();
    const app = await buildApp(state, ADMIN, services);
    const res = await app.request('/admin/control-tower/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        controlId: 'global-kill',
        desiredState: 'on',
        reason: 'active-incident-response-2026',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { requiresFourEye: boolean; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.requiresFourEye).toBe(true);
    expect(body.data.status).toBe('pending_approval');
    // Real backend NOT touched on a four-eye propose.
    expect(spies.writeKillswitch).not.toHaveBeenCalled();
    // Journal row recorded the pending state + control mapping.
    expect(state.insertRows[0]?.provenance).toMatchObject({
      requires_four_eye: true,
      status: 'pending_approval',
      controlId: 'global-kill',
    });
    // SOC2 security event emitted for the propose.
    const evt = events.find((e) => e.action === 'platform.control_tower.toggle');
    expect(evt).toBeDefined();
    expect(evt?.severity).toBe('critical');
  });

  it('applies a LOW-impact toggle (webhook-rate-cap) immediately + drives the real autonomy-settings service', async () => {
    const { services, spies } = makeServices();
    const state = freshState();
    const app = await buildApp(state, ADMIN, services);
    const res = await app.request('/admin/control-tower/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        controlId: 'webhook-rate-cap',
        desiredState: 'off',
        reason: 'corpus-bootstrap-window-open',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { requiresFourEye: boolean; status: string };
    };
    expect(body.data.requiresFourEye).toBe(false);
    expect(body.data.status).toBe('applied');
    // Real backend WAS driven on a low-impact apply.
    expect(spies.setSetting).toHaveBeenCalledTimes(1);
    expect(spies.setSetting.mock.calls[0]?.[0]).toMatchObject({
      settingKey: 'webhook_rate_cap_per_min',
      enabled: false,
    });
  });

  it('rejects an unknown controlId with 400', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-tower/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        controlId: 'not-a-real-control',
        desiredState: 'on',
        reason: 'should not land at all',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a too-short reason with 400', async () => {
    const { services } = makeServices();
    const app = await buildApp(freshState(), ADMIN, services);
    const res = await app.request('/admin/control-tower/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        controlId: 'jr-autonomy',
        desiredState: 'off',
        reason: 'oops',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /toggle/:journalId/approve — second eye applies REAL state', () => {
  function pendingJournal(controlId: string): Row {
    return {
      id: 'j_test',
      tenantId: 'admin_tn',
      actorId: 'admin_a',
      entityType: 'platform_control',
      entityId: controlId,
      afterState: { controlId, desiredState: 'on' },
      provenance: {
        requires_four_eye: true,
        status: 'pending_approval',
        controlId,
        desiredState: 'on',
      },
    };
  }

  it('refuses approval by the SAME actor with 409', async () => {
    const { services } = makeServices();
    const state = freshState({ selectRows: [pendingJournal('global-kill')] });
    const app = await buildApp(state, ADMIN, services);
    const res = await app.request(
      '/admin/control-tower/toggle/j_test/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FOUR_EYE_SAME_ACTOR');
  });

  it('on a distinct approver, invokes the real killswitch write (global-kill)', async () => {
    const { services, spies } = makeServices();
    const state = freshState({ selectRows: [pendingJournal('global-kill')] });
    const app = await buildApp(
      state,
      { tenantId: 'admin_tn', userId: 'admin_b', role: 'ADMIN' },
      services,
    );
    const res = await app.request(
      '/admin/control-tower/toggle/j_test/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionNote: 'verified incident' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { applied: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.applied).toBe(true);
    // REAL mutation happened on approval.
    expect(spies.writeKillswitch).toHaveBeenCalledTimes(1);
    expect(spies.writeKillswitch.mock.calls[0]?.[0]).toMatchObject({
      scope: 'platform',
      level: 'halt',
    });
  });

  it('on a distinct approver, invokes the real feature-flag write (jr-autonomy)', async () => {
    const { services, spies } = makeServices();
    const state = freshState({ selectRows: [pendingJournal('jr-autonomy')] });
    const app = await buildApp(
      state,
      { tenantId: 'admin_tn', userId: 'admin_b', role: 'ADMIN' },
      services,
    );
    const res = await app.request(
      '/admin/control-tower/toggle/j_test/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(200);
    expect(spies.setFlag).toHaveBeenCalledTimes(1);
    expect(spies.setFlag.mock.calls[0]?.[0]).toMatchObject({
      flagName: 'junior_agent_autonomy',
      scope: 'global',
    });
  });

  it('FAIL-CLOSED: a killswitch backend error surfaces 500 (never a swallowed success)', async () => {
    const { services } = makeServices({ killswitchThrows: true });
    const state = freshState({ selectRows: [pendingJournal('global-kill')] });
    const app = await buildApp(
      state,
      { tenantId: 'admin_tn', userId: 'admin_b', role: 'ADMIN' },
      services,
    );
    const res = await app.request(
      '/admin/control-tower/toggle/j_test/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONTROL_APPLY_FAILED');
    // The journal must NOT have been flipped to applied.
    expect(state.updateRows.find((r) => (r.provenance as Row)?.status === 'applied')).toBeUndefined();
  });
});

afterEach(() => {
  resetSecurityEventSink();
});
