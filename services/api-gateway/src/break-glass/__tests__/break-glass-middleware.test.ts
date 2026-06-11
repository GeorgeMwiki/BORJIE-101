/**
 * Break-glass enforcement middleware — the structural gate (INV-A / FIRE-1).
 *
 * Proves the gate makes the former leaks impossible to reach silently:
 *   - a platform principal is DENIED (403 BREAK_GLASS_REQUIRED) without an
 *     active, tenant-consented grant for the target tenant + scope;
 *   - once the tenant consents, the SAME request succeeds AND the access is
 *     appended to the hash-chained, tenant-visible log;
 *   - a grant for tenant A does not unlock tenant B (tenant mismatch);
 *   - a non-platform principal is refused outright.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { UserRole } from '../../types/user-role';
import {
  recordBreakGlassAccess,
  requireBreakGlass,
} from '../../middleware/break-glass';
import {
  __setOperatorAccessStore,
  getOperatorAccessStore,
} from '../store-singleton';
import { createInMemoryOperatorAccessStore } from '../operator-access-store';

const OP = 'op-1';
const T_A = 'tenant-a';

function withAuth(role: UserRole, userId = OP) {
  return async (c: any, next: any) => {
    c.set('auth', { userId, role, tenantId: 't-platform', permissions: [], propertyAccess: [] });
    await next();
  };
}

function buildContentApp(): Hono {
  const app = new Hono();
  app.use('*', withAuth(UserRole.SUPER_ADMIN));
  app.use('*', requireBreakGlass('decision_trace_content'));
  app.get('/:id/content', async (c: any) => {
    await recordBreakGlassAccess(c, {
      route: 'test/content',
      scope: 'decision_trace_content',
      rowCount: 1,
    });
    return c.json({ success: true, data: { secret: 'tenant-content' } }, 200);
  });
  return app;
}

describe('requireBreakGlass — deny-by-default for platform principals', () => {
  beforeEach(() => {
    __setOperatorAccessStore(createInMemoryOperatorAccessStore());
  });
  afterEach(() => {
    __setOperatorAccessStore(null);
  });

  it('denies a platform operator with no grant (403 BREAK_GLASS_REQUIRED)', async () => {
    const app = buildContentApp();
    const res = await app.request(`/trace-1/content?tenant=${T_A}`, {
      method: 'GET',
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('BREAK_GLASS_REQUIRED');
  });

  it('400s when no target tenant is specified', async () => {
    const app = buildContentApp();
    const res = await app.request('/trace-1/content', { method: 'GET' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BREAK_GLASS_TENANT_REQUIRED');
  });

  it('allows the read once the tenant consents, and records the access', async () => {
    const store = getOperatorAccessStore();
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'INC-7',
      scopes: ['decision_trace_content'],
    });
    await store.consent({ grantId: grant.id, tenantId: T_A, consentedBy: 'owner-a' });

    const app = buildContentApp();
    const res = await app.request(`/trace-1/content?tenant=${T_A}`, {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.secret).toBe('tenant-content');

    // The access is now in the hash-chained, tenant-visible log.
    const log = await store.listAccessLogForTenant(T_A);
    expect(log.length).toBe(1);
    expect(log[0]?.scope).toBe('decision_trace_content');
    const verified = await store.verifyTenantChain(T_A);
    expect(verified.ok).toBe(true);
  });

  it('a grant for tenant A does NOT unlock a different tenant', async () => {
    const store = getOperatorAccessStore();
    const grant = await store.requestGrant({
      tenantId: T_A,
      operatorId: OP,
      justificationCode: 'incident_response',
      reason: 'INC-8',
      scopes: ['decision_trace_content'],
    });
    await store.consent({ grantId: grant.id, tenantId: T_A, consentedBy: 'owner-a' });

    const app = buildContentApp();
    const res = await app.request('/trace-1/content?tenant=tenant-OTHER', {
      method: 'GET',
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('BREAK_GLASS_REQUIRED');
  });

  it('refuses a NON-platform principal outright', async () => {
    const app = new Hono();
    app.use('*', withAuth(UserRole.TENANT_ADMIN));
    app.use('*', requireBreakGlass('decision_trace_content'));
    app.get('/:id/content', (c: any) => c.json({ success: true }, 200));

    const res = await app.request(`/x/content?tenant=${T_A}`, { method: 'GET' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
