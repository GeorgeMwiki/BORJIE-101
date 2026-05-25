/**
 * Migration router smoke tests.
 *
 * The router depends on @borjie/ai-copilot + @borjie/domain-services
 * workspace packages. These tests describe the expected request/response
 * envelope. Full integration tests run in the top-level e2e suite.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createMigrationRouter } from '../migration.router.js';

function fakeService() {
  return {
    // minimal shape parroted by the router
    repo: {
      createRun: async (input: unknown) => ({ id: 'run_test', ...input }),
      updateStatus: async () => ({ id: 'run_test' }),
    },
    commit: async () => ({
      ok: true,
      counts: { properties: 1, units: 0, tenants: 0, employees: 0, departments: 0, teams: 0 },
      skipped: {},
      run: { id: 'run_test' },
    }),
  };
}

describe('migration.router', () => {
  it('rejects upload without tenantId (401)', async () => {
    const app = new Hono();
    app.route(
      '/',
      createMigrationRouter({
        getService: () => fakeService() as never,
      })
    );
    const res = await app.request('/upload', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(401);
  });

  it('rejects commit without tenantId (401)', async () => {
    const app = new Hono();
    app.route(
      '/',
      createMigrationRouter({
        getService: () => fakeService() as never,
      })
    );
    const res = await app.request('/run_test/commit', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects ask without tenantId (401)', async () => {
    const app = new Hono();
    app.route(
      '/',
      createMigrationRouter({
        getService: () => fakeService() as never,
      })
    );
    const res = await app.request('/run_test/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(res.status).toBe(401);
  });
});
