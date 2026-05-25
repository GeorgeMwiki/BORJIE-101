/**
 * Cases router regression tests.
 *
 * Pin the shape the gateway now exposes for the tenant/maintenance case
 * lifecycle. The router used to return 503 LIVE_DATA_NOT_IMPLEMENTED for
 * every verb even though the `cases` table has been live since migration
 * 0001c — that stub silently blocked the AI triage → work-order →
 * resolve end-to-end flow. These tests exercise the router without a
 * live Postgres by pre-injecting a stub `db.execute` onto the request
 * context and asserting on the router's response shape.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { casesRouter } from '../routes/cases.hono';
import { getJwtSecret } from '../config/jwt';

// Per-test state — each run instantiates its own app + db so tests are
// independent.
interface DbCall {
  kind: 'select-list' | 'select-count' | 'select-by-id' | 'insert' | 'update';
}

function makeDbStub() {
  const calls: DbCall[] = [];
  const upsertRow = {
    id: 'case-abc',
    tenant_id: 'tn_case_test',
    case_number: 'CASE-260420-0001',
    title: 'Leaking kitchen tap',
    description: 'Dripping since last night',
    case_type: 'maintenance_dispute',
    severity: 'high',
    status: 'open',
    property_id: null,
    unit_id: null,
    customer_id: null,
    lease_id: null,
    amount_in_dispute: null,
    currency: null,
    tags: [],
    assigned_to: null,
    resolved_at: null,
    closed_at: null,
    created_at: '2026-04-20T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
  };
  let resolvedRow: typeof upsertRow = { ...upsertRow };
  const db = {
    execute: async (query: unknown) => {
      // Inspect the serialized sql to tell each query apart. Drizzle's
      // `sql\`...\`` exposes `.queryChunks` as an array of alternating
      // string fragments and `.param` wrappers. Joining the raw strings
      // is enough to pattern-match; we don't need to extract parameters
      // for these assertions.
      // Drizzle's SQL tagged template stores its raw string fragments on
      // `queryChunks` as `StringChunk` instances exposing a `.value` string
      // array (not plain strings) interleaved with parameter placeholders.
      // We walk the whole shape recursively and flatten every string we
      // can see into `raw` so the pattern match below is resilient to
      // drizzle's internal chunk representation.
      const chunks =
        (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const flatten = (node: unknown, out: string[]): void => {
        if (node == null) return;
        if (typeof node === 'string') {
          out.push(node);
          return;
        }
        if (Array.isArray(node)) {
          for (const n of node) flatten(n, out);
          return;
        }
        if (typeof node === 'object') {
          const n = node as Record<string, unknown>;
          if ('value' in n) flatten(n.value, out);
          if ('queryChunks' in n) flatten(n.queryChunks, out);
        }
      };
      const parts: string[] = [];
      flatten(chunks, parts);
      const raw = parts.join(' ').toLowerCase();

      if (raw.includes('insert into cases')) {
        calls.push({ kind: 'insert' });
        return [] as unknown;
      }
      if (raw.includes('update cases')) {
        calls.push({ kind: 'update' });
        resolvedRow = {
          ...upsertRow,
          status: 'resolved',
          resolved_at: '2026-04-20T01:00:00Z',
        };
        return [resolvedRow] as unknown;
      }
      if (raw.includes('select count')) {
        calls.push({ kind: 'select-count' });
        return [{ total: 1 }] as unknown;
      }
      if (raw.includes('where id =')) {
        calls.push({ kind: 'select-by-id' });
        return [upsertRow] as unknown;
      }
      calls.push({ kind: 'select-list' });
      return [upsertRow] as unknown;
    },
  };
  return { db, calls };
}

function mintJwt(): string {
  return jwt.sign(
    {
      userId: 'usr_case_test',
      tenantId: 'tn_case_test',
      role: 'TENANT_ADMIN',
      permissions: ['*'],
      propertyAccess: ['*'],
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '2h' }
  );
}

function buildApp() {
  const app = new Hono();
  const { db, calls } = makeDbStub();
  // Pre-inject the stub — `databaseMiddleware` now honours an existing
  // `db` binding instead of overwriting it.
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as never);
    await next();
  });
  app.route('/cases', casesRouter);
  return { app, calls };
}

describe('cases router — live data (replacing the 503 stub)', () => {
  it('POST /cases inserts and returns the persisted row shape', async () => {
    const { app, calls } = buildApp();
    const res = await app.request('/cases', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Leaking kitchen tap',
        description: 'Dripping since last night',
        type: 'maintenance_dispute',
        severity: 'high',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; caseNumber: string; title: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('OPEN');
    expect(body.data.title).toBe('Leaking kitchen tap');
    expect(body.data.caseNumber).toBe('CASE-260420-0001');
    // Insert + one select for the returning row.
    expect(calls.map((c) => c.kind)).toContain('insert');
  });

  it('GET /cases returns the tenant-scoped list and total', async () => {
    const { app } = buildApp();
    const res = await app.request('/cases', {
      headers: { Authorization: `Bearer ${mintJwt()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ title: string }>;
      pagination: { totalItems: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.pagination.totalItems).toBe(1);
  });

  it('GET /cases/:id returns the single case', async () => {
    const { app } = buildApp();
    const res = await app.request('/cases/case-abc', {
      headers: { Authorization: `Bearer ${mintJwt()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string };
    };
    expect(body.data.id).toBe('case-abc');
  });

  it('POST /cases/:id/resolve flips the status to RESOLVED', async () => {
    const { app } = buildApp();
    const res = await app.request('/cases/case-abc/resolve', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resolution: 'Plumber replaced washer' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; resolvedAt: string };
    };
    expect(body.data.status).toBe('RESOLVED');
    expect(body.data.resolvedAt).toBeTruthy();
  });

  it('rejects requests without a valid JWT', async () => {
    const { app } = buildApp();
    const res = await app.request('/cases');
    expect(res.status).toBe(401);
  });
});
