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

  // R20 / KI-013 — when the deps include a migrationWizardCopilot, the
  // ask handler routes through it rather than the 501 / dev-flag path.
  it('routes ask through migrationWizardCopilot when bound', async () => {
    const calls: Array<{
      tenantId: string;
      actorId: string;
      runId: string;
      message: string;
    }> = [];
    const stubCopilot = {
      run: async (args: {
        tenantId: string;
        actorId: string;
        runId: string;
        message: string;
      }) => {
        calls.push(args);
        return { narrative: 'Plan looks safe; proposed commit.' };
      },
    };
    const app = new Hono<{ Variables: { tenantId: string; actorId: string } }>();
    // Inline auth — bypass for this scenario so we can hit the wizard.
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant_abc');
      c.set('actorId', 'actor_xyz');
      await next();
    });
    app.route(
      '/',
      createMigrationRouter({
        getService: () => fakeService() as never,
        migrationWizardCopilot: stubCopilot,
      })
    );
    const res = await app.request('/run_alpha/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'how risky is this run?' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; runId: string };
    expect(body.ok).toBe(true);
    expect(body.runId).toBe('run_alpha');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      tenantId: 'tenant_abc',
      actorId: 'actor_xyz',
      runId: 'run_alpha',
      message: 'how risky is this run?',
    });
  });

  // When the copilot is bound but throws, the handler returns a typed
  // 503 with COPILOT_ERROR — never a fabricated 200.
  it('returns 503 COPILOT_ERROR when migrationWizardCopilot throws', async () => {
    const stubCopilot = {
      run: async () => {
        throw new Error('downstream LLM unavailable');
      },
    };
    const app = new Hono<{ Variables: { tenantId: string; actorId: string } }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 't');
      c.set('actorId', 'a');
      await next();
    });
    app.route(
      '/',
      createMigrationRouter({
        getService: () => fakeService() as never,
        migrationWizardCopilot: stubCopilot,
      })
    );
    const res = await app.request('/run_beta/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('COPILOT_ERROR');
    expect(body.error.message).toBe('downstream LLM unavailable');
  });
});
