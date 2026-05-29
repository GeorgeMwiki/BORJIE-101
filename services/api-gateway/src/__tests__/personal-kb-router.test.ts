/**
 * Tests for the personal-KB endpoints (Roadmap R8).
 *
 * Drives the router against a db.execute stub so each branch
 * (no-link, consent-required, happy path, forbidden-person) is
 * exercised deterministically.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../middleware/auth';
import { UserRole } from '../types/user-role';
import { personalKbRouter } from '../routes/personal-kb.hono';

const TEST_USER = 'a0000000-0000-0000-0000-000000000001';
const TEST_TENANT = 'b0000000-0000-0000-0000-000000000002';
const TEST_PERSON = 'c0000000-0000-0000-0000-000000000003';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: TEST_TENANT,
    role: UserRole.ADMIN as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

interface DbPlan {
  readonly links?: Array<Record<string, unknown>>;
  readonly personLookup?: Array<Record<string, unknown>>;
  readonly consent?: Array<Record<string, unknown>>;
  readonly cells?: Array<Record<string, unknown>>;
}

function buildDb(plan: DbPlan): {
  execute: (q: unknown) => Promise<unknown>;
} {
  return {
    execute: async (q: unknown) => {
      const sqlText =
        typeof q === 'object' && q !== null && 'queryChunks' in q
          ? JSON.stringify((q as { queryChunks: unknown }).queryChunks)
          : JSON.stringify(q);
      // The /links query joins person_links + persons.
      if (
        sqlText.includes('person_links') &&
        sqlText.includes('display_name')
      ) {
        return plan.links ?? [];
      }
      // The resolvePersonId helper queries person_links alone.
      if (
        sqlText.includes('person_links') &&
        sqlText.includes('SELECT person_id')
      ) {
        return plan.personLookup ?? [];
      }
      // The resolveConsent helper queries persons.
      if (sqlText.includes('consent_unified_kb_at')) {
        return plan.consent ?? [];
      }
      // The personal_memory_cells query for cells / search.
      if (sqlText.includes('personal_memory_cells')) {
        return plan.cells ?? [];
      }
      return [];
    },
  };
}

function attach(db: { execute: (q: unknown) => Promise<unknown> } | null) {
  return async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', db);
    await next();
  };
}

function mount(db: { execute: (q: unknown) => Promise<unknown> } | null) {
  const app = new Hono();
  app.use('*', attach(db));
  app.route('/', personalKbRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

describe('GET /me/persons/links', () => {
  it('rejects without token', async () => {
    const app = mount(null);
    const res = await app.request('/me/persons/links');
    expect(res.status).toBe(401);
  });

  it('returns 503 when db unavailable', async () => {
    const app = mount(null);
    const res = await app.request('/me/persons/links', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
  });

  it('returns empty list when caller has no links', async () => {
    const db = buildDb({ links: [] });
    const app = mount(db);
    const res = await app.request('/me/persons/links', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('hydrates links + consentGranted flag', async () => {
    const db = buildDb({
      links: [
        {
          id: 'link_1',
          person_id: TEST_PERSON,
          tenant_id: TEST_TENANT,
          role_in_tenant: 'owner',
          linked_at: '2026-01-01T00:00:00.000Z',
          unlinked_at: null,
          display_name: 'Asha Mwakasege',
          preferred_language: 'sw',
          consent_unified_kb_at: '2026-02-01T00:00:00.000Z',
          consent_unified_kb_revoked_at: null,
        },
      ],
    });
    const app = mount(db);
    const res = await app.request('/me/persons/links', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ displayName: string; consentGranted: boolean }>;
    };
    expect(body.data[0].displayName).toBe('Asha Mwakasege');
    expect(body.data[0].consentGranted).toBe(true);
  });
});

describe('GET /me/persons/:personId/cells', () => {
  it('rejects without token', async () => {
    const app = mount(null);
    const res = await app.request(`/me/persons/${TEST_PERSON}/cells`);
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN_PERSON when person id mismatches caller', async () => {
    const db = buildDb({
      personLookup: [{ person_id: 'd0000000-0000-0000-0000-000000000099' }],
    });
    const app = mount(db);
    const res = await app.request(`/me/persons/${TEST_PERSON}/cells`, {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN_PERSON');
  });

  it('returns 403 CONSENT_REQUIRED when consent not granted', async () => {
    const db = buildDb({
      personLookup: [{ person_id: TEST_PERSON }],
      consent: [
        {
          consent_unified_kb_at: null,
          consent_unified_kb_revoked_at: null,
        },
      ],
    });
    const app = mount(db);
    const res = await app.request(`/me/persons/${TEST_PERSON}/cells`, {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('returns cells on the happy path', async () => {
    const db = buildDb({
      personLookup: [{ person_id: TEST_PERSON }],
      consent: [
        {
          consent_unified_kb_at: '2026-02-01T00:00:00.000Z',
          consent_unified_kb_revoked_at: null,
        },
      ],
      cells: [
        {
          id: 'cell_1',
          person_id: TEST_PERSON,
          cell_kind: 'preference',
          key: 'preferred_name',
          value: 'Asha',
          confidence: '1.00',
          source_tenant_id: TEST_TENANT,
          captured_at: '2026-05-01T00:00:00.000Z',
        },
      ],
    });
    const app = mount(db);
    const res = await app.request(`/me/persons/${TEST_PERSON}/cells`, {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ key: string; cellKind: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].key).toBe('preferred_name');
    expect(body.data[0].cellKind).toBe('preference');
  });
});

describe('GET /brain/personal-kb/search', () => {
  it('rejects without token', async () => {
    const app = mount(null);
    const res = await app.request('/brain/personal-kb/search?q=foo');
    expect(res.status).toBe(401);
  });

  it('rejects empty q via zod (400)', async () => {
    const db = buildDb({ personLookup: [{ person_id: TEST_PERSON }] });
    const app = mount(db);
    const res = await app.request('/brain/personal-kb/search?q=', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(400);
  });

  it('returns empty data when caller has no person', async () => {
    const db = buildDb({ personLookup: [] });
    const app = mount(db);
    const res = await app.request('/brain/personal-kb/search?q=asha', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns matched cells on the happy path', async () => {
    const db = buildDb({
      personLookup: [{ person_id: TEST_PERSON }],
      consent: [
        {
          consent_unified_kb_at: '2026-02-01T00:00:00.000Z',
          consent_unified_kb_revoked_at: null,
        },
      ],
      cells: [
        {
          id: 'cell_search_1',
          person_id: TEST_PERSON,
          cell_kind: 'recurring-fact',
          key: 'mother_passing',
          value: 'Mother passed away August 2024',
          confidence: '1.00',
          source_tenant_id: null,
          captured_at: '2026-04-01T00:00:00.000Z',
        },
      ],
    });
    const app = mount(db);
    const res = await app.request(
      '/brain/personal-kb/search?q=mother&limit=5',
      { headers: { Authorization: bearer() } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; cellKind: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('cell_search_1');
  });
});
