/**
 * Admin superpowers — regulator-pack EXPORT on four-eye approval.
 *
 * The `export_regulator_pack` verb is whitelisted + HIGH_IMPACT, so it lands as
 * pending_approval on propose. This suite proves that on the SECOND-eye approval
 * the handler actually BUILDS + RETURNS a verifiable regulator pack (audit
 * bundle + compliance filings + evidence chain), not just a status flip.
 *
 * The DB stub serves distinct row-sets per table so we can assert the four
 * sections + the bundle hash/signature land in the response.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { vi } from 'vitest';
// Pre-warm the heavy @borjie/database barrel during module-init (it can take
// ~20s to transform in a cold vitest worker). A STATIC import is evaluated
// outside the per-test timeout, so the in-body `await import('../superpowers
// .hono')` stays fast and does not trip the 10s default. (The existing
// superpowers.test.ts is flaky precisely because it omits this.)
import '@borjie/database';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-superpowers-regpack-32-chars-x';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ||
  'test-supabase-superpowers-regpack-32-chars';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'anon-key-aaaaaaaaaaaaaaaaaaaaaaaa';
// Deterministic signing secret so the bundle is signed in the test.
process.env.AUDIT_TRAIL_SIGNING_SECRET =
  process.env.AUDIT_TRAIL_SIGNING_SECRET || 'regpack-test-signing-secret-key';

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

type Row = Record<string, unknown>;

/**
 * Table-aware stub. `select().from(table)` records which table is being read
 * and the where/limit terminal returns that table's seeded rows. The journal
 * candidate is returned for the undoJournal table; the four corpora each return
 * their own rows so the bundle sections are populated.
 */
function makeTableAwareDb(opts: {
  candidate: Row;
  auditEvents: Row[];
  regulatoryFilings: Row[];
  complianceExports: Row[];
  evidenceChain: Row[];
  updateRows: Row[];
}) {
  // Identify a table by a marker we attach to the imported schema objects.
  // We can't see the real Drizzle table here, so we match by call order +
  // a tag the route passes is not available — instead we infer by the
  // selected columns count via a per-from cursor keyed on a label the route
  // does not expose. Simplest robust approach: return rows based on a
  // table-name guess extracted from the Drizzle table's Symbol description.
  function rowsForTable(table: unknown): Row[] {
    const name = tableName(table);
    if (name.includes('audit_events')) return opts.auditEvents;
    if (name.includes('regulatory_filings')) return opts.regulatoryFilings;
    if (name.includes('compliance_exports')) return opts.complianceExports;
    if (name.includes('ai_audit_chain')) return opts.evidenceChain;
    // undo_journal (the candidate lookup)
    return [opts.candidate];
  }

  return {
    async execute(_q: unknown) {
      // GUC re-bind (set_config) — no-op in the stub.
      return [];
    },
    insert(_t: unknown) {
      return {
        values(_v: Row) {
          return { async returning() { return [{ id: 'j_new' }]; } };
        },
      };
    },
    select(_cols?: unknown) {
      return {
        from(table: unknown) {
          const rows = rowsForTable(table);
          const chain: any = {
            where() { return chain; },
            orderBy() { return chain; },
            limit() { return Promise.resolve(rows); },
          };
          return chain;
        },
      };
    },
    update(_t: unknown) {
      return {
        set(input: Row) {
          return {
            where() {
              return {
                async returning() {
                  const merged = { ...opts.candidate, ...input };
                  opts.updateRows.push(merged);
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

/** Best-effort table-name extraction from a Drizzle pgTable object. */
function tableName(table: unknown): string {
  if (!table || typeof table !== 'object') return '';
  const syms = Object.getOwnPropertySymbols(table);
  for (const s of syms) {
    const desc = String(s.description ?? '');
    if (desc.toLowerCase().includes('name')) {
      const v = (table as Record<symbol, unknown>)[s];
      if (typeof v === 'string') return v;
    }
  }
  // Fallback: scan own string values for a snake_case table-ish token.
  for (const v of Object.values(table as Record<string, unknown>)) {
    if (typeof v === 'string' && v.includes('_')) return v;
  }
  return '';
}

async function buildApp(db: unknown, userId: string) {
  const { adminSuperpowersRouter } = await import('../superpowers.hono');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as unknown as never, {
      tenantId: 'admin_tn',
      userId,
      role: 'SUPER_ADMIN',
    } as unknown as never);
    c.set('db' as unknown as never, db as unknown as never);
    await next();
  });
  app.route('/admin/superpowers', adminSuperpowersRouter);
  return app;
}

describe('admin export_regulator_pack — verifiable bundle on approval', { timeout: 30_000 }, () => {
  it('returns a four-section, hash+signature bundle when the second admin approves', async () => {
    const candidate: Row = {
      id: 'j_regpack',
      tenantId: 'admin_tn',
      actorId: 'admin_a',
      entityType: 'tenant_orgs',
      entityId: 'tn_target',
      provenance: {
        requires_four_eye: true,
        status: 'pending_approval',
        // The bulk route stamps the action + reason in provenance.
        reason: 'regulator-disclosure-request-2026Q2',
      },
      afterState: { action: 'export_regulator_pack', payload: {} },
    };
    const updateRows: Row[] = [];
    const db = makeTableAwareDb({
      candidate,
      auditEvents: [
        { id: 'ae_1', action: 'PAYMENT.create', outcome: 'SUCCESS' },
        { id: 'ae_2', action: 'LEASE.terminate', outcome: 'DENIED' },
      ],
      regulatoryFilings: [{ id: 'rf_1', regulator: 'tra', status: 'submitted' }],
      complianceExports: [{ id: 'ce_1', exportType: 'tz_tra', status: 'ready' }],
      evidenceChain: [
        { sequenceId: 1, thisHash: 'h1', prevHash: 'GENESIS', action: 'a' },
        { sequenceId: 2, thisHash: 'h2', prevHash: 'h1', action: 'b' },
      ],
      updateRows,
    });

    const app = await buildApp(db, 'admin_b');
    const res = await app.request(
      '/admin/superpowers/bulk-action/j_regpack/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisionNote: 'disclosure approved by counsel' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        applied: boolean;
        regulatorPack?: {
          tenantId: string;
          bundleHash: string;
          bundleSignature: string | null;
          counts: Record<string, number>;
          sections: Record<string, unknown[]>;
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.applied).toBe(true);
    // The verifiable bundle is present + populated.
    const pack = body.data.regulatorPack;
    expect(pack).toBeDefined();
    expect(pack?.tenantId).toBe('tn_target');
    expect(pack?.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pack?.bundleSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(pack?.counts).toMatchObject({
      auditEvents: 2,
      regulatoryFilings: 1,
      complianceExports: 1,
      evidenceChain: 2,
    });
    expect(pack?.sections.auditEvents).toHaveLength(2);
  });

  it('still flips a NON-regulator-pack HIGH action to applied without a bundle', async () => {
    const candidate: Row = {
      id: 'j_suspend',
      tenantId: 'admin_tn',
      actorId: 'admin_a',
      entityType: 'tenant_orgs',
      entityId: 'tn_target',
      provenance: { requires_four_eye: true, status: 'pending_approval' },
      afterState: { action: 'suspend', payload: {} },
    };
    const updateRows: Row[] = [];
    const db = makeTableAwareDb({
      candidate,
      auditEvents: [],
      regulatoryFilings: [],
      complianceExports: [],
      evidenceChain: [],
      updateRows,
    });
    const app = await buildApp(db, 'admin_b');
    const res = await app.request(
      '/admin/superpowers/bulk-action/j_suspend/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { applied: boolean; regulatorPack?: unknown };
    };
    expect(body.data.applied).toBe(true);
    expect(body.data.regulatorPack).toBeUndefined();
  });
});
