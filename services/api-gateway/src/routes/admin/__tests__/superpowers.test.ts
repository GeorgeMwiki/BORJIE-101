/**
 * Admin superpowers — bulk-action route contract tests.
 *
 * Wraps the route in a stubbed auth + database harness and validates:
 *   - whitelist enforcement (admin entity types + admin verbs only)
 *   - HIGH-impact verbs land as pending_approval
 *   - standard verbs land as applied immediately
 *   - the per-row journal manifest + counter shape
 *   - the four-eye approval endpoint refuses the same-actor + already-applied paths
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

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
  // Pass-through requireRole — the test harness pins `auth.role` directly
  // through the parent middleware.
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// ─── Drizzle stub ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface DbState {
  insertRows: Row[];
  selectRows: Row[];
  updateRows: Row[];
  insertCalls: number;
}

function makeDbStub(state: DbState) {
  return {
    insert(_table: unknown) {
      return {
        values(input: Record<string, unknown>) {
          return {
            async returning() {
              state.insertCalls += 1;
              const row = {
                ...input,
                id: `j_${state.insertCalls}`,
                performedAt: new Date(),
                windowSeconds: input.windowSeconds ?? 300,
              };
              state.insertRows.push(row);
              return [row];
            },
          };
        },
      };
    },
    select() {
      return {
        from(_table: unknown) {
          return {
            where(_w: unknown) {
              return {
                async limit(_n: number) {
                  return state.selectRows;
                },
              };
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(input: Record<string, unknown>) {
          return {
            where(_w: unknown) {
              return {
                async returning() {
                  if (state.selectRows.length === 0) return [];
                  const merged = { ...state.selectRows[0], ...input };
                  state.updateRows.push(merged);
                  return [merged];
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

async function buildAdminApp(state: DbState, auth: AuthShape) {
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

describe('admin /bulk-action — whitelist + 4-eye gating', () => {
  it('rejects an action not on the admin whitelist with 400', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildAdminApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'SUPER_ADMIN',
    });
    const res = await app.request('/admin/superpowers/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'tenant_orgs',
        ids: ['t_a'],
        // `snooze` is owner-only — should fail the admin enum.
        action: 'snooze',
        reason: 'should not land',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing reason (admin reason min 8 chars)', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildAdminApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'SUPER_ADMIN',
    });
    const res = await app.request('/admin/superpowers/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'feature_flags',
        ids: ['flag_a'],
        action: 'enable',
        reason: 'oops',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('lands a standard verb (archive on intelligence_corpus) as applied', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildAdminApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'ADMIN',
    });
    const res = await app.request('/admin/superpowers/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'intelligence_corpus',
        ids: ['chunk_a', 'chunk_b'],
        action: 'archive',
        reason: 'stale-source-cleanup-2026Q2',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        requiresFourEye: boolean;
        status: string;
        processed: number;
        undoJournalIds: ReadonlyArray<string>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.requiresFourEye).toBe(false);
    expect(body.data.status).toBe('applied');
    expect(body.data.processed).toBe(2);
    expect(body.data.undoJournalIds).toHaveLength(2);
  });

  it('lands a HIGH-impact verb (suspend tenant_orgs) as pending_approval', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildAdminApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'SUPPORT',
    });
    const res = await app.request('/admin/superpowers/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'tenant_orgs',
        ids: ['t_a'],
        action: 'suspend',
        reason: 'sanctioned-entity-list-match-2026',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        requiresFourEye: boolean;
        status: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.requiresFourEye).toBe(true);
    expect(body.data.status).toBe('pending_approval');
    // Each journal row records requires_four_eye=true in provenance.
    expect(state.insertRows[0]?.provenance).toMatchObject({
      requires_four_eye: true,
      status: 'pending_approval',
    });
  });
});

describe('admin /bulk-action/:journalId/approve — 4-eye flow', () => {
  it('rejects approval by the SAME actor as the proposer with 409', async () => {
    const journalRow: Row = {
      id: 'j_test',
      tenantId: 'admin_tn',
      actorId: 'admin_a',
      entityType: 'tenant_orgs',
      entityId: 't_a',
      provenance: { requires_four_eye: true, status: 'pending_approval' },
    };
    const state: DbState = {
      insertRows: [],
      selectRows: [journalRow],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildAdminApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_a',
      role: 'SUPER_ADMIN',
    });
    const res = await app.request(
      '/admin/superpowers/bulk-action/j_test/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionNote: 'self-approval attempt' }),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe('FOUR_EYE_SAME_ACTOR');
  });

  it('approves when the second admin differs from the proposer', async () => {
    const journalRow: Row = {
      id: 'j_test',
      tenantId: 'admin_tn',
      actorId: 'admin_a',
      entityType: 'tenant_orgs',
      entityId: 't_a',
      provenance: { requires_four_eye: true, status: 'pending_approval' },
    };
    const state: DbState = {
      insertRows: [],
      selectRows: [journalRow],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildAdminApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_b',
      role: 'ADMIN',
    });
    const res = await app.request(
      '/admin/superpowers/bulk-action/j_test/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionNote: 'verified out of band' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { applied: boolean; entityId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.applied).toBe(true);
    expect(body.data.entityId).toBe('t_a');
    // The update set provenance.status=applied + recorded approver.
    expect(state.updateRows[0]?.provenance).toMatchObject({
      status: 'applied',
      approved_by_user_id: 'admin_b',
    });
  });

  it('rejects approval of a row that was not flagged for 4-eye', async () => {
    const journalRow: Row = {
      id: 'j_test',
      tenantId: 'admin_tn',
      actorId: 'admin_a',
      entityType: 'feature_flags',
      entityId: 'flag_a',
      provenance: { requires_four_eye: false, status: 'applied' },
    };
    const state: DbState = {
      insertRows: [],
      selectRows: [journalRow],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildAdminApp(state, {
      tenantId: 'admin_tn',
      userId: 'admin_b',
      role: 'ADMIN',
    });
    const res = await app.request(
      '/admin/superpowers/bulk-action/j_test/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe('FOUR_EYE_NOT_REQUIRED');
  });
});
