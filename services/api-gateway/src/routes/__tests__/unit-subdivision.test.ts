/**
 * Unit Subdivision Router tests.
 *
 * Covers:
 *   1. Auth gate — anonymous callers get 401.
 *   2. GET happy path — returns honest-empty when units.parent_unit_id
 *      is not on the schema (current state); meta carries the parentId.
 *   3. POST — returns 501 NOT_IMPLEMENTED until the four-eye approval
 *      workflow + schema migration land.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import unitSubdivisionRouter from '../unit-subdivision.router';

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

function mount(): Hono {
  const app = new Hono();
  // Mounted at the same path the production index.ts uses.
  app.route('/units/:id/subdivision', unitSubdivisionRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

describe('unit-subdivision router', () => {
  it('rejects anonymous GET (401)', async () => {
    const res = await mount().request('/units/u-1/subdivision');
    expect(res.status).toBe(401);
  });

  it('GET returns honest-empty with parentId in meta when schema not wired', async () => {
    const res = await mount().request('/units/u-42/subdivision', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta.parentId).toBe('u-42');
    expect(body.meta.note).toMatch(/unit-subdivision schema not yet wired/);
  });

  it('POST returns 501 NOT_IMPLEMENTED with the documented message', async () => {
    const res = await mount().request('/units/u-1/subdivision', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
    expect(body.error.message).toMatch(/four-eye|sign-off|schema/i);
  });
});
