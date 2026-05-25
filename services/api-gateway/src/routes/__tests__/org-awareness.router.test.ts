/**
 * Org-awareness router smoke tests.
 *
 * Full integration tests need a live JWT/service-registry; here we
 * verify auth enforcement on every endpoint and that the router shape
 * is correct (400/401 branches without a token).
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import orgAwarenessRouter from '../org-awareness.router.js';

describe('org-awareness router', () => {
  it('rejects GET /bottlenecks without a token', async () => {
    const app = new Hono();
    app.route('/org', orgAwarenessRouter);
    const res = await app.request('/org/bottlenecks');
    expect(res.status).toBe(401);
  });

  it('rejects GET /improvements without a token', async () => {
    const app = new Hono();
    app.route('/org', orgAwarenessRouter);
    const res = await app.request('/org/improvements?baseline=borjie_start');
    expect(res.status).toBe(401);
  });

  it('rejects GET /process-stats without a token', async () => {
    const app = new Hono();
    app.route('/org', orgAwarenessRouter);
    const res = await app.request('/org/process-stats/maintenance_case');
    expect(res.status).toBe(401);
  });

  it('rejects POST /snapshot without a token', async () => {
    const app = new Hono();
    app.route('/org', orgAwarenessRouter);
    const res = await app.request('/org/snapshot', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /query without a token', async () => {
    const app = new Hono();
    app.route('/org', orgAwarenessRouter);
    const res = await app.request('/org/query', {
      method: 'POST',
      body: JSON.stringify({ question: 'how are we doing?' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });
});
