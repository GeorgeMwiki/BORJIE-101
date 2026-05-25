/**
 * move-out router smoke tests (Wave 26 Z3).
 *
 * Verifies every endpoint rejects anonymous callers. Full integration is
 * covered by the domain-service tests under
 * services/domain-services/src/lease — this file only validates that the
 * router is mounted and the auth middleware runs before any handler logic.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import moveOutRouter from '../move-out.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/move-out', moveOutRouter);
  return app;
}

describe('move-out router — auth gates', () => {
  it('rejects POST /:leaseId/checklist without a token', async () => {
    const res = await mount().request('/move-out/lease-1/checklist', {
      method: 'POST',
      body: JSON.stringify({ currency: 'KES', totalDeposit: 100 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects GET /:leaseId/checklist without a token', async () => {
    const res = await mount().request('/move-out/lease-1/checklist');
    expect(res.status).toBe(401);
  });

  it('rejects POST /:leaseId/checklist/:itemId/complete without a token', async () => {
    const res = await mount().request(
      '/move-out/lease-1/checklist/final_inspection/complete',
      {
        method: 'POST',
        body: JSON.stringify({ conditionReportId: 'cr-1' }),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST /:leaseId/finalize without a token', async () => {
    const res = await mount().request('/move-out/lease-1/finalize', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });
});
