/**
 * Tests for the parity-capability-dashboard router (Wave-K).
 *
 * Verifies:
 *   - Top-level GET /dashboard responds 200 with a degraded payload when
 *     services.parityCapabilityDashboard is unwired.
 *   - GET /dashboard/runs forwards filter parsing and calls the service.
 *   - GET /dashboard/runs/:id surfaces 404 when service returns null.
 *   - POST /dashboard/runs/:id/judge wires through to the rejudge method.
 *   - All routes reject calls without a valid JWT.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { parityCapabilityDashboardRouter } from '../routes/parity-capability-dashboard.router';
import { getJwtSecret } from '../config/jwt';

function mintJwt(role: 'TENANT_ADMIN' | 'ADMIN' | 'SUPER_ADMIN' = 'TENANT_ADMIN'): string {
  return jwt.sign(
    {
      userId: 'usr_eval',
      tenantId: 'tn_eval',
      role,
      permissions: ['*'],
      propertyAccess: ['*'],
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '2h' },
  );
}

function buildApp(services: Record<string, unknown> = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', services as never);
    await next();
  });
  app.route('/parity/capability', parityCapabilityDashboardRouter);
  return app;
}

describe('parity-capability-dashboard router', () => {
  it('GET /dashboard returns a degraded payload when the service is unwired', async () => {
    const app = buildApp({});
    const res = await app.request('/parity/capability/dashboard', {
      headers: { Authorization: `Bearer ${mintJwt()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        capabilities: ReadonlyArray<{ id: string; runsLast24h: number }>;
        degraded?: boolean;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.degraded).toBe(true);
    expect(body.data.capabilities.length).toBe(6);
    const ids = body.data.capabilities.map((c) => c.id).sort();
    expect(ids).toEqual([
      'gepg',
      'kra-mri',
      'lease-renewal',
      'maintenance-triage',
      'rent-reconciliation',
      'voice-agent',
    ]);
  });

  it('GET /dashboard rolls up via the service when wired', async () => {
    const getRollup = vi.fn(async () => ({
      capabilities: [
        { id: 'rent-reconciliation', runsLast24h: 5, meanJudgeScore: 0.82, regenRateLast24h: 0.1 },
      ],
      totals: { provenanceCount: 5, cotSampleCount: 1 },
      generatedAt: '2026-05-14T00:00:00Z',
    }));
    const app = buildApp({
      parityCapabilityDashboard: { getRollup, listRuns: vi.fn(), getRun: vi.fn() },
    });
    const res = await app.request('/parity/capability/dashboard', {
      headers: { Authorization: `Bearer ${mintJwt()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { totals: { provenanceCount: number } } };
    expect(body.data.totals.provenanceCount).toBe(5);
    expect(getRollup).toHaveBeenCalledWith('tn_eval', expect.objectContaining({
      capabilities: expect.any(Array),
    }));
  });

  it('GET /dashboard/runs forwards filters', async () => {
    const listRuns = vi.fn(async () => ({
      runs: [
        { thoughtId: 't1', threadId: 'th1', stakes: 'high', judgeScore: 0.3, category: 'refusal', capability: null, producedAt: '2026-05-14T00:00:00Z' },
      ],
      total: 1,
    }));
    const app = buildApp({
      parityCapabilityDashboard: { getRollup: vi.fn(), listRuns, getRun: vi.fn() },
    });
    const res = await app.request(
      '/parity/capability/dashboard/runs?capability=rent-reconciliation&minScore=0.1&maxScore=0.5&category=refusal',
      { headers: { Authorization: `Bearer ${mintJwt()}` } },
    );
    expect(res.status).toBe(200);
    expect(listRuns).toHaveBeenCalledWith('tn_eval', expect.objectContaining({
      capability: 'rent-reconciliation',
      minScore: 0.1,
      maxScore: 0.5,
      category: 'refusal',
    }));
  });

  it('GET /dashboard/runs rejects minScore > maxScore', async () => {
    const app = buildApp({
      parityCapabilityDashboard: { getRollup: vi.fn(), listRuns: vi.fn(), getRun: vi.fn() },
    });
    const res = await app.request(
      '/parity/capability/dashboard/runs?minScore=0.9&maxScore=0.1',
      { headers: { Authorization: `Bearer ${mintJwt()}` } },
    );
    expect(res.status).toBe(400);
  });

  it('GET /dashboard/runs/:id returns 404 when the service has no row', async () => {
    const app = buildApp({
      parityCapabilityDashboard: {
        getRollup: vi.fn(),
        listRuns: vi.fn(),
        getRun: vi.fn(async () => null),
      },
    });
    const res = await app.request('/parity/capability/dashboard/runs/missing', {
      headers: { Authorization: `Bearer ${mintJwt()}` },
    });
    expect(res.status).toBe(404);
  });

  it('POST /dashboard/runs/:id/judge calls the rejudge service for platform admins', async () => {
    const rejudge = vi.fn(async () => ({
      thoughtId: 't1',
      threadId: 'th1',
      stakes: 'high',
      judgeScore: 0.92,
      category: null,
      capability: null,
      producedAt: '2026-05-14T00:00:00Z',
      cotThoughtText: '[redacted-phone] tenant called',
    }));
    const app = buildApp({
      parityCapabilityDashboard: {
        getRollup: vi.fn(),
        listRuns: vi.fn(),
        getRun: vi.fn(),
        rejudge,
      },
    });
    const res = await app.request('/parity/capability/dashboard/runs/t1/judge', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt('ADMIN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    expect(rejudge).toHaveBeenCalledWith('tn_eval', 't1', { draftOverride: undefined });
  });

  it('POST /dashboard/runs/:id/judge rejects TENANT_ADMIN (platform-admin only)', async () => {
    const rejudge = vi.fn(async () => ({}));
    const app = buildApp({
      parityCapabilityDashboard: {
        getRollup: vi.fn(),
        listRuns: vi.fn(),
        getRun: vi.fn(),
        rejudge,
      },
    });
    const res = await app.request('/parity/capability/dashboard/runs/t1/judge', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt('TENANT_ADMIN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(rejudge).not.toHaveBeenCalled();
  });

  it('POST /dashboard/runs/:id/judge emits an audit-trail entry when the recorder is wired', async () => {
    const rejudge = vi.fn(async () => ({ thoughtId: 't9' }));
    const record = vi.fn(async () => ({ id: 'aud_1' }));
    const app = buildApp({
      parityCapabilityDashboard: {
        getRollup: vi.fn(),
        listRuns: vi.fn(),
        getRun: vi.fn(),
        rejudge,
      },
      auditTrail: { recorder: { record } },
    });
    const res = await app.request('/parity/capability/dashboard/runs/t9/judge', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt('SUPER_ADMIN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ draft: 'override-cot' }),
    });
    expect(res.status).toBe(201);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tn_eval',
      actionKind: 'parity.rejudge',
      subject: expect.objectContaining({ entityType: 'parity.thought', entityId: 't9' }),
    }));
  });

  it('rejects unauthenticated requests', async () => {
    const app = buildApp({});
    const res = await app.request('/parity/capability/dashboard');
    expect(res.status).toBe(401);
  });
});
