/**
 * PUT /api/v1/inspections/:id/complete handler tests.
 *
 * Covers:
 *   1. Auth gate — anonymous callers get 401.
 *   2. Validation — malformed body returns 400 (zod).
 *   3. 404 — inspection row missing in this tenant.
 *   4. 409 — inspection already completed (returns existing record).
 *   5. Happy path — updates row to status='completed', returns the
 *      expected envelope shape, persists `summary` (overallNotes)
 *      and `notes` (areaResults JSON blob).
 *
 * The router is mounted with an outer middleware that pre-sets
 * `services` (with a fake drizzle-shaped db) + `auth` so we don't
 * need a real Postgres. We bypass `authMiddleware` for happy-path
 * tests by injecting auth context BEFORE the router runs… except
 * the router itself runs `authMiddleware` per-request, which checks
 * the Authorization header. So happy-path tests pass a real signed
 * JWT and rely on the in-process service-context middleware shim.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import { inspectionsRouter } from '../inspections';

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

interface FakeRow {
  id: string;
  tenantId: string;
  status: string;
  completedDate?: string | null;
  summary?: string | null;
  notes?: string | null;
}

/**
 * Tiny drizzle-shaped DB fake. Supports the read/write chain the
 * /:id/complete handler walks: select().from().where().limit() and
 * update().set().where().returning().
 */
function makeFakeDb(seedRow: FakeRow | null) {
  let row: FakeRow | null = seedRow ? { ...seedRow } : null;
  const updateCalls: Array<Record<string, unknown>> = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: (changes: Record<string, unknown>) => {
        updateCalls.push(changes);
        return {
          where: () => ({
            returning: async () => {
              if (!row) return [];
              row = {
                ...row,
                ...changes,
                // Substitute SQL NOW() for an ISO timestamp so the
                // handler can stringify it.
                completedDate: new Date().toISOString(),
              };
              return [row];
            },
          }),
        };
      },
    }),
  };
  return { db, getRow: () => row, updateCalls };
}

function mountWithDb(db: unknown): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', { db });
    await next();
  });
  app.route('/inspections', inspectionsRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

describe('PUT /inspections/:id/complete', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithDb({});
    const res = await app.request('/inspections/insp-1/complete', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        areaResults: [{ area: 'kitchen', rating: 'pass' }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects malformed body via zod (400)', async () => {
    const { db } = makeFakeDb({
      id: 'insp-1',
      tenantId: TEST_TENANT,
      status: 'scheduled',
    });
    const app = mountWithDb(db);
    const res = await app.request('/inspections/insp-1/complete', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      // areaResults missing entirely; rating is also a known-bad enum.
      body: JSON.stringify({ overallNotes: 'all good' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the inspection row is not found in this tenant', async () => {
    const { db } = makeFakeDb(null);
    const app = mountWithDb(db);
    const res = await app.request('/inspections/missing/complete', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        areaResults: [{ area: 'kitchen', rating: 'pass' }],
      }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 when the inspection is already completed', async () => {
    const { db } = makeFakeDb({
      id: 'insp-2',
      tenantId: TEST_TENANT,
      status: 'completed',
      completedDate: '2026-04-01T00:00:00.000Z',
    });
    const app = mountWithDb(db);
    const res = await app.request('/inspections/insp-2/complete', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        areaResults: [{ area: 'bath', rating: 'pass' }],
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('ALREADY_COMPLETED');
    expect(body.data.existing.id).toBe('insp-2');
  });

  it('happy path: updates the row, returns the expected envelope', async () => {
    const { db, getRow, updateCalls } = makeFakeDb({
      id: 'insp-3',
      tenantId: TEST_TENANT,
      status: 'scheduled',
    });
    const app = mountWithDb(db);
    const res = await app.request('/inspections/insp-3/complete', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        areaResults: [
          { area: 'kitchen', rating: 'pass' },
          {
            area: 'bathroom',
            rating: 'fix-needed',
            notes: 'cracked tile',
            photoUrls: ['https://example.com/p1.jpg'],
          },
        ],
        overallNotes: 'Mostly good, one fix.',
        photoCount: 4,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('insp-3');
    expect(body.data.status).toBe('completed');
    expect(typeof body.data.completedAt).toBe('string');

    // The row was updated to status=completed.
    const finalRow = getRow();
    expect(finalRow?.status).toBe('completed');
    expect(finalRow?.summary).toBe('Mostly good, one fix.');
    // areaResults are persisted via the notes column as JSON until
    // the dedicated area_results jsonb column lands.
    const persistedNotes = finalRow?.notes as string;
    const parsed = JSON.parse(persistedNotes);
    expect(parsed.areaResults).toHaveLength(2);
    expect(parsed.photoCount).toBe(4);

    // The update call set status + completedDate (server-generated)
    // even though the test fake substitutes ISO for the SQL NOW() token.
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].status).toBe('completed');
  });

  it('returns 503 when DATABASE is unavailable', async () => {
    // Mount with a missing services object — services.db will be undefined.
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('services', {});
      await next();
    });
    app.route('/inspections', inspectionsRouter);

    const res = await app.request('/inspections/insp-9/complete', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        areaResults: [{ area: 'kitchen', rating: 'pass' }],
      }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE');
  });
});
