/**
 * Unit Components Router tests.
 *
 * Covers:
 *   1. Auth gate — anonymous callers get 401.
 *   2. GET happy path — returns the asset_components rows scoped to the
 *      caller's unitId + tenantId, with meta.unitId echoed back.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import unitComponentsRouter from '../unit-components.router';

const TEST_TENANT = 'tenant-1';
const TEST_USER = 'user-mgr-1';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: TEST_TENANT,
    role: UserRole.PROPERTY_MANAGER,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function makeFakeDb(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  };
}

function mount(services: unknown): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/units/:id/components', unitComponentsRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

describe('unit-components router', () => {
  it('rejects anonymous GET (401)', async () => {
    const res = await mount({}).request('/units/u-1/components');
    expect(res.status).toBe(401);
  });

  it('GET returns the wrapped asset_components rows with meta.unitId', async () => {
    const db = makeFakeDb([
      { id: 'ac-1', tenantId: TEST_TENANT, unitId: 'u-7', name: 'Boiler' },
      { id: 'ac-2', tenantId: TEST_TENANT, unitId: 'u-7', name: 'AC unit' },
    ]);
    const res = await mount({ db }).request('/units/u-7/components', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.unitId).toBe('u-7');
    expect(body.meta.count).toBe(2);
  });
});
