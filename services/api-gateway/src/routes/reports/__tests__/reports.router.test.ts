/**
 * /v1/strategic-reports router tests.
 *
 * Wires a mocked strategic-reports engine into the router so we can
 * exercise the full HTTP surface without spinning up advisor packages,
 * a brain, a document studio, or a WORM audit store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

// JWT secret + dotenv skip must be set BEFORE any router import so
// the module captures the deterministic test secret.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import strategicReportsRouter from '../reports.router';
import {
  setEngineForTests,
  _resetEngineForTests,
  _resetReportsRateLimitForTests,
  _resetJobIndexForTests,
} from '../index';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import type {
  ReportEngine,
  ReportSpec,
  PersistedReport,
  StrategicReport,
} from '@borjie/strategic-reports';

function mount(): Hono {
  const app = new Hono();
  app.route('/v1/strategic-reports', strategicReportsRouter);
  return app;
}

function bearer(role: UserRole, opts?: { userId?: string; tenantId?: string }): string {
  return `Bearer ${generateToken({
    userId: opts?.userId ?? `usr-${role}`,
    tenantId: opts?.tenantId ?? 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function fakeReport(spec: ReportSpec): StrategicReport {
  return {
    type: spec.type,
    spec,
    title: `Fake ${spec.type}`,
    executiveSummary: 'fake summary',
    sections: [
      { id: 'sec-1', title: 'S', heading: 1, body: 'body', charts: [], tables: [] },
    ],
    citations: [
      { id: 'c1', claim: 'claim', source: { kind: 'computation', ref: 'r' } },
    ],
    charts: [],
    tables: [],
    actionPlan: [
      { id: 'a1', title: 't', description: 'd', owner: 'o', dueDateIso: '2026-07-01', priority: 'p1', successCriterion: 's', citationIds: [] },
      { id: 'a2', title: 't', description: 'd', owner: 'o', dueDateIso: '2026-07-01', priority: 'p1', successCriterion: 's', citationIds: [] },
      { id: 'a3', title: 't', description: 'd', owner: 'o', dueDateIso: '2026-07-01', priority: 'p1', successCriterion: 's', citationIds: [] },
      { id: 'a4', title: 't', description: 'd', owner: 'o', dueDateIso: '2026-07-01', priority: 'p1', successCriterion: 's', citationIds: [] },
      { id: 'a5', title: 't', description: 'd', owner: 'o', dueDateIso: '2026-07-01', priority: 'p1', successCriterion: 's', citationIds: [] },
    ],
    appendices: [],
    synthesis: { agreement: 1, escalate: false, proposerIds: ['p'], synthesizerId: 's', mode: 'merge' },
  };
}

function fakeEngineOk(): ReportEngine {
  return {
    async generateReport(spec) {
      const report = fakeReport(spec);
      const persisted: PersistedReport = {
        reportId: `rpt_${spec.type}_test`,
        orgId: spec.scope.kind === 'tenant' || spec.scope.kind === 'property' || spec.scope.kind === 'deal' || spec.scope.kind === 'portfolio' ? spec.scope.orgId : 'tnt-test',
        type: spec.type,
        report,
        artifacts: [
          { format: spec.format, mimeType: 'text/html', buffer: new Uint8Array(0), sha256: 'sha256:abc' },
        ],
        auditEntryId: 'audit_1',
        createdAtIso: new Date().toISOString(),
      };
      return { ok: true, value: { persisted, warnings: [] } };
    },
  };
}

function fakeEngineFail(code: 'gather_failed_all_sources' = 'gather_failed_all_sources'): ReportEngine {
  return {
    async generateReport() {
      return { ok: false, error: { code, message: 'forced failure' } };
    },
  };
}

const VALID_SPEC_BODY = (overrides?: { actorId?: string; orgId?: string }) => ({
  spec: {
    type: 'leasing_financial_performance' as const,
    scope: { kind: 'portfolio' as const, orgId: overrides?.orgId ?? 'tnt-test' },
    audience: 'board' as const,
    depth: 'standard' as const,
    format: 'html' as const,
    jurisdiction: 'TZ' as const,
    period: { periodStart: '2026-04-01', periodEnd: '2026-06-30', label: 'FY26 Q2' },
    prompt: 'Generate the test report.',
    ...(overrides?.actorId ? { actorId: overrides.actorId } : {}),
  },
});

describe('POST /v1/strategic-reports — auth gate', () => {
  beforeEach(() => {
    _resetEngineForTests();
    _resetReportsRateLimitForTests();
    _resetJobIndexForTests();
    setEngineForTests(fakeEngineOk());
  });

  it('returns 401 without bearer', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid bearer', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: 'Bearer bogus.jwt' },
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/strategic-reports — happy path', () => {
  beforeEach(() => {
    _resetEngineForTests();
    _resetReportsRateLimitForTests();
    _resetJobIndexForTests();
    setEngineForTests(fakeEngineOk());
  });

  it('returns 202 + jobId + status=completed (inline executor)', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.jobId).toMatch(/^job_/);
    expect(body.data.status).toBe('completed');
    expect(body.data.estimatedSeconds).toBe(30);
  });

  it('returns 503 when no engine is wired', async () => {
    _resetEngineForTests(); // remove the engine after beforeEach set one
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('ENGINE_NOT_CONFIGURED');
  });
});

describe('POST /v1/strategic-reports — validation', () => {
  beforeEach(() => {
    _resetEngineForTests();
    _resetReportsRateLimitForTests();
    _resetJobIndexForTests();
    setEngineForTests(fakeEngineOk());
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing spec.type', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify({ spec: { ...VALID_SPEC_BODY().spec, type: undefined } }),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when spec.scope.orgId does not match caller tenantId', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY({ orgId: 'tnt-OTHER' })),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-ME' }) },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('forces actorId from JWT — body actorId is ignored', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY({ actorId: 'spoofed-actor' })),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN, { userId: 'real-actor', tenantId: 'tnt-test' }) },
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    // The created job is keyed by JWT userId, not the body's spoof.
    const jobId = body.data.jobId;
    const lookup = await mount().request(`/v1/strategic-reports/${jobId}`, {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN, { userId: 'real-actor', tenantId: 'tnt-test' }) },
    });
    expect(lookup.status).toBe(200);
  });
});

describe('GET /v1/strategic-reports/:jobId', () => {
  beforeEach(() => {
    _resetEngineForTests();
    _resetReportsRateLimitForTests();
    _resetJobIndexForTests();
    setEngineForTests(fakeEngineOk());
  });

  it('returns 401 without bearer', async () => {
    const res = await mount().request('/v1/strategic-reports/job_x');
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown job id', async () => {
    const res = await mount().request('/v1/strategic-reports/job_unknown', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with the completed report payload', async () => {
    const app = mount();
    const created = await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    const jobId = (await created.json()).data.jobId as string;
    const res = await app.request(`/v1/strategic-reports/${jobId}`, {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('completed');
    expect(body.data.report.title).toBe('Fake leasing_financial_performance');
    expect(body.data.report.sectionCount).toBe(1);
    expect(body.data.report.citationCount).toBe(1);
    expect(body.data.report.actionPlanCount).toBe(5);
    expect(body.data.downloadUrl).toMatch(/^\/api\/v1\/strategic-reports\//);
  });

  it('returns 404 for cross-tenant access attempts (hides existence)', async () => {
    const app = mount();
    const created = await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-A' }) },
    });
    // Above POST may 403 because orgId='tnt-test' != tenantId='tnt-A'.
    // Re-run with a matching orgId.
    const goodPost = await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY({ orgId: 'tnt-A' })),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-A' }) },
    });
    expect(goodPost.status).toBe(202);
    const jobId = (await goodPost.json()).data.jobId as string;
    // Cross-tenant fetch.
    const cross = await app.request(`/v1/strategic-reports/${jobId}`, {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-B' }) },
    });
    expect(cross.status).toBe(404);
    void created;
  });

  it('surfaces failed status with errorCode when the engine errors', async () => {
    setEngineForTests(fakeEngineFail('gather_failed_all_sources'));
    const app = mount();
    const created = await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    const jobId = (await created.json()).data.jobId as string;
    const res = await app.request(`/v1/strategic-reports/${jobId}`, {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    const body = await res.json();
    expect(body.data.status).toBe('failed');
    expect(body.data.errorCode).toBe('gather_failed_all_sources');
  });
});

describe('GET /v1/strategic-reports — list', () => {
  beforeEach(() => {
    _resetEngineForTests();
    _resetReportsRateLimitForTests();
    _resetJobIndexForTests();
    setEngineForTests(fakeEngineOk());
  });

  it('returns 401 without bearer', async () => {
    const res = await mount().request('/v1/strategic-reports');
    expect(res.status).toBe(401);
  });

  it('returns an empty list when no jobs exist for the tenant', async () => {
    const res = await mount().request('/v1/strategic-reports', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it('returns jobs filtered by type', async () => {
    const app = mount();
    await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    const matching = await app.request('/v1/strategic-reports?type=leasing_financial_performance', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(matching.status).toBe(200);
    const matchingBody = await matching.json();
    expect(matchingBody.data.items.length).toBe(1);

    const empty = await app.request('/v1/strategic-reports?type=sustainability_ghg_report', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    const emptyBody = await empty.json();
    expect(emptyBody.data.items.length).toBe(0);
  });

  it('hides cross-tenant rows', async () => {
    const app = mount();
    await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY({ orgId: 'tnt-A' })),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-A' }) },
    });
    const res = await app.request('/v1/strategic-reports', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-B' }) },
    });
    const body = await res.json();
    expect(body.data.items.length).toBe(0);
  });

  it('returns 403 when querying with a different orgId', async () => {
    const res = await mount().request('/v1/strategic-reports?orgId=tnt-OTHER', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-test' }) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid limit', async () => {
    const res = await mount().request('/v1/strategic-reports?limit=zzz', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/strategic-reports/:jobId/regenerate', () => {
  beforeEach(() => {
    _resetEngineForTests();
    _resetReportsRateLimitForTests();
    _resetJobIndexForTests();
    setEngineForTests(fakeEngineOk());
  });

  it('returns 401 without bearer', async () => {
    const res = await mount().request('/v1/strategic-reports/job_x/regenerate', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown source job', async () => {
    const res = await mount().request('/v1/strategic-reports/job_missing/regenerate', {
      method: 'POST',
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(404);
  });

  it('returns 202 + a new job id for a valid regenerate', async () => {
    const app = mount();
    const created = await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    const sourceJobId = (await created.json()).data.jobId as string;
    const res = await app.request(`/v1/strategic-reports/${sourceJobId}/regenerate`, {
      method: 'POST',
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.sourceJobId).toBe(sourceJobId);
    expect(body.data.jobId).not.toBe(sourceJobId);
    expect(body.data.status).toBe('completed');
  });

  it('returns 404 on cross-tenant regenerate attempts', async () => {
    const app = mount();
    const created = await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY({ orgId: 'tnt-A' })),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-A' }) },
    });
    const sourceJobId = (await created.json()).data.jobId as string;
    const res = await app.request(`/v1/strategic-reports/${sourceJobId}/regenerate`, {
      method: 'POST',
      headers: { authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt-B' }) },
    });
    expect(res.status).toBe(404);
  });
});

describe('rate limiting (5 req/min per user per endpoint)', () => {
  beforeEach(() => {
    _resetEngineForTests();
    _resetReportsRateLimitForTests();
    _resetJobIndexForTests();
    setEngineForTests(fakeEngineOk());
  });

  it('returns 429 on the 6th call to POST /strategic-reports', async () => {
    const app = mount();
    const auth = bearer(UserRole.SUPER_ADMIN, { userId: 'u-rate' });
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/v1/strategic-reports', {
        method: 'POST',
        body: JSON.stringify(VALID_SPEC_BODY()),
        headers: { 'content-type': 'application/json', authorization: auth },
      });
      expect(res.status).toBe(202);
    }
    const overflow = await app.request('/v1/strategic-reports', {
      method: 'POST',
      body: JSON.stringify(VALID_SPEC_BODY()),
      headers: { 'content-type': 'application/json', authorization: auth },
    });
    expect(overflow.status).toBe(429);
    const body = await overflow.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
