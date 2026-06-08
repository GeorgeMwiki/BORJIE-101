/**
 * research router tests.
 *
 * Three layers (mirrors portal-genui.router.test.ts):
 *
 *   1. Auth gates — anonymous requests bounce with 401.
 *   2. Engine-missing — a wired-but-empty services bag returns 503 with the
 *      RESEARCH_ENGINE_MISSING code (fail-closed, never a crash).
 *   3. Happy path — a real signed JWT + a real research engine built from
 *      in-memory repos (empty tool registry → the orchestrator's documented
 *      degraded run: a fully-persisted, audit-hashed "no external findings"
 *      result). The audit port is swapped for an in-memory recorder so the
 *      in-memory run does not trip the fail-closed DB-audit check.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import type { AuditEmitterPort } from '@borjie/research-orchestrator';
import researchRouter from '../research/research.router.js';
import {
  buildResearchDeps,
  createResearchEngine,
  type ResearchEngine,
} from '../../composition/research/research-wiring.js';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

/** An audit port that records emissions instead of asserting a DB anchor. */
function inMemoryAudit(): AuditEmitterPort & { readonly count: () => number } {
  let n = 0;
  return {
    async emit() {
      n += 1;
    },
    count: () => n,
  };
}

/** Build a real engine over in-memory repos with a no-op audit recorder. */
function buildTestEngine(): ResearchEngine {
  const deps = buildResearchDeps(null);
  const engineDeps = { ...deps, audit: inMemoryAudit() };
  return createResearchEngine(engineDeps);
}

function bareApp(): Hono {
  const app = new Hono();
  app.route('/research', researchRouter);
  return app;
}

function appWithEngine(engine: ResearchEngine): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', { researchEngine: engine } as never);
    await next();
  });
  app.route('/research', researchRouter);
  return app;
}

function bearer(
  opts: { userId?: string; tenantId?: string; role?: UserRole } = {},
): string {
  return `Bearer ${generateToken({
    userId: opts.userId ?? 'user_1',
    tenantId: opts.tenantId ?? 'tenant_1',
    role: (opts.role ?? UserRole.SUPER_ADMIN) as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

describe('research router — JWT env', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('has a JWT secret long enough to sign test tokens', () => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });
});

// ────────────────────────────────────────────────────────────────────
// Auth gates
// ────────────────────────────────────────────────────────────────────

describe('research router — auth gates', () => {
  it('rejects POST /reactive without a token', async () => {
    const res = await bareApp().request('/research/reactive', {
      method: 'POST',
      body: JSON.stringify({ query: 'gold price outlook' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /deep-dive without a token', async () => {
    const res = await bareApp().request('/research/deep-dive', {
      method: 'POST',
      body: JSON.stringify({ query: 'x', topic: 'x' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid bearer token', async () => {
    const res = await bareApp().request('/research/reactive', {
      method: 'POST',
      body: JSON.stringify({ query: 'x' }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer not-a-real-jwt',
      },
    });
    expect(res.status).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────────────
// Engine-missing — 503 fail-closed
// ────────────────────────────────────────────────────────────────────

describe('research router — engine missing', () => {
  it('returns 503 on /reactive when no engine is wired', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('services', {} as never); // no engine
      await next();
    });
    app.route('/research', researchRouter);
    const res = await app.request('/research/reactive', {
      method: 'POST',
      body: JSON.stringify({ query: 'x' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RESEARCH_ENGINE_MISSING');
  });

  it('returns 503 on /deep-dive when no engine is wired', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('services', {} as never);
      await next();
    });
    app.route('/research', researchRouter);
    const res = await app.request('/research/deep-dive', {
      method: 'POST',
      body: JSON.stringify({ query: 'x', topic: 'x' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(503);
  });
});

// ────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────

describe('research router — validation', () => {
  it('rejects invalid /reactive body with 400', async () => {
    const res = await appWithEngine(buildTestEngine()).request('/research/reactive', {
      method: 'POST',
      body: JSON.stringify({ wrong: 'field' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await appWithEngine(buildTestEngine()).request('/research/reactive', {
      method: 'POST',
      body: '{not json',
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects /deep-dive missing topic with 400', async () => {
    const res = await appWithEngine(buildTestEngine()).request('/research/deep-dive', {
      method: 'POST',
      body: JSON.stringify({ query: 'research the cobalt market deeply' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────
// Happy paths — real run through the orchestrator pipeline
// ────────────────────────────────────────────────────────────────────

describe('research router — POST /reactive', () => {
  it('runs a reactive query and returns a persisted, audit-hashed result', async () => {
    const res = await appWithEngine(buildTestEngine()).request('/research/reactive', {
      method: 'POST',
      body: JSON.stringify({ query: 'What is the current gold price outlook?' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        planId: string;
        status: string;
        result: { id: string; auditHash: string; confidence: string };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.planId.length).toBeGreaterThan(0);
    expect(body.data.result.id.length).toBeGreaterThan(0);
    // Spec anti-pattern §12.5 — a result is never emitted without an audit hash.
    expect(body.data.result.auditHash.length).toBeGreaterThan(0);
    expect(['high', 'medium', 'low']).toContain(body.data.result.confidence);
    expect(body.data.status).toBe('complete');
  });
});

describe('research router — POST /deep-dive', () => {
  it('runs a deep dive and returns a session + persisted result', async () => {
    const res = await appWithEngine(buildTestEngine()).request('/research/deep-dive', {
      method: 'POST',
      body: JSON.stringify({
        query: 'Assess the lithium export licensing landscape',
        topic: 'lithium-export-licensing',
      }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        planId: string;
        sessionId: string;
        status: string;
        result?: { auditHash: string };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.sessionId.length).toBeGreaterThan(0);
    expect(body.data.planId.length).toBeGreaterThan(0);
    expect(body.data.status).toBe('complete');
    expect(body.data.result?.auditHash.length ?? 0).toBeGreaterThan(0);
  });
});
