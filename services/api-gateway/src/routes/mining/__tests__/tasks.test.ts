/**
 * /api/v1/mining/tasks — worker task router smoke tests.
 *
 * Mirrors the pilot-feedback test harness: pre-bind a stub Drizzle client
 * on the Hono context so the router's `databaseMiddleware` short-circuits
 * to the test fake, then exercise each endpoint with valid JWTs minted by
 * `generateToken`.
 *
 * Assertions cover:
 *   1. 401 when no Authorization header is supplied.
 *   2. 400 when zod validation rejects an invalid payload.
 *   3. 403 when a non-manager role attempts manager-only routes.
 *   4. 201 happy path for create.
 *   5. 200 happy path for list + filter by assignedTo.
 *   6. 200 happy path for /:id/complete + audit-chain row inserted.
 *   7. Idempotency: a second /:id/complete short-circuits with meta.idempotent.
 *   8. 200 happy path for /:id/block with reason.
 *   9. 200 happy path for /:id/reassign (manager-only).
 *  10. 404 when target task does not exist.
 *  11. Cross-tenant denial — fake db filters out other-tenant rows.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret BEFORE importing the router so all middleware that
// captures the secret at module init agrees with the token signer.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createMiningTasksRouter } from '../tasks.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

// ---------------------------------------------------------------------------
// In-memory fake Drizzle client + ai_audit_chain capture
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface StubDb {
  readonly store: Map<string, Row[]>;
  readonly auditRows: Row[];
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

function rowMatches(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => rowMatches(row, c));
  // drizzle `and(...)` returns an SQL-builder object; walk `.queries`.
  if (cond?.queries && Array.isArray(cond.queries)) {
    return cond.queries.every((q: any) => rowMatches(row, q));
  }
  // drizzle `eq(col, val)` exposes `.queryChunks` or shape with .left/.right.
  const col = cond?.left ?? cond?.column;
  const value = cond?.right ?? cond?.value;
  if (col && typeof col === 'object' && 'name' in col) {
    const colName = (col as any).name as string;
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
    insert(table: any) {
      const name = tableName(table);
      if (!store.has(name)) store.set(name, []);
      return {
        values(rowOrRows: Row | Row[]) {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          const withDefaults = rows.map((r) => ({
            // mirror DB defaults so handlers reading row.id / row.createdAt work
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
            const result = list.filter((r) => rowMatches(r, filter));
            resolve(result);
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
                  // Immutability — replace the row object in the store.
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
    async execute(query: any) {
      // Capture audit-chain rows: any execute() with an INSERT INTO
      // ai_audit_chain mentions the table name inside one of the SQL
      // fragments. `queryChunks` is an array of mixed fragments + param
      // markers — flatten the .value strings to get the rendered SQL.
      let text = '';
      if (query && typeof query === 'object' && 'queryChunks' in query) {
        const chunks = (query as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [];
        for (const c of chunks) {
          if (c && typeof c === 'object' && 'value' in c) {
            text += String((c as { value: unknown }).value ?? '');
          }
        }
      } else {
        text = String(query);
      }
      if (text.includes('INSERT INTO ai_audit_chain')) {
        auditRows.push({ ts: new Date(), text });
        return { rows: [] };
      }
      if (text.includes('SELECT COALESCE')) {
        return { rows: [{ max_seq: 0, last_hash: null }] };
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
  app.route('/api/v1/mining/tasks', createMiningTasksRouter());
  return app;
}

const VALID_UUID = '11111111-2222-3333-4444-555555555555';
const VALID_UUID_2 = '22222222-3333-4444-5555-666666666666';
const VALID_TASK_ID = '99999999-aaaa-bbbb-cccc-dddddddddddd';

// ---------------------------------------------------------------------------
// 1) auth gate
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/tasks — auth', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 when no bearer token is supplied', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/mining/tasks');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2) validation
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks — validation', () => {
  it('returns 400 when titleSw is missing', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/mining/tasks', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3) role gate
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks — role gate', () => {
  it('returns 403 when a non-manager attempts to create a task', async () => {
    const app = mount(createStubDb());
    const res = await app.request('/api/v1/mining/tasks', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.RESIDENT),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ titleSw: 'Toa sample kutoka shimo 3' }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 4) create happy path
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks — happy path', () => {
  it('returns 201 with the persisted task when a manager creates one', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request('/api/v1/mining/tasks', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: 'tnt-test',
          userId: 'mgr-1',
        }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        titleSw: 'Toa sample kutoka shimo 3',
        titleEn: 'Take sample from pit 3',
        priority: 'high',
        assignedToUserId: VALID_UUID,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { titleSw: string; status: string; assignedByUserId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.titleSw).toBe('Toa sample kutoka shimo 3');
    expect(body.data.status).toBe('pending');
    expect(body.data.assignedByUserId).toBe('mgr-1');
    expect(db.store.get('mining_tasks')?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5) list + filter
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/tasks — list + filter', () => {
  it('returns rows filtered by assignedTo for the current worker', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        assignedToUserId: VALID_UUID,
        titleSw: 'Kazi A',
        status: 'pending',
        priority: 'normal',
        createdAt: new Date(),
      },
      {
        id: VALID_UUID_2,
        tenantId: 'tnt-test',
        assignedToUserId: 'someone-else',
        titleSw: 'Kazi B',
        status: 'pending',
        priority: 'normal',
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks?assignedTo=${VALID_UUID}`,
      {
        headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.titleSw).toBe('Kazi A');
  });
});

// ---------------------------------------------------------------------------
// 6) complete happy path + audit chain
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks/:id/complete — happy path + audit', () => {
  it('marks the task done, stamps hashChainId, and appends an audit row', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        assignedToUserId: VALID_UUID,
        titleSw: 'Kazi A',
        status: 'pending',
        priority: 'normal',
        completedAt: null,
        blockedReason: null,
        hashChainId: null,
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.RESIDENT, { userId: 'worker-7' }),
          'Content-Type': 'application/json',
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; hashChainId: string | null };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('done');
    expect(db.auditRows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7) complete idempotency
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks/:id/complete — idempotency', () => {
  it('returns 200 with meta.idempotent on a second complete and skips audit', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        assignedToUserId: VALID_UUID,
        titleSw: 'Kazi A',
        status: 'done',
        priority: 'normal',
        completedAt: new Date(),
        blockedReason: null,
        hashChainId: 'audit-existing',
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/complete`,
      {
        method: 'POST',
        headers: { Authorization: bearer(UserRole.RESIDENT) },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      meta?: { idempotent?: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.meta?.idempotent).toBe(true);
    expect(db.auditRows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8) block happy path
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks/:id/block — happy path', () => {
  it('marks the task blocked with the worker-supplied reason', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        assignedToUserId: VALID_UUID,
        titleSw: 'Kazi A',
        status: 'in_progress',
        priority: 'normal',
        completedAt: null,
        blockedReason: null,
        hashChainId: null,
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/block`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.RESIDENT),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Hakuna fuel kwenye genereta' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; blockedReason: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('blocked');
    expect(body.data.blockedReason).toBe('Hakuna fuel kwenye genereta');
  });
});

// ---------------------------------------------------------------------------
// 9) reassign (manager-only)
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks/:id/reassign — manager only', () => {
  it('reassigns and clears blocked status when re-opening a blocked task', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        assignedToUserId: VALID_UUID,
        titleSw: 'Kazi A',
        status: 'blocked',
        priority: 'normal',
        completedAt: null,
        blockedReason: 'old reason',
        hashChainId: 'h1',
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/reassign`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assignedToUserId: VALID_UUID_2 }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        assignedToUserId: string;
        status: string;
        blockedReason: string | null;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.assignedToUserId).toBe(VALID_UUID_2);
    expect(body.data.status).toBe('pending');
    expect(body.data.blockedReason).toBeNull();
  });

  it('returns 403 when a worker attempts to reassign', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        titleSw: 'Kazi A',
        status: 'pending',
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/reassign`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.RESIDENT),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assignedToUserId: VALID_UUID_2 }),
      },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 10) not found
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks/:id/complete — not found', () => {
  it('returns 404 when no task matches the id', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/complete`,
      {
        method: 'POST',
        headers: { Authorization: bearer(UserRole.RESIDENT) },
      },
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 11) cross-tenant denial
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/tasks — cross-tenant denial', () => {
  it('does not return rows that belong to another tenant', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-other',
        assignedToUserId: VALID_UUID,
        titleSw: 'Kazi B',
        status: 'pending',
        priority: 'normal',
        createdAt: new Date(),
      },
    ]);
    const app = mount(db);
    const res = await app.request('/api/v1/mining/tasks', {
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

// ---------------------------------------------------------------------------
// 12) L4 — assign-worker
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/tasks/:id/assign-worker — commercial chain L4', () => {
  it('returns 403 when a non-manager role attempts to assign', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        titleSw: 'Kazi RFB',
        status: 'pending',
        kind: 'rfb_fulfill',
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/assign-worker`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.RESIDENT),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workerId: VALID_UUID }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when workerId is missing', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/assign-worker`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.TENANT_ADMIN),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when task does not exist', async () => {
    const db = createStubDb();
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/assign-worker`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.TENANT_ADMIN),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workerId: VALID_UUID }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('assigns the worker, transitions out of blocked, and writes audit', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        titleSw: 'Kazi RFB',
        status: 'blocked',
        blockedReason: 'awaiting equipment',
        kind: 'rfb_fulfill',
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/assign-worker`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workerId: VALID_UUID,
          shiftId: VALID_UUID_2,
          noteSw: 'Anza haraka',
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { assignedToUserId: string; status: string; blockedReason: null };
    };
    expect(body.success).toBe(true);
    expect(body.data.assignedToUserId).toBe(VALID_UUID);
    expect(body.data.status).toBe('pending');
    expect(body.data.blockedReason).toBeNull();
    expect(db.auditRows.length).toBeGreaterThanOrEqual(1);
    expect(
      db.auditRows.some((r) =>
        String(r.text).includes('INSERT INTO ai_audit_chain'),
      ),
    ).toBe(true);
  });

  it('returns 409 when task is already done', async () => {
    const db = createStubDb();
    db.store.set('mining_tasks', [
      {
        id: VALID_TASK_ID,
        tenantId: 'tnt-test',
        titleSw: 'Kazi RFB',
        status: 'done',
        kind: 'standard',
      },
    ]);
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/tasks/${VALID_TASK_ID}/assign-worker`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.TENANT_ADMIN),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workerId: VALID_UUID }),
      },
    );
    expect(res.status).toBe(409);
  });
});
