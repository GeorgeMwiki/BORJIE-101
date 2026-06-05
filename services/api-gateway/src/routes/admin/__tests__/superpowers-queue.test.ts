/**
 * Admin superpowers four-eye QUEUE — route contract tests (ported from
 * BossNyumba 0301, retargeted real-estate → mining).
 *
 * Wraps the router in a stubbed auth + table-aware Drizzle harness and
 * validates the generic propose → approve → reject → list_pending queue:
 *   - a HIGH-risk queue verb (suspend_licence_holder) writes a pending row
 *   - /approve/:journalId refuses the SAME proposing actor with 409
 *   - /approve/:journalId applies when a DIFFERENT admin approves
 *   - /approve/:journalId refuses an already-applied row with 409
 *   - /reject/:journalId transitions a pending row to rejected
 *   - /pending lists pending rows for the admin's tenant
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
// Pre-warm the heavy @borjie/database barrel during module-init so the in-body
// `await import('../superpowers.hono')` does not trip the 10s test timeout on a
// cold vitest worker (a STATIC import runs outside the per-test clock).
import {
  adminSuperpowerPendingApprovals,
  undoJournal,
} from '@borjie/database';

// Pin env BEFORE any router import so config loaders succeed.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-admin-superpowers-32-chars-long';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ||
  'test-supabase-admin-superpowers-32-chars-long';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'anon-key-aaaaaaaaaaaaaaaaaaaaaaaa';

// ─── Mock the middlewares ─────────────────────────────────────────────

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// ─── Table-aware Drizzle stub ─────────────────────────────────────────

type Row = Record<string, unknown>;

interface DbState {
  /** Rows the SELECT on admin_superpower_pending_approvals returns. */
  pendingRows: Row[];
  /** Rows the SELECT on undo_journal returns. */
  journalRows: Row[];
  /** Captured inserts keyed by table. */
  pendingInserts: Row[];
  journalInserts: Row[];
  /** Captured update `set(...)` payloads keyed by table. */
  pendingUpdates: Row[];
  journalUpdates: Row[];
  insertCalls: number;
}

function isPendingTable(t: unknown): boolean {
  return t === adminSuperpowerPendingApprovals;
}
function isJournalTable(t: unknown): boolean {
  return t === undoJournal;
}

function makeDbStub(state: DbState) {
  return {
    insert(table: unknown) {
      return {
        values(input: Record<string, unknown>) {
          return {
            async returning() {
              state.insertCalls += 1;
              const row = {
                ...input,
                id: input.id ?? `row_${state.insertCalls}`,
              };
              if (isPendingTable(table)) state.pendingInserts.push(row);
              else state.journalInserts.push(row);
              return [row];
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const rows = isPendingTable(table)
            ? state.pendingRows
            : state.journalRows;
          const chain = {
            where(_w: unknown) {
              return {
                async limit(_n: number) {
                  return rows;
                },
                orderBy(_o: unknown) {
                  return {
                    async limit(_n: number) {
                      return rows;
                    },
                  };
                },
              };
            },
          };
          return chain;
        },
      };
    },
    update(table: unknown) {
      return {
        set(input: Record<string, unknown>) {
          if (isPendingTable(table)) state.pendingUpdates.push(input);
          else state.journalUpdates.push(input);
          return {
            where(_w: unknown) {
              return {
                async returning() {
                  const base = isPendingTable(table)
                    ? state.pendingRows[0]
                    : state.journalRows[0];
                  return [{ ...(base ?? {}), ...input }];
                },
              };
            },
          };
        },
      };
    },
  };
}

interface AuthShape {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
}

function emptyState(overrides: Partial<DbState> = {}): DbState {
  return {
    pendingRows: [],
    journalRows: [],
    pendingInserts: [],
    journalInserts: [],
    pendingUpdates: [],
    journalUpdates: [],
    insertCalls: 0,
    ...overrides,
  };
}

async function buildApp(state: DbState, auth: AuthShape) {
  const { adminSuperpowersRouter } = await import('../superpowers.hono');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as unknown as never, auth as unknown as never);
    c.set('db' as unknown as never, makeDbStub(state) as unknown as never);
    await next();
  });
  app.route('/admin/superpowers', adminSuperpowersRouter);
  return app;
}

// ─── propose (bulk-action HIGH queue verb) ────────────────────────────

describe('queue /bulk-action — HIGH queue verb writes a pending row', () => {
  it('records a pending approval for suspend_licence_holder', async () => {
    const state = emptyState();
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'SUPER_ADMIN',
    });
    const res = await app.request('/admin/superpowers/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'licence_holder',
        ids: ['lh-acme'],
        action: 'suspend_licence_holder',
        reason: 'sanctioned-entity-list-match-2026',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        requiresFourEye: boolean;
        status: string;
        pendingApprovalIds: ReadonlyArray<string>;
      };
    };
    expect(body.data.requiresFourEye).toBe(true);
    expect(body.data.status).toBe('pending_approval');
    expect(body.data.pendingApprovalIds).toHaveLength(1);
    // One journal row + one pending-approvals row were written.
    expect(state.journalInserts).toHaveLength(1);
    expect(state.pendingInserts).toHaveLength(1);
    expect(state.pendingInserts[0]).toMatchObject({
      action: 'suspend_licence_holder',
      status: 'pending',
      proposedByActorId: 'admin_a',
      proposedByTenantId: 'admin_tn',
      targetEntityRef: 'licence_holder:lh-acme',
    });
  });
});

// ─── approve ──────────────────────────────────────────────────────────

describe('queue /approve/:journalId — four-eye flow', () => {
  function pendingRow(): Row {
    return {
      id: 'p-1',
      journalId: 'j-1',
      proposedByTenantId: 'admin_tn',
      proposedByActorId: 'admin_a',
      proposedByRole: 'SUPER_ADMIN',
      action: 'suspend_licence_holder',
      targetEntityRef: 'licence_holder:lh-acme',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  it('rejects approval by the SAME actor as the proposer with 409', async () => {
    const state = emptyState({ pendingRows: [pendingRow()] });
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'SUPER_ADMIN',
    });
    const res = await app.request('/admin/superpowers/approve/j-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionNote: 'self-approval attempt' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FOUR_EYE_SAME_ACTOR');
    // No write happened.
    expect(state.pendingUpdates).toHaveLength(0);
  });

  it('applies when a DIFFERENT admin approves', async () => {
    const state = emptyState({
      pendingRows: [pendingRow()],
      journalRows: [
        {
          id: 'j-1',
          tenantId: 'admin_tn',
          provenance: { requires_four_eye: true, status: 'pending_approval' },
        },
      ],
    });
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_b',
      role: 'ADMIN',
    });
    const res = await app.request('/admin/superpowers/approve/j-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisionNote: 'verified out of band' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        applied: boolean;
        targetEntityRef: string;
        mutationApplied: boolean;
      };
    };
    expect(body.data.applied).toBe(true);
    expect(body.data.targetEntityRef).toBe('licence_holder:lh-acme');
    // Honest-degraded: the entity-side mutation is not wired.
    expect(body.data.mutationApplied).toBe(false);
    // The pending row was transitioned to applied with the approver pinned.
    expect(state.pendingUpdates[0]).toMatchObject({
      status: 'applied',
      approvedByActorId: 'admin_b',
    });
    // The journal provenance was reflected to applied.
    expect(state.journalUpdates[0]?.provenance).toMatchObject({
      status: 'applied',
      approved_by_user_id: 'admin_b',
    });
  });

  it('refuses an already-applied row with 409 ALREADY_APPLIED', async () => {
    const applied = { ...pendingRow(), status: 'applied' };
    const state = emptyState({ pendingRows: [applied] });
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_b',
      role: 'ADMIN',
    });
    const res = await app.request('/admin/superpowers/approve/j-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_APPLIED');
  });

  it('404s when no pending row exists for the journalId', async () => {
    const state = emptyState({ pendingRows: [] });
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_b',
      role: 'ADMIN',
    });
    const res = await app.request('/admin/superpowers/approve/j-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

// ─── reject ───────────────────────────────────────────────────────────

describe('queue /reject/:journalId', () => {
  it('transitions a pending row to rejected', async () => {
    const state = emptyState({
      pendingRows: [
        {
          id: 'p-1',
          journalId: 'j-1',
          proposedByTenantId: 'admin_tn',
          proposedByActorId: 'admin_a',
          action: 'export_regulator_pack',
          status: 'pending',
        },
      ],
    });
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_b',
      role: 'ADMIN',
    });
    const res = await app.request('/admin/superpowers/reject/j-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: 'hold-until-regulator-confirms' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { rejected: boolean };
    };
    expect(body.data.rejected).toBe(true);
    expect(state.pendingUpdates[0]).toMatchObject({
      status: 'rejected',
      rejectedByActorId: 'admin_b',
      rejectionReason: 'hold-until-regulator-confirms',
    });
  });

  it('refuses a non-pending row with 409 ALREADY_RESOLVED', async () => {
    const state = emptyState({
      pendingRows: [
        {
          id: 'p-1',
          journalId: 'j-1',
          proposedByActorId: 'admin_a',
          action: 'export_regulator_pack',
          status: 'applied',
        },
      ],
    });
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_b',
      role: 'ADMIN',
    });
    const res = await app.request('/admin/superpowers/reject/j-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: 'too-late-but-trying' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_RESOLVED');
  });
});

// ─── list_pending ─────────────────────────────────────────────────────

describe('queue GET /pending', () => {
  it('lists pending rows for the admin tenant', async () => {
    const state = emptyState({
      pendingRows: [
        { id: 'p-1', status: 'pending', action: 'suspend_licence_holder' },
        { id: 'p-2', status: 'pending', action: 'export_regulator_pack' },
      ],
    });
    const app = await buildApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'SUPPORT',
    });
    const res = await app.request('/admin/superpowers/pending?status=pending', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; count: number; rows: ReadonlyArray<Row> };
    };
    expect(body.data.status).toBe('pending');
    expect(body.data.count).toBe(2);
    expect(body.data.rows).toHaveLength(2);
  });
});
