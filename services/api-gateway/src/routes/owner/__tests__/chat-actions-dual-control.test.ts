/**
 * /api/v1/owner/chat/* — dual-control (impossible-do) closure tests.
 *
 * Pins the gate→enqueue seam: when the autonomy controller escalates a
 * chat action to `gate` / `four_eyes`, the handler must NOT silently
 * decline (which would strand the action with no approval record a second
 * approver could resolve). Instead it QUEUES a pending four-eye request via
 * the SHARED `enqueueFourEyeRequest` path and returns
 * `requiresSecondApproval:true` + a `pendingApprovalId`, WITHOUT executing.
 *
 * The gate, the four-eye enqueue helper, the action-executor registry, and
 * the auth/database middleware are all mocked so the branch is exercised
 * deterministically in mock-mode (no live Postgres) — matching the
 * `break-glass/__tests__/leak-guard.test.ts` middleware-injection pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// ─── Mocks ───────────────────────────────────────────────────────────

// Inject a signed-in owner + a truthy db (any object) so the handler
// passes its `getDbOr503` guard and reaches `gateExecuteAudit`.
vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('auth', { tenantId: 'tenant-fe-1', userId: 'owner-fe-1' });
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', { __fake: true });
    await next();
  },
}));

// Gate verdict is driven per-test via this mutable ref.
const gateRef: { decision: unknown } = { decision: null };
vi.mock('../../../services/auto-authorize-gate/index.js', () => ({
  decideAutoAuthorization: () => gateRef.decision,
  screenGenerativeVerb: () => ({ allowed: false, reason: 'unknown' }),
}));
vi.mock('../../../services/auto-authorize-gate/audit.js', () => ({
  appendAutoAuthorizedAudit: vi.fn(async () => undefined),
}));

// Treat the test verb as a KNOWN, non-confirm-required verb so control
// flows past the confirm-required + generative branches into the gate.
const dispatchSpy = vi.fn(async () => ({ executed: false, reason: 'noop' }));
vi.mock('../../../services/action-executor/index.js', () => ({
  dispatchAction: dispatchSpy,
  requiresConfirmation: () => false,
  isKnownVerb: () => true,
}));

// Spy on the shared four-eye enqueue path.
const enqueueSpy = vi.fn(
  async () => ({ requestId: 'fe-req-123', approvalToken: 'tok-abc' }),
);
vi.mock('../four-eye-approvals.hono.js', () => ({
  enqueueFourEyeRequest: enqueueSpy,
}));

async function mount(): Promise<Hono> {
  const { ownerChatActionsRouter } = await import('../chat-actions.hono');
  const app = new Hono();
  app.route('/owner/chat', ownerChatActionsRouter);
  return app;
}

function post(path: string, body: unknown) {
  return mount().then((app) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  enqueueSpy.mockClear();
  dispatchSpy.mockClear();
  gateRef.decision = null;
});

describe('chat-actions dual-control (impossible-do closure)', () => {
  it('four_eyes decision queues a second approval and does NOT execute', async () => {
    gateRef.decision = {
      authorized: false,
      reason:
        'autonomy-controller:four_eyes (gatedBy=consequence)',
      autonomyDecision: 'four_eyes',
    };

    const res = await post('/owner/chat/confirm-action', {
      verb: 'update_site',
      params: { siteId: 's-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        executed: boolean;
        authorized: boolean;
        requiresSecondApproval?: boolean;
        pendingApprovalId?: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.executed).toBe(false);
    expect(body.data.authorized).toBe(false);
    expect(body.data.requiresSecondApproval).toBe(true);
    expect(body.data.pendingApprovalId).toBe('fe-req-123');

    // It enqueued exactly one dual-control ticket with the verb preserved…
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const [, enqueueArgs] = enqueueSpy.mock.calls[0] as [
      unknown,
      { actionType: string; payload: Record<string, unknown> },
    ];
    expect(enqueueArgs.actionType).toBe('update_site');
    expect(enqueueArgs.payload.verb).toBe('update_site');

    // …and it NEVER dispatched/executed the action.
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('gate decision also queues a second approval (not a silent decline)', async () => {
    gateRef.decision = {
      authorized: false,
      reason: 'autonomy-controller:gate (gatedBy=confidence)',
      autonomyDecision: 'gate',
    };

    const res = await post('/owner/chat/confirm-action', {
      verb: 'update_site',
      params: {},
    });
    const body = (await res.json()) as {
      data: { requiresSecondApproval?: boolean; pendingApprovalId?: string };
    };
    expect(body.data.requiresSecondApproval).toBe(true);
    expect(body.data.pendingApprovalId).toBe('fe-req-123');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('a non-autonomy denial keeps the silent-decline shape (no enqueue)', async () => {
    gateRef.decision = {
      authorized: false,
      reason: 'policy-gate:blocked',
      autonomyDecision: undefined,
    };

    const res = await post('/owner/chat/confirm-action', {
      verb: 'update_site',
      params: {},
    });
    const body = (await res.json()) as {
      data: {
        executed: boolean;
        authorized: boolean;
        reason: string;
        requiresSecondApproval?: boolean;
      };
    };
    expect(body.data.executed).toBe(false);
    expect(body.data.authorized).toBe(false);
    expect(body.data.reason).toBe('policy-gate:blocked');
    expect(body.data.requiresSecondApproval).toBeUndefined();
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('four_eyes enqueue fault falls back to the silent decline (honest-degrade)', async () => {
    gateRef.decision = {
      authorized: false,
      reason: 'autonomy-controller:four_eyes (gatedBy=consequence)',
      autonomyDecision: 'four_eyes',
    };
    enqueueSpy.mockResolvedValueOnce(null as never);

    const res = await post('/owner/chat/confirm-action', {
      verb: 'update_site',
      params: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { executed: boolean; requiresSecondApproval?: boolean };
    };
    expect(body.data.executed).toBe(false);
    expect(body.data.requiresSecondApproval).toBeUndefined();
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
