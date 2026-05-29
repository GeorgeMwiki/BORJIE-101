/**
 * /api/v1/field/workforce — R5 closure smoke tests.
 *
 * Backing route: services/api-gateway/src/routes/field/workforce.hono.ts
 *
 * Covers:
 *   1. 401 when no Authorization header is supplied (every endpoint).
 *   2. 400 when the help-request body is malformed.
 *   3. 200 + tenant binding for /me when db returns rows.
 *   4. 200 + null body for /tasks/next when no task assigned.
 *   5. 200 happy path for /tasks/next when a pending task exists.
 *   6. 200 + audit-chain insert for /tasks/:id/complete.
 *   7. 403 when /tasks/:id/complete fires on a task assigned to someone else.
 *   8. 201 + audit-chain insert for /help-requests.
 *   9. Idempotency: re-complete returns idempotent:true.
 *
 * Test harness mirrors mining/__tests__/tasks.test.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createFieldWorkforceRouter } from '../workforce.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

// ---------------------------------------------------------------------------
// In-memory fake Drizzle client + ai_audit_chain capture
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface StubDb {
  readonly store: Map<string, Row[]>;
  readonly auditRows: Row[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert(table: any): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select(...args: any[]): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(table: any): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(query: any): Promise<{ rows: Row[] }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableName(table: any): string {
  for (const s of Object.getOwnPropertySymbols(table)) {
    if (s.toString().includes('Name')) {
      return (table as Record<symbol, string>)[s];
    }
  }
  return '';
}

function snakeToCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowMatches(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => rowMatches(row, c));
  if (cond?.queries && Array.isArray(cond.queries)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return cond.queries.every((q: any) => rowMatches(row, q));
  }
  const col = cond?.left ?? cond?.column;
  const value = cond?.right ?? cond?.value;
  if (col && typeof col === 'object' && 'name' in col) {
    const colName = (col as { name: string }).name;
    const candidate = row[colName] ?? row[snakeToCamel(colName)];
    return candidate === value;
  }
  return true;
}

function createStubDb(): StubDb {
  const store = new Map<string, Row[]>();
  const auditRows: Row[] = [];

  return {
    store,
    auditRows,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            then(resolve: any) {
              resolve(undefined);
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select(..._args: any[]) {
      let activeTable = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let filter: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        from(table: any) {
          activeTable = tableName(table);
          return builder;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then(resolve: any, reject?: any) {
          try {
            const list = store.get(activeTable) ?? [];
            const result = list.filter((r) => rowMatches(r, filter));
            resolve(result);
          } catch (err) {
            reject?.(err);
          }
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(table: any) {
      const name = tableName(table);
      return {
        set(changes: Row) {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                then(resolve: any) {
                  const list = store.get(name) ?? [];
                  for (let i = 0; i < list.length; i++) {
                    const cur = list[i]!;
                    if (rowMatches(cur, cond)) {
                      list[i] = { ...cur, ...changes };
                    }
                  }
                  resolve(undefined);
                },
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(query: any) {
      // drizzle's `sql\`…\`` template literals build an SQL builder whose
      // `queryChunks` holds the raw string slices + binds; stringifying
      // surfaces them in test mode so we can fingerprint the statement.
      const chunks =
        query && typeof query === 'object' && 'queryChunks' in query
          ? (query.queryChunks as unknown[])
          : [];
      const text = [
        chunks.map((c) =>
          c && typeof c === 'object' && 'value' in (c as Record<string, unknown>)
            ? String((c as { value: unknown }).value ?? '')
            : String(c ?? ''),
        ).join(' '),
        String(query ?? ''),
      ].join(' ');
      if (text.includes('ai_audit_chain') && text.includes('INSERT')) {
        auditRows.push({ ts: new Date(), text });
        return { rows: [] };
      }
      if (text.includes('SELECT') && text.includes('MAX(sequence_id)')) {
        return { rows: [{ max_seq: 0, last_hash: null }] };
      }
      if (text.includes('clock_in_events')) {
        const rows = store.get('clock_in_events') ?? [];
        return { rows };
      }
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
  app.route('/api/v1/field/workforce', createFieldWorkforceRouter());
  return app;
}

const TENANT = 'tnt-test';
const USER = 'usr-test';
const OTHER_USER = 'usr-other';
const VALID_TASK_ID = 'a1111111-2222-3333-4444-555555555555';

// ---------------------------------------------------------------------------
// 1) Auth gate
// ---------------------------------------------------------------------------

describe('field-workforce — auth gate', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 on /me without bearer', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/field/workforce/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 on /tasks/next without bearer', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/field/workforce/tasks/next');
    expect(res.status).toBe(401);
  });

  it('returns 401 on /tasks/:id/complete without bearer', async () => {
    const app = mount(createStubDb());
    const res = await app.request(
      `/api/v1/field/workforce/tasks/${VALID_TASK_ID}/complete`,
      { method: 'POST' },
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 on /help-requests without bearer', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/field/workforce/help-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'sw' }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2) /me happy path with no shift / no employees row
// ---------------------------------------------------------------------------

describe('GET /api/v1/field/workforce/me', () => {
  it('returns 200 with the cached fallback identity when no rows exist', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/field/workforce/me', {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workerId).toBe(USER);
    expect(body.shiftStatus).toBe('no_shift');
    // Worker label defaults — handler picks 'Worker'.
    expect(body.workerName.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3) /tasks/next — empty + happy path
// ---------------------------------------------------------------------------

describe('GET /api/v1/field/workforce/tasks/next', () => {
  it('returns 200 + null when no task is assigned', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/field/workforce/tasks/next', {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns 200 + the assigned task when one is pending', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: TENANT,
        assignedToUserId: USER,
        titleEn: 'Pit 3 sample',
        titleSw: 'Sampuli ya shimo 3',
        status: 'pending',
        priority: 'high',
        siteId: null,
        dueAt: null,
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request('/api/v1/field/workforce/tasks/next', {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; titleEn: string };
    expect(body.id).toBe(VALID_TASK_ID);
    expect(body.titleEn).toBe('Pit 3 sample');
  });
});

// ---------------------------------------------------------------------------
// 4) /tasks/:id/complete — happy + idempotent + cross-user
// ---------------------------------------------------------------------------

describe('POST /api/v1/field/workforce/tasks/:id/complete', () => {
  it('returns 200 + completes a pending task assigned to caller', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: TENANT,
        assignedToUserId: USER,
        titleEn: 'Pit 3 sample',
        titleSw: 'Sampuli ya shimo 3',
        status: 'pending',
        priority: 'normal',
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/field/workforce/tasks/${VALID_TASK_ID}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER, {
            tenantId: TENANT,
            userId: USER,
          }),
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      taskId: string;
      hashChainId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.taskId).toBe(VALID_TASK_ID);
    expect(db.auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 403 when the task is assigned to another worker', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: TENANT,
        assignedToUserId: OTHER_USER,
        titleEn: 'Pit 3 sample',
        titleSw: 'Sampuli ya shimo 3',
        status: 'pending',
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/field/workforce/tasks/${VALID_TASK_ID}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER, {
            tenantId: TENANT,
            userId: USER,
          }),
        },
      },
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 + idempotent:true when task already done', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: TENANT,
        assignedToUserId: USER,
        status: 'done',
        completedAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/field/workforce/tasks/${VALID_TASK_ID}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER, {
            tenantId: TENANT,
            userId: USER,
          }),
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idempotent?: boolean };
    expect(body.idempotent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5) /help-requests — happy path
// ---------------------------------------------------------------------------

describe('POST /api/v1/field/workforce/help-requests', () => {
  it('returns 400 when body is unparseable', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/field/workforce/help-requests', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locale: 'fr' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 201 + writes a help_requests row + audit-chain entry', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/field/workforce/help-requests', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ locale: 'sw', message: 'Naomba msaada' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      id: string;
      status: string;
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('open');
    expect(db.store.get('help_requests')?.length ?? 0).toBeGreaterThan(0);
    expect(db.auditRows.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// R39 — GET /shifts/today
// ---------------------------------------------------------------------------

describe('GET /api/v1/field/workforce/shifts/today', () => {
  it('returns 401 without bearer', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/field/workforce/shifts/today');
    expect(res.status).toBe(401);
  });

  it('returns 200 + empty-tasks shape when no employee row + no tasks', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/field/workforce/shifts/today', {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shiftDate: string;
      shiftKind: 'day' | 'night';
      siteName: string;
      startISO: string;
      endISO: string;
      nextBreakISO: string | null;
      tasks: ReadonlyArray<{ id: string; titleEn: string; titleSw: string }>;
    };
    expect(body.shiftKind).toBe('day');
    expect(body.tasks).toEqual([]);
    expect(body.startISO.endsWith('06:00:00+03:00')).toBe(true);
    expect(body.endISO.endsWith('18:00:00+03:00')).toBe(true);
  });

  it('returns 200 + tasks list when worker has assigned open tasks', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: TENANT,
        assignedToUserId: USER,
        titleEn: 'Pit 3 sample',
        titleSw: 'Sampuli ya shimo 3',
        status: 'pending',
        priority: 'normal',
        siteId: null,
        dueAt: null,
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request('/api/v1/field/workforce/shifts/today', {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tasks: ReadonlyArray<{ id: string; titleEn: string; titleSw: string }>;
    };
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]!.id).toBe(VALID_TASK_ID);
    expect(body.tasks[0]!.titleSw).toBe('Sampuli ya shimo 3');
  });
});
