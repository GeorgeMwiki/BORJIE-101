/**
 * Capability-gate regression — Wave 26 Agent Z5.
 *
 * Verifies that `requireCapability` delegates to the shared RbacEngine
 * from `@borjie/authz-policy` and correctly denies when the caller's
 * role does not map to a policy role that grants the requested
 * action/resource pair.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireCapability, hasCapability } from '../capability-gate';
import { UserRole } from '../../types/user-role';

function withAuth(role: UserRole) {
  return async (c: any, next: any) => {
    c.set('auth', {
      userId: 'u1',
      tenantId: 't1',
      role,
      permissions: [],
      propertyAccess: ['*'],
    });
    await next();
  };
}

describe('requireCapability — RBAC engine delegation', () => {
  it('allows TENANT_ADMIN to create a lease (maps to property-owner → manage lease)', async () => {
    const app = new Hono();
    app.use('*', withAuth(UserRole.TENANT_ADMIN));
    app.post('/', requireCapability('create', 'lease'), (c) => c.json({ ok: true }));

    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('denies RESIDENT from creating a property (tenant role lacks property:create)', async () => {
    const app = new Hono();
    app.use('*', withAuth(UserRole.RESIDENT));
    app.post('/', requireCapability('create', 'property'), (c) => c.json({ ok: true }));

    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401 when no auth context is present', async () => {
    const app = new Hono();
    app.post('/', requireCapability('create', 'invoice'), (c) => c.json({ ok: true }));

    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('hasCapability — programmatic check', () => {
  it('returns true for PROPERTY_MANAGER creating an invoice', () => {
    const allowed = hasCapability(
      { userId: 'u1', tenantId: 't1', role: UserRole.PROPERTY_MANAGER, propertyAccess: ['*'] },
      'create',
      'invoice'
    );
    expect(allowed).toBe(true);
  });

  it('returns false for MAINTENANCE_STAFF creating a lease (caretaker cannot manage leases)', () => {
    const allowed = hasCapability(
      { userId: 'u1', tenantId: 't1', role: UserRole.MAINTENANCE_STAFF, propertyAccess: ['*'] },
      'create',
      'lease'
    );
    expect(allowed).toBe(false);
  });
});
