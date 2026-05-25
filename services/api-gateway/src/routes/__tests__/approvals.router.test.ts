/**
 * approvals router smoke tests (Wave 26 Z3).
 *
 * Verifies auth gates on every endpoint. Decision-path tests (approve /
 * reject / escalate) live in the domain-services package; this file only
 * asserts the router is mounted and rejects anonymous traffic.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import approvalsRouter from '../approvals.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/approvals', approvalsRouter);
  return app;
}

describe('approvals router — auth gates', () => {
  it('rejects POST / without a token', async () => {
    const res = await mount().request('/approvals', {
      method: 'POST',
      body: JSON.stringify({
        type: 'maintenance_cost',
        justification: 'HVAC replacement',
        details: { amount: 800, currency: 'USD' },
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects GET / without a token', async () => {
    const res = await mount().request('/approvals');
    expect(res.status).toBe(401);
  });

  it('rejects GET /:id without a token', async () => {
    const res = await mount().request('/approvals/apr_123');
    expect(res.status).toBe(401);
  });

  it('rejects POST /:id/approve without a token', async () => {
    const res = await mount().request('/approvals/apr_123/approve', {
      method: 'POST',
      body: JSON.stringify({ comments: null }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /:id/reject without a token', async () => {
    const res = await mount().request('/approvals/apr_123/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'no' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /:id/escalate without a token', async () => {
    const res = await mount().request('/approvals/apr_123/escalate', {
      method: 'POST',
      body: JSON.stringify({ toUserId: 'usr_2', reason: 'exceeds limit' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects GET /history without a token', async () => {
    const res = await mount().request('/approvals/history');
    expect(res.status).toBe(401);
  });

  it('rejects PUT /policies/:type without a token', async () => {
    const res = await mount().request('/approvals/policies/maintenance_cost', {
      method: 'PUT',
      body: JSON.stringify({
        thresholds: [],
        autoApproveRules: [],
        approvalChain: [],
        defaultTimeoutHours: 48,
        autoEscalateToRole: null,
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });
});
