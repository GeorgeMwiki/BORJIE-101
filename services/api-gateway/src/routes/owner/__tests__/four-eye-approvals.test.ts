/**
 * /api/v1/owner/four-eye — dual-control correctness tests.
 *
 * Pins the two adversarially-verified defects on the second-approver flow:
 *
 *   1. CONCURRENCY (compare-and-set). Two concurrent /approve calls on the
 *      same pending request must yield exactly ONE 200 (the CAS winner) and
 *      ONE 409 NOT_PENDING (the loser) — and the action dispatcher must fire
 *      EXACTLY once. Before the fix the UPDATE had no `status='pending'`
 *      predicate, so both writers won and both dispatched (last-writer-wins).
 *
 *   2. DUAL-CONTROL IDENTITY. When a request names a `secondApproverId`, only
 *      that principal may resolve it — a non-designated approver (even one
 *      that clears the role gate and is not the requester) must get 403 and
 *      the dispatcher must never fire. Before the fix the handler gated only
 *      on self-approval and silently accepted whoever called.
 *
 *   3. ROLE GATE. A principal outside the owner/tenant-admin-class role set
 *      is rejected with 403 by the route middleware before any row is read.
 *
 * The auth + database middleware are mocked (the leak-guard injection
 * pattern) so the branch runs deterministically with no live Postgres. The
 * fake db is a stateful Drizzle shim: a single in-memory four-eye row whose
 * status flips to `approved` the FIRST time a CAS UPDATE matches it while
 * pending, so the second concurrent UPDATE returns zero rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

import { UserRole } from '../../../types/user-role';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// ─── Auth middleware — driven per-test via a global slot ─────────────────
// We keep the REAL requireRole (imported from the same module) so the role
// gate is exercised end-to-end; only authMiddleware is replaced to inject a
// caller principal without minting a JWT.
const authRef: { current: { tenantId: string; userId: string; role: string } | null } = {
  current: null,
};
vi.mock('../../../middleware/hono-auth', async () => {
  const actual = await vi.importActual<typeof import('../../../middleware/hono-auth')>(
    '../../../middleware/hono-auth',
  );
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (k: string, v: unknown) => void; json: (b: unknown, s: number) => unknown },
      next: () => Promise<void>,
    ) => {
      if (!authRef.current) {
        return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
      }
      c.set('auth', authRef.current);
      await next();
    },
  };
});

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', (globalThis as Record<string, unknown>).__FE_DB__);
    await next();
  },
}));

// ─── Stateful Drizzle shim for the four_eye_requests row ──────────────────

interface FakeRow {
  id: string;
  tenantId: string;
  requesterId: string;
  secondApproverId: string | null;
  actionType: string;
  payload: Record<string, unknown>;
  approvalToken: string;
  status: string;
  expiresAt: Date;
  [k: string]: unknown;
}

function makeFakeDb(seed: FakeRow): { db: unknown; row: FakeRow } {
  const row = { ...seed };

  // The shim only needs to support the precise chains the handler uses:
  //   .select().from().where().limit()                 → loadByToken
  //   .update().set(set).where(cond).returning(cols)    → CAS
  //   .update().set().where()                           → audit-id patch (no returning)
  //   .execute(sql)                                     → audit append (no-op)
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => [{ ...row }],
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(setValues: Record<string, unknown>) {
          return {
            where() {
              // Compare-and-set semantics: the CAS UPDATE carries
              // status:'approved'|'rejected' and is the one that races. It
              // succeeds only while the row is still pending; the first such
              // call flips the in-memory status so the second returns [].
              const isCas =
                setValues.status === 'approved' || setValues.status === 'rejected';
              if (isCas) {
                const wonRace = row.status === 'pending';
                if (wonRace) {
                  Object.assign(row, setValues);
                }
                return {
                  returning: async () => (wonRace ? [{ id: row.id }] : []),
                };
              }
              // Non-CAS UPDATE (audit-id patch / execute-stage) — apply and
              // resolve as a thenable so a bare `await` works.
              Object.assign(row, setValues);
              const result = Promise.resolve([{ id: row.id }]);
              return {
                returning: async () => [{ id: row.id }],
                then: result.then.bind(result),
                catch: result.catch.bind(result),
                finally: result.finally.bind(result),
              };
            },
          };
        },
      };
    },
    // Audit-chain append uses db.execute(sql`...`). Make it a soft no-op so
    // appendAuditEntry returns an id (its SELECT path) without a real PG.
    async execute() {
      return { rows: [{ max_seq: 0, last_hash: '' }] };
    },
  };

  return { db, row };
}

// ─── Dispatcher spy — proves the side-effect leg fires EXACTLY once ───────

const dispatchSpy = vi.fn(async (_args: {
  actionType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}) => ({ ok: true }));

async function mount(): Promise<Hono> {
  const mod = await import('../four-eye-approvals.hono');
  mod.setFourEyeDispatcher(dispatchSpy);
  const app = new Hono();
  app.route('/owner/four-eye', mod.fourEyeApprovalsRouter);
  return app;
}

const TOKEN = 'tok_abcdefghijklmnop_0123456789'; // ≥16 chars

function seedRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'fe_req_1',
    tenantId: 'tenant-1',
    requesterId: 'requester-1',
    secondApproverId: 'designee-1',
    actionType: 'payment',
    payload: { amount: '7500000', currency: 'TZS' },
    approvalToken: TOKEN,
    status: 'pending',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

function approve() {
  return mount().then((app) =>
    app.request(`/owner/four-eye/approve/${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'ok' }),
    }),
  );
}

beforeEach(() => {
  dispatchSpy.mockClear();
  authRef.current = null;
  delete (globalThis as Record<string, unknown>).__FE_DB__;
});

describe('four-eye /approve — CAS concurrency', () => {
  it('two concurrent approves → exactly one 200, one 409, dispatcher fires once', async () => {
    const { db } = makeFakeDb(seedRow());
    (globalThis as Record<string, unknown>).__FE_DB__ = db;
    // The designated second approver, owner-class role.
    authRef.current = { tenantId: 'tenant-1', userId: 'designee-1', role: UserRole.OWNER };

    const [a, b] = await Promise.all([approve(), approve()]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;
    const loserBody = (await loser.json()) as { error: { code: string } };
    expect(loserBody.error.code).toBe('NOT_PENDING');

    const winnerBody = (await winner.json()) as { data: { status: string } };
    expect(['approved', 'executed']).toContain(winnerBody.data.status);

    // The CAS guarantees a single dispatch — the loser never reaches it.
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const call = dispatchSpy.mock.calls[0]![0];
    expect(call.idempotencyKey).toBe('four-eye:fe_req_1');
    expect(call.actionType).toBe('payment');
  });
});

describe('four-eye /approve — dual-control identity gate', () => {
  it('a non-designated approver (owner-class, not requester) → 403 and no dispatch', async () => {
    const { db } = makeFakeDb(seedRow({ secondApproverId: 'designee-1' }));
    (globalThis as Record<string, unknown>).__FE_DB__ = db;
    // Owner-class role (clears the role gate) and NOT the requester — but
    // also NOT the designated second approver.
    authRef.current = { tenantId: 'tenant-1', userId: 'random-owner-2', role: UserRole.OWNER };

    const res = await approve();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_DESIGNATED_APPROVER');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('the designated approver succeeds (200) and dispatches once', async () => {
    const { db } = makeFakeDb(seedRow({ secondApproverId: 'designee-1' }));
    (globalThis as Record<string, unknown>).__FE_DB__ = db;
    authRef.current = { tenantId: 'tenant-1', userId: 'designee-1', role: UserRole.OWNER };

    const res = await approve();
    expect(res.status).toBe(200);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('with NO designee set, the requester is still blocked from self-approval (403)', async () => {
    const { db } = makeFakeDb(seedRow({ secondApproverId: null }));
    (globalThis as Record<string, unknown>).__FE_DB__ = db;
    authRef.current = { tenantId: 'tenant-1', userId: 'requester-1', role: UserRole.OWNER };

    const res = await approve();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('four-eye /approve — role gate', () => {
  it('a field-worker role is rejected with 403 before any dispatch', async () => {
    const { db } = makeFakeDb(seedRow());
    (globalThis as Record<string, unknown>).__FE_DB__ = db;
    authRef.current = {
      tenantId: 'tenant-1',
      userId: 'designee-1',
      role: UserRole.MAINTENANCE_STAFF,
    };

    const res = await approve();
    expect(res.status).toBe(403);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
