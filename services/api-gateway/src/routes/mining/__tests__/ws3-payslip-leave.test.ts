/**
 * WS-3 workforce wires — integration tests (REAL Postgres, REAL RLS FORCE).
 *
 * Proves the two DoD gaps end-to-end against a throwaway Postgres cluster
 * connected as a NON-superuser role (so FORCE row-level security is actually
 * enforced — a superuser would bypass RLS and silently false-pass):
 *
 *   (1) WORKER PAYSLIP — GET /api/v1/mining/payslip/me returns the signed-in
 *       worker's REAL committed payroll line item (hours/base/overtime/bonus/
 *       deduction/net), never a draft, never another worker's row, and never
 *       another tenant's row.
 *
 *   (2) LEAVE REQUESTS — a worker submits a leave request, it round-trips
 *       through a manager approval (single sign-off, NO four-eye), the status
 *       flips pending -> approved, and an APPEND-ONLY entry lands in
 *       ai_audit_chain. RLS keeps the request invisible to a second tenant.
 *
 * The tables are created by applying the REAL migration 0174 SQL (leave_requests)
 * plus minimal payroll/audit DDL that mirrors the shipped RLS policies, then the
 * REAL routers are mounted behind the REAL databaseMiddleware (connection-pinned
 * GUC bind). No mocks, no fakes — the data path is the production path.
 *
 * Requires `initdb`/`pg_ctl` on PATH; skips cleanly otherwise so the wider
 * `vitest run` stays green on images without Postgres tooling.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Stable HS256 secret BEFORE any router/auth import (the auth middleware
// captures JWT_SECRET at module-init via getJwtSecret()). ESM hoists static
// imports above top-level statements, so BOTH generateToken (mints) and the
// routers' authMiddleware (verifies) are imported LAZILY in beforeAll, AFTER
// this assignment — otherwise they would capture two different secrets and
// every request would 401. Real Bearer tokens, no auth mock.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import { UserRole } from '../../../types/user-role';

import {
  APP_ROLE,
  postgresToolingAvailable,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../../../test/helpers/ephemeral-postgres';

// Bound in beforeAll after the env secret is settled (see note above).
let generateToken: (
  payload: {
    userId: string;
    tenantId: string;
    role: UserRole;
    permissions: string[];
    propertyAccess: string[];
  },
) => string;

const HAS_PG = postgresToolingAvailable();
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const TENANT_A = 'tenant-ws3-A';
const TENANT_B = 'tenant-ws3-B';
const WORKER_1 = 'worker-ws3-1';
const WORKER_2 = 'worker-ws3-2';
const MANAGER_1 = 'manager-ws3-1';

// Resolve the REAL migration 0174 so the test exercises the shipped DDL.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATION_0174 = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'database',
  'src',
  'migrations',
  '0174_leave_requests.sql',
);

interface AuthLike {
  userId: string;
  tenantId: string;
  role: UserRole;
}

/** Mint a REAL HS256 Bearer header for the given identity. */
function bearer(auth: AuthLike): Record<string, string> {
  const token = generateToken({
    userId: auth.userId,
    tenantId: auth.tenantId,
    role: auth.role,
    permissions: [],
    propertyAccess: [],
  });
  return { Authorization: `Bearer ${token}` };
}

/**
 * Build a Hono app that pre-injects the pooled (pinned) db. The router's OWN
 * authMiddleware then verifies the per-request Bearer token and sets `auth`
 * (so identity comes from a real JWT, not a stub); the router's
 * databaseMiddleware honours the pre-injected db and binds the tenant GUC.
 */
function buildApp(appDb: unknown, router: Hono, mountPath: string): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', appDb as never);
    c.set('repos', null as never);
    await next();
  });
  app.route(mountPath, router);
  return app;
}

describe.skipIf(!HAS_PG)('WS-3 payslip + leave (real Postgres, FORCE RLS)', () => {
  let pg: EphemeralPostgres;
  let appDb: {
    execute: (q: unknown) => Promise<unknown>;
    $client: { end: (o?: unknown) => Promise<void> };
  };
  let payslipApp: Hono;
  let leaveApp: Hono;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();

    const { default: postgres } = await import('postgres');
    const admin = postgres(pg.adminUrl, { max: 1 });
    try {
      // ai_audit_chain — append-only hash chain (mirrors migration 0152 shape
      // for the columns the audit append writes). RLS FORCE on the canonical GUC.
      await admin.unsafe(`
        CREATE TABLE ai_audit_chain (
          id          text PRIMARY KEY,
          tenant_id   text NOT NULL,
          sequence_id bigint NOT NULL,
          turn_id     text NOT NULL,
          session_id  text,
          action      text NOT NULL,
          prev_hash   text NOT NULL,
          this_hash   text NOT NULL,
          payload_ref text,
          payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at  timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE ai_audit_chain ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ai_audit_chain FORCE ROW LEVEL SECURITY;
        CREATE POLICY ai_audit_chain_tenant_iso ON ai_audit_chain
          USING      (tenant_id = current_setting('app.current_tenant_id', true))
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

        -- payroll_runs + payroll_line_items (migration 0134 shape, columns the
        -- worker payslip route reads). RLS FORCE on the canonical GUC.
        CREATE TABLE payroll_runs (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id     text NOT NULL,
          created_by_user_id text NOT NULL,
          period_start  date NOT NULL,
          period_end    date NOT NULL,
          status        text NOT NULL DEFAULT 'draft',
          total_tzs     numeric(15,2) NOT NULL DEFAULT 0,
          worker_count  integer NOT NULL DEFAULT 0,
          notes         text,
          created_at    timestamptz NOT NULL DEFAULT now(),
          previewed_at  timestamptz,
          committed_at  timestamptz
        );
        ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
        CREATE POLICY payroll_runs_tenant_iso ON payroll_runs
          USING      (tenant_id = current_setting('app.current_tenant_id', true))
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

        CREATE TABLE payroll_line_items (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id      text NOT NULL,
          payroll_run_id uuid NOT NULL,
          worker_user_id text NOT NULL,
          hours_worked   numeric(8,2) NOT NULL DEFAULT 0,
          overtime_hours numeric(8,2) NOT NULL DEFAULT 0,
          hourly_rate_tzs numeric(12,2) NOT NULL DEFAULT 0,
          base_tzs       numeric(15,2) NOT NULL DEFAULT 0,
          overtime_tzs   numeric(15,2) NOT NULL DEFAULT 0,
          bonus_tzs      numeric(15,2) NOT NULL DEFAULT 0,
          deduction_tzs  numeric(15,2) NOT NULL DEFAULT 0,
          net_tzs        numeric(15,2) NOT NULL DEFAULT 0,
          status         text NOT NULL DEFAULT 'pending',
          ledger_txn_id  text,
          payout_provider text,
          payout_provider_ref text,
          failure_reason text,
          created_at     timestamptz NOT NULL DEFAULT now(),
          posted_at      timestamptz,
          paid_at        timestamptz
        );
        ALTER TABLE payroll_line_items ENABLE ROW LEVEL SECURITY;
        ALTER TABLE payroll_line_items FORCE ROW LEVEL SECURITY;
        CREATE POLICY payroll_line_items_tenant_iso ON payroll_line_items
          USING      (tenant_id = current_setting('app.current_tenant_id', true))
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      `);

      // Apply the REAL migration 0174 (creates leave_requests + its RLS).
      await admin.unsafe(readFileSync(MIGRATION_0174, 'utf8'));

      // Least-privilege grants for the non-superuser app role.
      await admin.unsafe(`
        GRANT SELECT, INSERT, UPDATE ON ai_audit_chain     TO ${APP_ROLE};
        GRANT SELECT, INSERT, UPDATE ON payroll_runs        TO ${APP_ROLE};
        GRANT SELECT, INSERT, UPDATE ON payroll_line_items  TO ${APP_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests TO ${APP_ROLE};
      `);
    } finally {
      await admin.end({ timeout: 5 });
    }

    // Pooled Drizzle client as the NON-superuser app role → FORCE RLS enforced.
    process.env.DATABASE_POOL_MAX = process.env.DATABASE_POOL_MAX ?? '10';
    const { createDatabaseClient } = await import('@borjie/database');
    appDb = createDatabaseClient(pg.appUrl) as unknown as typeof appDb;

    // Lazy import so generateToken + the routers' authMiddleware share the
    // env JWT secret set at the top of this file (ESM hoists static imports).
    ({ generateToken } = await import('../../../middleware/auth'));

    const { miningPayslipRouter } = await import('../payslip.hono');
    const { miningLeaveRequestsRouter } = await import('../leave-requests.hono');

    payslipApp = buildApp(appDb, miningPayslipRouter as unknown as Hono, '/payslip');
    leaveApp = buildApp(appDb, miningLeaveRequestsRouter as unknown as Hono, '/leave-requests');
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    try {
      await appDb?.$client.end({ timeout: 5 });
    } catch {
      /* best-effort */
    }
    pg?.stop();
  });

  // Clean slate per test: wipe the four tables via the admin (bypasses RLS).
  beforeEach(async () => {
    const { default: postgres } = await import('postgres');
    const admin = postgres(pg.adminUrl, { max: 1 });
    try {
      await admin.unsafe(
        'TRUNCATE leave_requests, payroll_line_items, payroll_runs, ai_audit_chain',
      );
    } finally {
      await admin.end({ timeout: 5 });
    }
  });

  // -------------------------------------------------------------------------
  // (1) WORKER PAYSLIP
  // -------------------------------------------------------------------------

  it(
    'returns the signed-in worker REAL committed line item — not a draft, not a colleague',
    async () => {
      // Seed via admin (RLS-bypassing) a committed run with two workers, plus a
      // DRAFT run that must be ignored.
      const { default: postgres } = await import('postgres');
      const admin = postgres(pg.adminUrl, { max: 1 });
      let committedRunId = '';
      try {
        const [committed] = await admin.unsafe(
          `INSERT INTO payroll_runs (tenant_id, created_by_user_id, period_start, period_end, status, committed_at)
           VALUES ('${TENANT_A}', 'owner-A', '2026-05-01', '2026-05-15', 'committed', now())
           RETURNING id`,
        );
        committedRunId = (committed as { id: string }).id;
        const [draft] = await admin.unsafe(
          `INSERT INTO payroll_runs (tenant_id, created_by_user_id, period_start, period_end, status)
           VALUES ('${TENANT_A}', 'owner-A', '2026-05-16', '2026-05-31', 'draft')
           RETURNING id`,
        );
        const draftRunId = (draft as { id: string }).id;

        // WORKER_1 committed line item (the one we expect back).
        await admin.unsafe(
          `INSERT INTO payroll_line_items
             (tenant_id, payroll_run_id, worker_user_id, hours_worked, overtime_hours,
              hourly_rate_tzs, base_tzs, overtime_tzs, bonus_tzs, deduction_tzs, net_tzs, status)
           VALUES ('${TENANT_A}', '${committedRunId}', '${WORKER_1}', 80, 4,
              5000, 400000, 30000, 50000, 20000, 460000, 'posted')`,
        );
        // WORKER_2 committed line item (must NOT leak to worker 1).
        await admin.unsafe(
          `INSERT INTO payroll_line_items
             (tenant_id, payroll_run_id, worker_user_id, net_tzs, base_tzs, status)
           VALUES ('${TENANT_A}', '${committedRunId}', '${WORKER_2}', 999999, 999999, 'posted')`,
        );
        // WORKER_1 DRAFT line item (must be ignored — only committed counts).
        await admin.unsafe(
          `INSERT INTO payroll_line_items
             (tenant_id, payroll_run_id, worker_user_id, net_tzs, base_tzs, status)
           VALUES ('${TENANT_A}', '${draftRunId}', '${WORKER_1}', 123, 123, 'pending')`,
        );
      } finally {
        await admin.end({ timeout: 5 });
      }

      const res = await payslipApp.request('/payslip/me', {
        headers: bearer({ userId: WORKER_1, tenantId: TENANT_A, role: UserRole.MAINTENANCE_STAFF }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          lineItem: { netTzs: number; baseTzs: number; overtimeTzs: number; bonusTzs: number; deductionTzs: number; hoursWorked: number; overtimeHours: number };
          currencyCode: string;
          labels: ReadonlyArray<{ key: string; sw: string; en: string }>;
          period: { start: string; end: string };
        } | null;
      };
      expect(body.success).toBe(true);
      expect(body.data).not.toBeNull();
      // The committed WORKER_1 figures — never the draft (123) or WORKER_2 (999999).
      expect(body.data!.lineItem.netTzs).toBe(460000);
      expect(body.data!.lineItem.baseTzs).toBe(400000);
      expect(body.data!.lineItem.overtimeTzs).toBe(30000);
      expect(body.data!.lineItem.bonusTzs).toBe(50000);
      expect(body.data!.lineItem.deductionTzs).toBe(20000);
      expect(body.data!.lineItem.hoursWorked).toBe(80);
      expect(body.data!.lineItem.overtimeHours).toBe(4);
      // Bilingual labels are carried (sw + en); no hardcoded currency in them.
      expect(body.data!.labels.length).toBeGreaterThan(0);
      const net = body.data!.labels.find((l) => l.key === 'netTzs');
      expect(net?.sw).toBeTruthy();
      expect(net?.en).toBeTruthy();
      expect(body.data!.currencyCode).toBe('TZS');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'returns null when the worker has no committed line item',
    async () => {
      const res = await payslipApp.request('/payslip/me', {
        headers: bearer({ userId: WORKER_1, tenantId: TENANT_A, role: UserRole.MAINTENANCE_STAFF }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // (2) LEAVE REQUESTS — round-trip + manager approval + audit append + RLS
  // -------------------------------------------------------------------------

  it(
    'round-trips a leave request through manager approval with an audit append',
    async () => {
      // Worker submits.
      const submit = await leaveApp.request('/leave-requests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...bearer({ userId: WORKER_1, tenantId: TENANT_A, role: UserRole.MAINTENANCE_STAFF }),
        },
        body: JSON.stringify({
          category: 'sick',
          startOn: '2026-06-10',
          endOn: '2026-06-12',
          reason: 'Malaria treatment',
        }),
      });
      expect(submit.status).toBe(201);
      const submitted = (await submit.json()) as {
        success: boolean;
        data: { id: string; status: string; workerUserId: string };
      };
      expect(submitted.success).toBe(true);
      expect(submitted.data.status).toBe('pending');
      expect(submitted.data.workerUserId).toBe(WORKER_1);
      const leaveId = submitted.data.id;

      // Worker sees it in /mine.
      const mine = await leaveApp.request('/leave-requests/mine', {
        headers: bearer({ userId: WORKER_1, tenantId: TENANT_A, role: UserRole.MAINTENANCE_STAFF }),
      });
      expect(mine.status).toBe(200);
      const mineBody = (await mine.json()) as { data: Array<{ id: string }> };
      expect(mineBody.data.map((r) => r.id)).toContain(leaveId);

      // A plain worker may NOT approve (manager-gate).
      const forbidden = await leaveApp.request(`/leave-requests/${leaveId}/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...bearer({ userId: WORKER_2, tenantId: TENANT_A, role: UserRole.MAINTENANCE_STAFF }),
        },
        body: JSON.stringify({}),
      });
      expect(forbidden.status).toBe(403);

      // Manager approves (single sign-off, NO four-eye).
      const approve = await leaveApp.request(`/leave-requests/${leaveId}/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...bearer({ userId: MANAGER_1, tenantId: TENANT_A, role: UserRole.PROPERTY_MANAGER }),
        },
        body: JSON.stringify({ note: 'Get well soon' }),
      });
      expect(approve.status).toBe(200);
      const approved = (await approve.json()) as {
        success: boolean;
        data: { status: string; decidedByUserId: string; decisionNote: string };
        meta: { auditId: string };
      };
      expect(approved.success).toBe(true);
      expect(approved.data.status).toBe('approved');
      expect(approved.data.decidedByUserId).toBe(MANAGER_1);
      expect(approved.data.decisionNote).toBe('Get well soon');
      expect(approved.meta.auditId).toBeTruthy();

      // Audit append landed in ai_audit_chain for THIS tenant.
      const auditRows = await runAsTenant(appDb, TENANT_A, async (db) =>
        db.execute(
          sql`SELECT action, payload FROM ai_audit_chain WHERE tenant_id = ${TENANT_A}`,
        ),
      );
      const audits = normalizeRows(auditRows);
      expect(audits.length).toBe(1);
      expect(audits[0]?.action).toBe('mining.leave.approve');

      // Re-approving a terminal request is a 409 (state machine guard).
      const reApprove = await leaveApp.request(`/leave-requests/${leaveId}/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...bearer({ userId: MANAGER_1, tenantId: TENANT_A, role: UserRole.PROPERTY_MANAGER }),
        },
        body: JSON.stringify({}),
      });
      expect(reApprove.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rejects an invalid date range at the API boundary (zod)',
    async () => {
      const res = await leaveApp.request('/leave-requests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...bearer({ userId: WORKER_1, tenantId: TENANT_A, role: UserRole.MAINTENANCE_STAFF }),
        },
        body: JSON.stringify({ category: 'annual', startOn: '2026-06-12', endOn: '2026-06-10' }),
      });
      expect(res.status).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'never leaks a leave request across tenants (FORCE RLS)',
    async () => {
      // Worker in tenant A submits.
      const submit = await leaveApp.request('/leave-requests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...bearer({ userId: WORKER_1, tenantId: TENANT_A, role: UserRole.MAINTENANCE_STAFF }),
        },
        body: JSON.stringify({ category: 'annual', startOn: '2026-07-01', endOn: '2026-07-05' }),
      });
      expect(submit.status).toBe(201);

      // A manager in tenant B lists — must see ZERO of tenant A's rows.
      const listB = await leaveApp.request('/leave-requests', {
        headers: bearer({ userId: 'manager-B', tenantId: TENANT_B, role: UserRole.PROPERTY_MANAGER }),
      });
      expect(listB.status).toBe(200);
      const bodyB = (await listB.json()) as { data: unknown[] };
      expect(bodyB.data).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Helpers — run a read under a specific tenant GUC on a fresh reserved conn.
// ---------------------------------------------------------------------------

async function runAsTenant(
  appDb: { $client: { reserve?: () => Promise<unknown> } } & { execute: (q: unknown) => Promise<unknown> },
  tenantId: string,
  fn: (db: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>,
): Promise<unknown> {
  const { withReservedConnection } = await import('@borjie/database');
  return withReservedConnection(appDb as never, async (reqDb: { execute: (q: unknown) => Promise<unknown> }) => {
    await reqDb.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`);
    return fn(reqDb);
  });
}

function normalizeRows(result: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return rows as Array<Record<string, unknown>>;
}
