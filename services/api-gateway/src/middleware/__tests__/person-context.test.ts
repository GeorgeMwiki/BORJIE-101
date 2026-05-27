/**
 * person-context middleware — unit tests.
 *
 * Coverage (R8 spec):
 *   - personId + GUC bound when consent is present and link exists
 *   - middleware is silent (no personId set) when consent revoked
 *   - middleware is silent when no person_link exists
 *   - middleware skips entirely when auth/tenant missing
 *   - middleware skips entirely in mock-mode (no `db` on ctx)
 *   - resolvePersonContext returns null on DB error (graceful)
 *   - resolvePersonContext returns null when query yields zero rows
 *
 * Tests use a recording stub for the Drizzle client that captures
 * `execute(sql)` calls and returns canned row sets — same idiom as
 * `database-rls-guc.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  personContextMiddleware,
  resolvePersonContext,
} from '../person-context';

// ────────────────────────────────────────────────────────────────────
// Recording stub — captures SELECT (resolvePerson) + SET (bindGuc).
// ────────────────────────────────────────────────────────────────────

interface RecordedCall {
  readonly sqlText: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakeRow {
  readonly person_id: string;
  readonly preferred_language: string;
  readonly consent_unified_kb_at: Date | null;
  readonly consent_unified_kb_revoked_at: Date | null;
}

function flattenSql(input: unknown): RecordedCall {
  // Same walker as database-rls-guc.test.ts — drizzle's SQL object
  // exposes queryChunks (StringChunk + Param). We flatten to a text
  // form + ordered params for assertion-friendly recording.
  const obj = input as {
    queryChunks?: ReadonlyArray<{
      value?: unknown;
      queryChunks?: ReadonlyArray<unknown>;
    }>;
  };
  if (!Array.isArray(obj?.queryChunks)) {
    return { sqlText: String(input), params: [] };
  }
  const stringParts: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: ReadonlyArray<unknown>): void => {
    for (const chunk of chunks) {
      if (
        chunk === null ||
        typeof chunk === 'string' ||
        typeof chunk === 'number' ||
        typeof chunk === 'boolean'
      ) {
        params.push(chunk);
        stringParts.push(`$${params.length}`);
        continue;
      }
      if (typeof chunk !== 'object') continue;
      const c = chunk as { value?: unknown; queryChunks?: ReadonlyArray<unknown> };
      if (Array.isArray(c.queryChunks)) {
        walk(c.queryChunks);
        continue;
      }
      const v = c.value;
      if (Array.isArray(v)) stringParts.push((v as string[]).join(''));
      else if (v !== undefined && v !== null) {
        params.push(v);
        stringParts.push(`$${params.length}`);
      }
    }
  };
  walk(obj.queryChunks);
  return { sqlText: stringParts.join(''), params };
}

interface RecordingDb {
  execute(sql: unknown): Promise<unknown>;
  readonly calls: ReadonlyArray<RecordedCall>;
}

function makeRecordingDb(opts: {
  selectRows?: ReadonlyArray<FakeRow>;
  failSelect?: boolean;
  failGuc?: boolean;
}): RecordingDb {
  const calls: RecordedCall[] = [];
  return {
    async execute(sql: unknown) {
      const recorded = flattenSql(sql);
      calls.push(recorded);
      const lower = recorded.sqlText.toLowerCase();
      if (lower.includes('from person_links')) {
        if (opts.failSelect) throw new Error('relation does not exist');
        return { rows: opts.selectRows ?? [] };
      }
      if (lower.includes('set_config')) {
        if (opts.failGuc) throw new Error('postgres unavailable');
        return { rows: [] };
      }
      return { rows: [] };
    },
    get calls() {
      return calls;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// App builder
// ────────────────────────────────────────────────────────────────────

interface BuildAppArgs {
  readonly auth?: { userId: string; tenantId: string } | null;
  readonly tenant?: { id: string } | null;
  readonly db?: RecordingDb | null;
}

function buildApp(args: BuildAppArgs): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (args.auth) c.set('auth' as never, args.auth as never);
    if (args.tenant) c.set('tenant' as never, args.tenant as never);
    if (args.db !== undefined) c.set('db' as never, args.db as never);
    await next();
  });
  app.use('*', personContextMiddleware);
  app.get('/probe', (c) => {
    const personId = c.get('personId') as string | undefined;
    return c.json({ personId: personId ?? null });
  });
  return app;
}

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

const TENANT = '00000000-0000-0000-0000-00000000aaaa';
const USER = '00000000-0000-0000-0000-00000000bbbb';
const PERSON = '00000000-0000-0000-0000-00000000cccc';

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('personContextMiddleware — sets personId when consent present', () => {
  it('sets c.get("personId") + binds the GUC when link + consent exist', async () => {
    const db = makeRecordingDb({
      selectRows: [
        {
          person_id: PERSON,
          preferred_language: 'sw',
          consent_unified_kb_at: new Date('2026-01-01T00:00:00Z'),
          consent_unified_kb_revoked_at: null,
        },
      ],
    });
    const app = buildApp({
      auth: { userId: USER, tenantId: TENANT },
      tenant: { id: TENANT },
      db,
    });
    const res = await app.request('/probe');
    const body = (await res.json()) as { personId: string | null };
    expect(body.personId).toBe(PERSON);
    expect(res.headers.get('X-Person-Layer')).toBe('on');

    // GUC was bound — there should be a `set_config` execute call.
    const gucCalls = db.calls.filter((c) =>
      c.sqlText.toLowerCase().includes('set_config'),
    );
    expect(gucCalls.length).toBe(1);
    expect(gucCalls[0]!.sqlText).toContain('app.current_person_id');
    expect(gucCalls[0]!.params).toContain(PERSON);
  });
});

describe('personContextMiddleware — silent skip paths', () => {
  it('does NOT set personId when consent is revoked (query returns zero rows)', async () => {
    // The SQL filter `consent_unified_kb_revoked_at IS NULL` means a
    // revoked row never comes back. We simulate that with an empty
    // result set.
    const db = makeRecordingDb({ selectRows: [] });
    const app = buildApp({
      auth: { userId: USER, tenantId: TENANT },
      tenant: { id: TENANT },
      db,
    });
    const res = await app.request('/probe');
    const body = (await res.json()) as { personId: string | null };
    expect(body.personId).toBeNull();
    expect(res.headers.get('X-Person-Layer')).toBeNull();
  });

  it('does NOT set personId when no person_link row exists', async () => {
    const db = makeRecordingDb({ selectRows: [] });
    const app = buildApp({
      auth: { userId: USER, tenantId: TENANT },
      tenant: { id: TENANT },
      db,
    });
    const res = await app.request('/probe');
    const body = (await res.json()) as { personId: string | null };
    expect(body.personId).toBeNull();
  });

  it('skips entirely when auth is missing', async () => {
    const db = makeRecordingDb({});
    const app = buildApp({
      auth: null,
      tenant: { id: TENANT },
      db,
    });
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    expect(db.calls.length).toBe(0);
  });

  it('skips entirely when tenant is missing', async () => {
    const db = makeRecordingDb({});
    const app = buildApp({
      auth: { userId: USER, tenantId: TENANT },
      tenant: null,
      db,
    });
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    expect(db.calls.length).toBe(0);
  });

  it('skips entirely in mock-mode (no db on ctx)', async () => {
    const app = buildApp({
      auth: { userId: USER, tenantId: TENANT },
      tenant: { id: TENANT },
      db: null,
    });
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { personId: string | null };
    expect(body.personId).toBeNull();
  });

  it('does NOT set personId when the GUC bind fails (fail-open-without-enablement)', async () => {
    const db = makeRecordingDb({
      selectRows: [
        {
          person_id: PERSON,
          preferred_language: 'sw',
          consent_unified_kb_at: new Date('2026-01-01T00:00:00Z'),
          consent_unified_kb_revoked_at: null,
        },
      ],
      failGuc: true,
    });
    const app = buildApp({
      auth: { userId: USER, tenantId: TENANT },
      tenant: { id: TENANT },
      db,
    });
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { personId: string | null };
    expect(body.personId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// resolvePersonContext direct unit
// ────────────────────────────────────────────────────────────────────

describe('resolvePersonContext — direct unit', () => {
  it('returns null when the SELECT throws (table missing pre-0088)', async () => {
    const db = makeRecordingDb({ failSelect: true });
    const result = await resolvePersonContext({
      db,
      supabaseUserId: USER,
      tenantId: TENANT,
    });
    expect(result).toBeNull();
  });

  it('returns null on empty result set', async () => {
    const db = makeRecordingDb({ selectRows: [] });
    const result = await resolvePersonContext({
      db,
      supabaseUserId: USER,
      tenantId: TENANT,
    });
    expect(result).toBeNull();
  });

  it('returns a structured PersonContext on a matching row', async () => {
    const db = makeRecordingDb({
      selectRows: [
        {
          person_id: PERSON,
          preferred_language: 'sw',
          consent_unified_kb_at: new Date('2026-01-01T00:00:00Z'),
          consent_unified_kb_revoked_at: null,
        },
      ],
    });
    const result = await resolvePersonContext({
      db,
      supabaseUserId: USER,
      tenantId: TENANT,
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(PERSON);
    expect(result?.preferredLanguage).toBe('sw');
    expect(result?.consentUnifiedKbRevokedAt).toBeNull();
  });
});
