/**
 * /api/v1/owner/org-loop-approvals — the HITL approval consumer contract:
 *
 *   1. APPROVE happy path: owner POST → orchestrator.resumeApprovedRun is
 *      called with the auth tenantId + the runId, and the dispatched outcome
 *      maps to 200 with the taskId.
 *   2. DISMISS happy path: the note threads through (and defaults to the
 *      locale-neutral token when the body is absent).
 *   3. Wrong role → 403 and the orchestrator is NEVER called.
 *   4. run_not_found → 404; not_awaiting_approval → 409.
 *   5. The spine not composed (getOrchestrator → null) → 503.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { UserRole } from '../../../types/user-role';

// ── Mock auth middleware (hoisted). Auth ctx comes from a global slot. ──────
vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_OLA_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
}));

import {
  createOrgLoopApprovalsRouter,
  type OrgLoopApprovalActions,
} from '../org-loop-approvals.hono';

// ── A recording stub of the orchestrator's approval surface ─────────────────

interface StubCalls {
  approve: Array<{ tenantId: string; runId: string }>;
  dismiss: Array<{ tenantId: string; runId: string; note: string }>;
}

function stubActions(opts?: {
  approveOutcome?: Awaited<ReturnType<OrgLoopApprovalActions['resumeApprovedRun']>>;
  dismissOutcome?: Awaited<ReturnType<OrgLoopApprovalActions['dismissParkedRun']>>;
}): { actions: OrgLoopApprovalActions; calls: StubCalls } {
  const calls: StubCalls = { approve: [], dismiss: [] };
  const actions: OrgLoopApprovalActions = {
    async resumeApprovedRun(tenantId, runId) {
      calls.approve.push({ tenantId, runId });
      return (
        opts?.approveOutcome ??
        Object.freeze({
          kind: 'dispatched' as const,
          runId,
          taskId: 'task_42',
          chosenEmployeeId: 'emp_top',
        })
      );
    },
    async dismissParkedRun(tenantId, runId, note) {
      calls.dismiss.push({ tenantId, runId, note });
      return (
        opts?.dismissOutcome ??
        Object.freeze({ kind: 'dismissed' as const, runId })
      );
    },
  };
  return { actions, calls };
}

function asOwner(): void {
  (globalThis as any).__BORJIE_OLA_AUTH__ = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    role: UserRole.OWNER,
  };
}

beforeEach(() => {
  (globalThis as any).__BORJIE_OLA_AUTH__ = null;
});

describe('POST /:runId/approve', () => {
  it('resumes the parked run for the auth tenant and returns the taskId', async () => {
    asOwner();
    const { actions, calls } = stubActions();
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });

    const res = await app.request('/run_1/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.outcome).toBe('dispatched');
    expect(body.data.taskId).toBe('task_42');
    expect(body.data.chosenEmployeeId).toBe('emp_top');
    // Tenant scope is the AUTH tenant — never caller-supplied.
    expect(calls.approve).toEqual([{ tenantId: 'tenant-1', runId: 'run_1' }]);
  });

  it('maps run_not_found → 404 and not_awaiting_approval → 409', async () => {
    asOwner();
    const notFound = stubActions({
      approveOutcome: { kind: 'skipped', reason: 'run_not_found' },
    });
    const app404 = createOrgLoopApprovalsRouter({
      getOrchestrator: () => notFound.actions,
    });
    expect((await app404.request('/x/approve', { method: 'POST' })).status).toBe(404);

    const notParked = stubActions({
      approveOutcome: { kind: 'skipped', reason: 'not_awaiting_approval' },
    });
    const app409 = createOrgLoopApprovalsRouter({
      getOrchestrator: () => notParked.actions,
    });
    expect((await app409.request('/x/approve', { method: 'POST' })).status).toBe(409);
  });

  it('maps a failed outcome → 500 with a generic message (no reason leak)', async () => {
    asOwner();
    const { actions } = stubActions({
      approveOutcome: { kind: 'failed', runId: 'run_1', reason: 'db exploded at 10.0.0.7' },
    });
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });
    const res = await app.request('/run_1/approve', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(JSON.stringify(body)).not.toContain('10.0.0.7');
  });

  it('rejects a non-owner role with 403 and never calls the orchestrator', async () => {
    (globalThis as any).__BORJIE_OLA_AUTH__ = {
      userId: 'user-2',
      tenantId: 'tenant-1',
      role: UserRole.MAINTENANCE_STAFF,
    };
    const { actions, calls } = stubActions();
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });

    const res = await app.request('/run_1/approve', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(calls.approve).toHaveLength(0);
  });

  it('answers 503 honestly while the spine is not composed', async () => {
    asOwner();
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => null });
    const res = await app.request('/run_1/approve', { method: 'POST' });
    expect(res.status).toBe(503);
  });
});

describe('POST /:runId/dismiss', () => {
  it('dismisses with the supplied note', async () => {
    asOwner();
    const { actions, calls } = stubActions();
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });

    const res = await app.request('/run_9/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Not needed — handled offline.' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.outcome).toBe('dismissed');
    expect(calls.dismiss).toEqual([
      { tenantId: 'tenant-1', runId: 'run_9', note: 'Not needed — handled offline.' },
    ]);
  });

  it('defaults the note to the locale-neutral token when the body is absent', async () => {
    asOwner();
    const { actions, calls } = stubActions();
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });

    const res = await app.request('/run_9/dismiss', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(calls.dismiss[0]?.note).toBe('dismissed_by_owner');
  });

  it('rejects a present-but-invalid body with 400', async () => {
    asOwner();
    const { actions, calls } = stubActions();
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });

    const res = await app.request('/run_9/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(calls.dismiss).toHaveLength(0);
  });

  it('rejects a non-owner role with 403', async () => {
    (globalThis as any).__BORJIE_OLA_AUTH__ = {
      userId: 'user-2',
      tenantId: 'tenant-1',
      role: UserRole.ACCOUNTANT,
    };
    const { actions, calls } = stubActions();
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });

    const res = await app.request('/run_9/dismiss', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(calls.dismiss).toHaveLength(0);
  });

  it('maps run_not_found → 404', async () => {
    asOwner();
    const { actions } = stubActions({
      dismissOutcome: { kind: 'skipped', reason: 'run_not_found' },
    });
    const app = createOrgLoopApprovalsRouter({ getOrchestrator: () => actions });
    const res = await app.request('/run_9/dismiss', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
