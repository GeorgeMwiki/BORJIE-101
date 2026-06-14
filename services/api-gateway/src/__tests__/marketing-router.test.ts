/**
 * Tests for the marketing-surface router — KI-013 closure.
 *
 * The @borjie/marketing site's /api/contact + /api/subscribe Next route
 * handlers forward server-to-server to the gateway endpoints
 *   POST /api/v1/marketing/contact
 *   POST /api/v1/marketing/subscribe
 * which previously did not exist (every submit 404'd). These tests pin the
 * three public lead-capture handlers (the original /pilot-application plus the
 * two new ones) through a `db.insert(...).values(...).returning()` stub:
 *   - 400 INVALID_JSON on a non-JSON body
 *   - 400 VALIDATION_FAILED on a payload that fails the zod schema
 *   - 201 + persisted:true on the happy path, with the exact insert values
 *   - 201 + persisted:false graceful-degrade when no DB binding is present
 *     (a persistence failure must never block the lead)
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { marketingRouter } from '../routes/marketing.hono';

interface CapturedInsert {
  table: unknown;
  values: Record<string, unknown>;
}

/**
 * Minimal drizzle `db.insert(t).values(v).returning()` stub. Records every
 * insert so the test can assert the exact persisted shape. `shouldThrow`
 * exercises the graceful-degrade catch (e.g. a unique-index conflict).
 */
function buildDb(shouldThrow = false): {
  db: { insert: (t: unknown) => unknown };
  captured: CapturedInsert[];
} {
  const captured: CapturedInsert[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          if (shouldThrow) {
            throw new Error('duplicate key value violates unique constraint');
          }
          captured.push({ table, values });
          return [values];
        },
      }),
    }),
  };
  return { db, captured };
}

function mount(db: { insert: (t: unknown) => unknown } | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db' as never, db as never);
    await next();
  });
  app.route('/marketing', marketingRouter);
  return app;
}

function postJson(
  app: Hono,
  path: string,
  body: unknown,
): Promise<Response> {
  return app.request(`/marketing${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /marketing/contact', () => {
  const valid = {
    name: 'Asha Mwita',
    email: 'asha@example.com',
    org: 'Kahama Cooperative',
    kind: 'partnership',
    message: 'We would like to discuss an off-take arrangement.',
  };

  it('rejects a non-JSON body with 400 INVALID_JSON', async () => {
    const { db } = buildDb();
    const res = await mount(db).request('/marketing/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('rejects an invalid payload with 400 VALIDATION_FAILED', async () => {
    const { db } = buildDb();
    const res = await postJson(mount(db), '/contact', {
      name: 'x', // too short
      email: 'not-an-email',
      message: '',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('persists a valid contact submission and returns 201 persisted:true', async () => {
    const { db, captured } = buildDb();
    const res = await postJson(mount(db), '/contact', valid);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { received: boolean; id: string; persisted: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.persisted).toBe(true);
    expect(body.data.id).toMatch(/^mc_/);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.values).toMatchObject({
      name: valid.name,
      email: valid.email,
      org: valid.org,
      kind: valid.kind,
      message: valid.message,
    });
  });

  it('defaults org/kind when omitted (matches the FE optional defaults)', async () => {
    const { db, captured } = buildDb();
    const res = await postJson(mount(db), '/contact', {
      name: 'Juma Bakari',
      email: 'juma@example.com',
      message: 'General enquiry about pilots.',
    });
    expect(res.status).toBe(201);
    expect(captured[0]?.values).toMatchObject({ org: '', kind: 'general' });
  });

  it('graceful-degrades to persisted:false when no DB binding is present', async () => {
    const res = await postJson(mount(null), '/contact', valid);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { persisted: boolean } };
    expect(body.data.persisted).toBe(false);
  });

  it('graceful-degrades to persisted:false when the insert throws', async () => {
    const { db } = buildDb(true);
    const res = await postJson(mount(db), '/contact', valid);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { persisted: boolean } };
    expect(body.data.persisted).toBe(false);
  });
});

describe('POST /marketing/subscribe', () => {
  it('rejects an invalid email with 400 VALIDATION_FAILED', async () => {
    const { db } = buildDb();
    const res = await postJson(mount(db), '/subscribe', { email: 'nope' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('persists a valid subscription and returns 201 persisted:true', async () => {
    const { db, captured } = buildDb();
    const res = await postJson(mount(db), '/subscribe', {
      email: 'reader@example.com',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; persisted: boolean };
    };
    expect(body.data.persisted).toBe(true);
    expect(body.data.id).toMatch(/^ms_/);
    expect(captured[0]?.values).toMatchObject({ email: 'reader@example.com' });
  });

  it('graceful-degrades to persisted:false on a duplicate-email conflict', async () => {
    const { db } = buildDb(true);
    const res = await postJson(mount(db), '/subscribe', {
      email: 'reader@example.com',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { persisted: boolean } };
    expect(body.data.persisted).toBe(false);
  });

  it('graceful-degrades to persisted:false when no DB binding is present', async () => {
    const res = await postJson(mount(null), '/subscribe', {
      email: 'reader@example.com',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { persisted: boolean } };
    expect(body.data.persisted).toBe(false);
  });
});

describe('POST /marketing/pilot-application (regression — unchanged)', () => {
  it('still persists a valid pilot application', async () => {
    const { db, captured } = buildDb();
    const res = await postJson(mount(db), '/pilot-application', {
      name: 'Neema Said',
      company: 'Geita Gold Co',
      email: 'neema@example.com',
      phone: '+255700000000',
      portfolioSize: 4,
      mineralFocus: 'gold',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; persisted: boolean };
    };
    expect(body.data.persisted).toBe(true);
    expect(body.data.id).toMatch(/^pa_/);
    expect(captured[0]?.values).toMatchObject({ company: 'Geita Gold Co' });
  });
});
