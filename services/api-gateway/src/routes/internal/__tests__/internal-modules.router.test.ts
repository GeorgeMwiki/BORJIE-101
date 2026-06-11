/**
 * internal/modules.hono — the self-BUILDING loop (W3c).
 *
 * Proves the two load-bearing invariants of the slice:
 *   1. A seeded capability gap is driven to a STORED PROPOSAL with
 *      spec status = 'proposed' via a real DRY-RUN (the orchestrator runs the
 *      REAL module-spec-engine validate/compile/dry-run + the REAL
 *      module-orchestrator FORCE-RLS gate against an in-memory proposal store —
 *      nothing is applied to any running system).
 *   2. The route is ROLE-GATED: no token → 401; a non-SUPER_ADMIN token → 403;
 *      a SUPER_ADMIN token → 201. Approval records PROPOSED → APPROVED and
 *      NEVER applies the migration.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import internalModulesRouter, {
  type SelfBuildGapSource,
} from '../modules.hono.js';
import {
  createSelfBuildOrchestrator,
  createSelfBuildIdGen,
  type SelfBuildProposalStore,
  type PersistProposalArgs,
  type RecordedGap,
} from '../../../composition/self-build/index.js';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

/** An in-memory proposal store with the same surface as the Drizzle one. */
function inMemoryProposalStore(): SelfBuildProposalStore & {
  rows: () => ReadonlyArray<{ args: PersistProposalArgs; status: string; state: string }>;
} {
  const records: Array<{ args: PersistProposalArgs; status: string; state: string }> = [];
  return {
    rows: () => records,
    async persistProposal(args) {
      records.push({ args, status: 'proposed', state: 'PROPOSED' });
      return { moduleId: args.moduleId, specId: args.specId };
    },
    async listProposals({ tenantId }) {
      return records
        .filter((r) => r.args.tenantId === tenantId)
        .map((r) => ({
          moduleId: r.args.moduleId,
          specId: r.args.specId,
          slug: r.args.slug,
          title: r.args.title,
          titleSw: r.args.titleSw,
          lifecycleState: r.state,
          specStatus: r.status,
          createdAtMs: 0,
        }));
    },
    async getProposal({ tenantId, moduleId }) {
      const r = records.find(
        (x) => x.args.tenantId === tenantId && x.args.moduleId === moduleId,
      );
      if (!r) return null;
      return {
        moduleId: r.args.moduleId,
        specId: r.args.specId,
        slug: r.args.slug,
        title: r.args.title,
        titleSw: r.args.titleSw,
        lifecycleState: r.state,
        specStatus: r.status,
        specJsonb: r.args.specJsonb,
        generatedMigrationSql: r.args.generatedMigrationSql,
        createdAtMs: 0,
      };
    },
    async recordApproval({ tenantId, moduleId }) {
      const r = records.find(
        (x) => x.args.tenantId === tenantId && x.args.moduleId === moduleId,
      );
      if (!r || r.state !== 'PROPOSED') return false;
      r.state = 'APPROVED';
      return true;
    },
  };
}

function seededGap(tenantId = 'tenant_1'): RecordedGap {
  return {
    id: 'cmt_gap_royalty_001',
    tenantId,
    gapKind: 'unwired_organ',
    kind: 'royalty.reconcile',
    title: 'Royalty reconciliation ledger',
    titleSw: 'Daftari la upatanishi wa mrabaha',
    rationale: 'The royalty reconcile organ is unwired; record-keeping is missing.',
    competenceDomain: 'royalty',
    unblockTrigger: { kind: 'feature_shipped', target: 'royalty.reconcile.v1' },
  };
}

function fakeGapSource(gap: RecordedGap | null): SelfBuildGapSource {
  return {
    async getGap(tenantId, gapId) {
      if (!gap) return null;
      return gap.tenantId === tenantId && gap.id === gapId ? gap : null;
    },
  };
}

/** Mount the router with injected (real orchestrator + fake gap source). */
function appWith(opts: {
  gap: RecordedGap | null;
  tenantId?: string;
}): { app: Hono; store: ReturnType<typeof inMemoryProposalStore> } {
  const store = inMemoryProposalStore();
  const orchestrator = createSelfBuildOrchestrator({
    store,
    ids: createSelfBuildIdGen(),
    logger: silentLogger(),
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    // No DB: the audit append + db-derived path degrade gracefully because the
    // orchestrator + gap source are injected.
    c.set('services', {
      selfBuildOrchestrator: orchestrator,
      selfBuildGapSource: fakeGapSource(opts.gap),
    } as never);
    await next();
  });
  app.route('/internal/modules', internalModulesRouter);
  return { app, store };
}

function bearer(role: UserRole, tenantId = 'tenant_1'): string {
  return `Bearer ${generateToken({
    userId: 'op_1',
    tenantId,
    role: role as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

// ---------------------------------------------------------------------------
// Role gating
// ---------------------------------------------------------------------------

describe('internal/modules — role gating', () => {
  it('401 without a token', async () => {
    const { app } = appWith({ gap: seededGap() });
    const res = await app.request('/internal/modules/propose', {
      method: 'POST',
      body: JSON.stringify({ gapId: 'cmt_gap_royalty_001' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('403 for a non-SUPER_ADMIN role', async () => {
    const { app } = appWith({ gap: seededGap() });
    const res = await app.request('/internal/modules/propose', {
      method: 'POST',
      body: JSON.stringify({ gapId: 'cmt_gap_royalty_001' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.TENANT_ADMIN),
      },
    });
    expect(res.status).toBe(403);
  });

  it('403 for the list route too (every route is SUPER_ADMIN gated)', async () => {
    const { app } = appWith({ gap: seededGap() });
    const res = await app.request('/internal/modules', {
      headers: { authorization: bearer(UserRole.ACCOUNTANT) },
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Gap → proposal (dry-run, never applied)
// ---------------------------------------------------------------------------

describe('internal/modules — seeded gap → stored proposal', () => {
  it('drives a gap to a PROPOSAL with spec status=proposed via a dry-run', async () => {
    const { app, store } = appWith({ gap: seededGap() });
    const res = await app.request('/internal/modules/propose', {
      method: 'POST',
      body: JSON.stringify({ gapId: 'cmt_gap_royalty_001' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.SUPER_ADMIN),
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        moduleId: string;
        specId: string;
        moduleSlug: string;
        specStatus: string;
        applied: boolean;
        dryRun: { tableCount: number };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.specStatus).toBe('proposed');
    // NEVER applied on this path.
    expect(body.data.applied).toBe(false);
    expect(body.data.dryRun.tableCount).toBeGreaterThanOrEqual(1);

    // The proposal is durably stored as 'proposed' / 'PROPOSED', with the
    // RLS-gated migration SQL captured (the dry-run ran for real).
    const rows = store.rows();
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('proposed');
    expect(rows[0]?.state).toBe('PROPOSED');
    expect(rows[0]?.args.generatedMigrationSql).toContain('CREATE TABLE');
    expect(rows[0]?.args.generatedMigrationSql).toContain('ROW LEVEL SECURITY');
  });

  it('404 when the gap id is unknown', async () => {
    const { app } = appWith({ gap: seededGap() });
    const res = await app.request('/internal/modules/propose', {
      method: 'POST',
      body: JSON.stringify({ gapId: 'cmt_missing' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.SUPER_ADMIN),
      },
    });
    expect(res.status).toBe(404);
  });

  it('400 on an invalid body', async () => {
    const { app } = appWith({ gap: seededGap() });
    const res = await app.request('/internal/modules/propose', {
      method: 'POST',
      body: JSON.stringify({ notGapId: 1 }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.SUPER_ADMIN),
      },
    });
    expect(res.status).toBe(400);
  });

  it('lists the proposal, fetches it, and records approval (PROPOSED → APPROVED, not applied)', async () => {
    const { app } = appWith({ gap: seededGap() });
    const proposeRes = await app.request('/internal/modules/propose', {
      method: 'POST',
      body: JSON.stringify({ gapId: 'cmt_gap_royalty_001' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(UserRole.SUPER_ADMIN),
      },
    });
    const { data: proposed } = (await proposeRes.json()) as {
      data: { moduleId: string };
    };

    const listRes = await app.request('/internal/modules', {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: { proposals: Array<{ moduleId: string; specStatus: string }> };
    };
    expect(listBody.data.proposals.some((p) => p.moduleId === proposed.moduleId)).toBe(true);

    const getRes = await app.request(`/internal/modules/${proposed.moduleId}`, {
      headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(getRes.status).toBe(200);

    const approveRes = await app.request(
      `/internal/modules/${proposed.moduleId}/approve`,
      {
        method: 'POST',
        headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
      },
    );
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as {
      data: { lifecycleState: string; applied: boolean };
    };
    expect(approveBody.data.lifecycleState).toBe('APPROVED');
    // Approval is NOT apply.
    expect(approveBody.data.applied).toBe(false);

    // A second approve is a no-op conflict (already APPROVED, not PROPOSED).
    const reApprove = await app.request(
      `/internal/modules/${proposed.moduleId}/approve`,
      {
        method: 'POST',
        headers: { authorization: bearer(UserRole.SUPER_ADMIN) },
      },
    );
    expect(reApprove.status).toBe(409);
  });
});
