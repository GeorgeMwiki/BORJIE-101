/**
 * /api/v1/mining/toolbox-talks — pre-shift safety briefing router smoke tests.
 *
 * Mirrors the tasks.test.ts harness. Pre-binds an in-memory stub Drizzle
 * client on the Hono context, then exercises each endpoint with valid JWTs.
 *
 * Assertions cover:
 *   1. 401 when no Authorization header is supplied.
 *   2. 400 when the create payload misses required topicSw.
 *   3. 400 when the create payload has malformed scheduledFor (not YYYY-MM-DD).
 *   4. 403 when a non-manager attempts to schedule.
 *   5. 201 happy-path schedule.
 *   6. 200 happy-path list with date=today filter.
 *   7. 200 happy-path acknowledge — appends caller userId to array.
 *   8. Acknowledge idempotency — second ack short-circuits with meta.idempotent
 *      and does NOT duplicate the userId.
 *   9. 404 when acknowledging a non-existent talk.
 *  10. Cross-tenant denial on list.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createMiningToolboxRouter } from '../toolbox.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

type Row = Record<string, unknown>;

interface StubDb {
  readonly store: Map<string, Row[]>;
  insert(table: any): any;
  select(): any;
  update(table: any): any;
  execute(query: any): Promise<{ rows: Row[] }>;
}

function tableName(table: any): string {
  for (const s of Object.getOwnPropertySymbols(table)) {
    if (s.toString().includes('Name')) {
      return (table as any)[s] as string;
    }
  }
  return '';
}

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

interface ExtractedClause {
  readonly colName: string;
  readonly operator: '=' | 'in';
  readonly values: ReadonlyArray<unknown>;
}

/**
 * Unwrap drizzle's `Param { value, encoder }` shape so the row-matcher
 * compares raw scalars. Real `PgUUID`/typed columns route values through
 * Param objects (not inline), so a strict `=== ` check against a Param
 * instance would always reject — re-introducing the cross-tenant row
 * leak this helper is here to close.
 */
function unwrapParam(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && 'value' in (v as object)) {
    const inner = (v as { value: unknown }).value;
    if (!Array.isArray(inner)) return inner;
  }
  return v;
}

function extractClauses(cond: any): ExtractedClause[] {
  if (!cond || typeof cond !== 'object') return [];
  const chunks = (cond as { queryChunks?: ReadonlyArray<unknown> }).queryChunks;
  if (!Array.isArray(chunks)) return [];

  const out: ExtractedClause[] = [];

  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'queryChunks' in (chunk as object)) {
      out.push(...extractClauses(chunk));
    }
  }

  for (let i = 0; i < chunks.length - 2; i++) {
    const a = chunks[i];
    const b = chunks[i + 1];
    const c = chunks[i + 2];
    const isColumn =
      a !== null
      && typeof a === 'object'
      && 'name' in (a as object)
      && !('value' in (a as object))
      && !('encoder' in (a as object));
    const colName = isColumn
      ? ((a as { name?: unknown }).name as string | undefined)
      : undefined;
    const sep =
      b && typeof b === 'object' && 'value' in (b as object) && Array.isArray((b as { value: unknown[] }).value)
        ? (b as { value: string[] }).value.join('')
        : '';
    if (colName && sep === ' = ') {
      out.push({ colName, operator: '=', values: [unwrapParam(c)] });
    }
  }

  for (let i = 0; i < chunks.length - 1; i++) {
    const a = chunks[i];
    const b = chunks[i + 1];
    const isColumn =
      a !== null
      && typeof a === 'object'
      && 'name' in (a as object)
      && !('value' in (a as object))
      && !('encoder' in (a as object));
    const colName = isColumn
      ? ((a as { name?: unknown }).name as string | undefined)
      : undefined;
    const sepText =
      b && typeof b === 'object' && 'value' in (b as object) && Array.isArray((b as { value: unknown[] }).value)
        ? (b as { value: string[] }).value.join('')
        : '';
    if (colName && sepText.trim().startsWith('IN')) {
      out.push({ colName, operator: 'in', values: [] });
    }
  }

  return out;
}

function rowMatches(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => rowMatches(row, c));

  // Legacy shape kept for back-compat with hand-rolled fakes.
  if (cond?.left && cond?.right !== undefined) {
    const col = cond.left as { name?: string };
    if (col?.name) {
      const candidate = row[col.name] ?? row[snakeToCamel(col.name)];
      return candidate === unwrapParam(cond.right);
    }
  }

  const clauses = extractClauses(cond);
  if (clauses.length === 0) {
    // Fail-closed: a silent pass-through here re-opens the cross-tenant
    // leak because callers depend on the WHERE filter being honoured.
    return false;
  }
  for (const clause of clauses) {
    if (clause.operator === 'in') continue;
    const candidate =
      row[clause.colName] ?? row[snakeToCamel(clause.colName)];
    if (candidate !== clause.values[0]) {
      return false;
    }
  }
  return true;
}

function createStubDb(): StubDb {
  const store = new Map<string, Row[]>();
  return {
    store,
    insert(table: any) {
      const name = tableName(table);
      if (!store.has(name)) store.set(name, []);
      return {
        values(rowOrRows: Row | Row[]) {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          const withDefaults = rows.map((r) => ({
            id: r.id ?? `stub-${Math.random().toString(36).slice(2, 10)}`,
            createdAt: r.createdAt ?? new Date(),
            ...r,
          }));
          store.get(name)!.push(...withDefaults);
          return {
            async returning() {
              return withDefaults;
            },
            then(resolve: any) {
              resolve(undefined);
            },
          };
        },
      };
    },
    select() {
      let activeTable = '';
      let filter: any = null;
      const builder: any = {
        from(table: any) {
          activeTable = tableName(table);
          return builder;
        },
        where(cond: any) {
          filter = cond;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: any, reject?: any) {
          try {
            const list = store.get(activeTable) ?? [];
            resolve(list.filter((r) => rowMatches(r, filter)));
          } catch (err) {
            reject?.(err);
          }
        },
      };
      return builder;
    },
    update(table: any) {
      const name = tableName(table);
      return {
        set(changes: Row) {
          return {
            where(cond: any) {
              return {
                async returning() {
                  const list = store.get(name) ?? [];
                  const matched = list.filter((r) => rowMatches(r, cond));
                  for (let i = 0; i < list.length; i++) {
                    const cur = list[i]!;
                    if (rowMatches(cur, cond)) {
                      list[i] = { ...cur, ...changes };
                    }
                  }
                  return matched.map((m) => ({ ...m, ...changes }));
                },
              };
            },
          };
        },
      };
    },
    async execute() {
      return { rows: [] };
    },
  };
}

function bearer(
  role: UserRole,
  overrides?: { tenantId?: string; userId?: string },
): string {
  return `Bearer ${generateToken({
    userId: overrides?.userId ?? 'usr-test',
    tenantId: overrides?.tenantId ?? 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(db: StubDb | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (db) {
      // @ts-expect-error — db slot is augmented by databaseMiddleware
      c.set('db', db);
    }
    await next();
  });
  app.route('/api/v1/mining/toolbox-talks', createMiningToolboxRouter());
  return app;
}

const SITE_UUID = '11111111-2222-3333-4444-555555555555';
const TALK_UUID = '99999999-aaaa-bbbb-cccc-dddddddddddd';
const TODAY = (() => {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
})();

// ---------------------------------------------------------------------------
// 1) auth gate
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/toolbox-talks — auth', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 when no bearer token is supplied', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/mining/toolbox-talks');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2 + 3) validation
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/toolbox-talks — validation', () => {
  it('returns 400 when topicSw is missing', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/mining/toolbox-talks', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ siteId: SITE_UUID, scheduledFor: TODAY }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when scheduledFor is malformed', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/mining/toolbox-talks', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId: SITE_UUID,
        topicSw: 'PPE refresher',
        scheduledFor: '27/05/2026',
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 4) role gate
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/toolbox-talks — role gate', () => {
  it('returns 403 when a non-manager tries to schedule', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/mining/toolbox-talks', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.RESIDENT),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId: SITE_UUID,
        topicSw: 'PPE',
        scheduledFor: TODAY,
      }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 5) create happy path
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/toolbox-talks — happy path', () => {
  it('returns 201 with the persisted talk when a manager schedules one', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/mining/toolbox-talks', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteId: SITE_UUID,
        topicSw: 'Vaa kofia salama wakati wote',
        topicEn: 'Wear hard hat at all times',
        scheduledFor: TODAY,
        briefingNotesSw: 'Tukio juzi: helmet imeokoa maisha.',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { topicSw: string; siteId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.topicSw).toBe('Vaa kofia salama wakati wote');
    expect(body.data.siteId).toBe(SITE_UUID);
    expect(db.store.get('mining_toolbox_talks')?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6) list happy path
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/toolbox-talks — list', () => {
  it('returns rows filtered by siteId + date=today', async () => {
    const db = createStubDb();
    db.store.set('mining_toolbox_talks', [
      {
        id: TALK_UUID,
        tenantId: 'tnt-test',
        siteId: SITE_UUID,
        topicSw: 'A',
        scheduledFor: TODAY,
        acknowledgedByUserIds: [],
      },
      {
        id: 'other',
        tenantId: 'tnt-test',
        siteId: 'someone-elses-site',
        topicSw: 'B',
        scheduledFor: TODAY,
        acknowledgedByUserIds: [],
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/toolbox-talks?siteId=${SITE_UUID}&date=today`,
      {
        headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.topicSw).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// 7) acknowledge happy path
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/toolbox-talks/:id/acknowledge — happy path', () => {
  it('appends the caller userId to the acknowledged_by_user_ids array', async () => {
    const db = createStubDb();
    db.store.set('mining_toolbox_talks', [
      {
        id: TALK_UUID,
        tenantId: 'tnt-test',
        siteId: SITE_UUID,
        topicSw: 'A',
        scheduledFor: TODAY,
        acknowledgedByUserIds: ['someone'],
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/toolbox-talks/${TALK_UUID}/acknowledge`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.RESIDENT, { userId: 'worker-7' }),
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { acknowledgedByUserIds: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.acknowledgedByUserIds).toEqual(['someone', 'worker-7']);
  });
});

// ---------------------------------------------------------------------------
// 8) acknowledge idempotency
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/toolbox-talks/:id/acknowledge — idempotency', () => {
  it('does not duplicate userId on second ack and returns meta.idempotent', async () => {
    const db = createStubDb();
    db.store.set('mining_toolbox_talks', [
      {
        id: TALK_UUID,
        tenantId: 'tnt-test',
        siteId: SITE_UUID,
        topicSw: 'A',
        scheduledFor: TODAY,
        acknowledgedByUserIds: ['worker-7'],
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/toolbox-talks/${TALK_UUID}/acknowledge`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.RESIDENT, { userId: 'worker-7' }),
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      meta?: { idempotent?: boolean };
      data: { acknowledgedByUserIds: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.meta?.idempotent).toBe(true);
    expect(body.data.acknowledgedByUserIds).toEqual(['worker-7']);
  });
});

// ---------------------------------------------------------------------------
// 9) acknowledge not found
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/toolbox-talks/:id/acknowledge — not found', () => {
  it('returns 404 when the talk does not exist', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/toolbox-talks/${TALK_UUID}/acknowledge`,
      {
        method: 'POST',
        headers: { Authorization: bearer(UserRole.RESIDENT) },
      },
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 10) cross-tenant denial
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/toolbox-talks — cross-tenant denial', () => {
  it('does not return rows that belong to another tenant', async () => {
    const db = createStubDb();
    db.store.set('mining_toolbox_talks', [
      {
        id: TALK_UUID,
        tenantId: 'tnt-other',
        siteId: SITE_UUID,
        topicSw: 'A',
        scheduledFor: TODAY,
        acknowledgedByUserIds: [],
      },
    ]);
    const app = mount(db);
    const res = await app.request('/api/v1/mining/toolbox-talks', {
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt-test' }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(0);
  });
});
