/**
 * JC-7 — admin override route tests (5 four-eye cases).
 *
 *   1. propose then approve by a DIFFERENT admin: applies the change,
 *      writes audit chain entry with both ids, emits cockpit pulse.
 *   2. self-approval is REJECTED with four_eye_violation (CLAUDE.md
 *      inviolable).
 *   3. unauthenticated request is 401.
 *   4. reject keeps the tenant on the original country.
 *   5. proposing a no-op (same country) returns 409 no_change.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createAdminTenantJurisdictionRouter,
  type AdminAuditChainWriter,
  type AdminContext,
  type AdminContextResolver,
  type AdminLogger,
  type CockpitPulseEmitter,
  type JurisdictionProposalStore,
  type ProposalRecord,
  type TenantJurisdictionRouteDeps,
  type TenantJurisdictionWriter,
} from '../tenant-jurisdiction.hono';

// ─── Stubs ────────────────────────────────────────────────────────────

interface InMemoryStore extends JurisdictionProposalStore {
  readonly rows: ProposalRecord[];
}

function inMemoryProposalStore(): InMemoryStore {
  const rows: ProposalRecord[] = [];
  return {
    rows,
    async create(input) {
      rows.push({
        proposalId: input.proposalId,
        tenantId: input.tenantId,
        fromCountryCode: input.fromCountryCode,
        toCountryCode: input.toCountryCode,
        reason: input.reason,
        verifiedWith: input.verifiedWith,
        proposedByUserId: input.proposedByUserId,
        proposedAt: input.proposedAt,
        status: 'pending',
      });
    },
    async findById({ tenantId, proposalId }) {
      return rows.find(
        (r) => r.tenantId === tenantId && r.proposalId === proposalId,
      ) ?? null;
    },
    async decide(input) {
      const r = rows.find(
        (row) =>
          row.tenantId === input.tenantId && row.proposalId === input.proposalId,
      );
      if (!r) return;
      const idx = rows.indexOf(r);
      rows[idx] = {
        ...r,
        status: input.status,
        decidedByUserId: input.decidedByUserId,
        decidedAt: input.decidedAt,
        ...(input.decisionNote !== undefined && {
          decisionNote: input.decisionNote,
        }),
      };
    },
    async list(tenantId) {
      const matching = rows.filter((r) => r.tenantId === tenantId);
      return {
        pending: matching.filter((r) => r.status === 'pending'),
        history: matching.filter((r) => r.status !== 'pending'),
      };
    },
  };
}

interface InMemoryTenantWriter extends TenantJurisdictionWriter {
  readonly state: Map<
    string,
    {
      countryCode: string;
      lockedAt: string | null;
      lockedByUserId: string | null;
    }
  >;
  readonly applies: Array<{
    tenantId: string;
    fromCountryCode: string;
    toCountryCode: string;
    lockedByUserId: string;
    lockedAt: string;
  }>;
}

function inMemoryTenantWriter(seed: {
  tenantId: string;
  countryCode: string;
  lockedByUserId: string;
}): InMemoryTenantWriter {
  const state = new Map<
    string,
    {
      countryCode: string;
      lockedAt: string | null;
      lockedByUserId: string | null;
    }
  >();
  state.set(seed.tenantId, {
    countryCode: seed.countryCode,
    lockedAt: '2026-01-01T00:00:00.000Z',
    lockedByUserId: seed.lockedByUserId,
  });
  const applies: Array<{
    tenantId: string;
    fromCountryCode: string;
    toCountryCode: string;
    lockedByUserId: string;
    lockedAt: string;
  }> = [];
  return {
    state,
    applies,
    async getCurrentJurisdiction(tenantId) {
      const row = state.get(tenantId);
      if (!row) return null;
      return {
        countryCode: row.countryCode,
        lockedAt: row.lockedAt,
        lockedByUserId: row.lockedByUserId,
      };
    },
    async applyJurisdictionChange(input) {
      applies.push(input);
      state.set(input.tenantId, {
        countryCode: input.toCountryCode,
        lockedAt: input.lockedAt,
        lockedByUserId: input.lockedByUserId,
      });
    },
  };
}

interface AuditCapture extends AdminAuditChainWriter {
  readonly entries: Array<{
    tenantId: string;
    proposalId: string;
    fromCountryCode: string;
    toCountryCode: string;
    proposedByUserId: string;
    approvedByUserId: string;
    reason: string;
    verifiedWith: string;
  }>;
}

function auditCapture(): AuditCapture {
  const entries: AuditCapture['entries'] = [];
  return {
    entries,
    async appendJurisdictionChange(input) {
      entries.push(input);
    },
  };
}

interface CockpitCapture extends CockpitPulseEmitter {
  readonly emits: Array<{
    tenantId: string;
    fromCountryCode: string;
    toCountryCode: string;
    approvedByUserId: string;
    approvedAt: string;
  }>;
}

function cockpitCapture(): CockpitCapture {
  const emits: CockpitCapture['emits'] = [];
  return {
    emits,
    async emitJurisdictionChanged(input) {
      emits.push(input);
    },
  };
}

function adminResolver(admin: AdminContext | null): AdminContextResolver {
  return {
    resolve() {
      return admin;
    },
  };
}

function silentLogger(): AdminLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function buildDeps(
  options: {
    admin?: AdminContext | null;
    tenantId?: string;
    seedCountry?: string;
  } = {},
): {
  deps: TenantJurisdictionRouteDeps;
  proposals: InMemoryStore;
  tenants: InMemoryTenantWriter;
  audit: AuditCapture;
  cockpit: CockpitCapture;
} {
  const proposals = inMemoryProposalStore();
  const tenants = inMemoryTenantWriter({
    tenantId: options.tenantId ?? 'tn_1',
    countryCode: options.seedCountry ?? 'TZ',
    lockedByUserId: 'usr_owner_1',
  });
  const audit = auditCapture();
  const cockpit = cockpitCapture();
  let proposalSeq = 0;
  const deps: TenantJurisdictionRouteDeps = {
    proposals,
    tenants,
    auditChain: audit,
    cockpit,
    admin: adminResolver(
      options.admin === undefined
        ? { userId: 'admin_a', role: 'ADMIN' }
        : options.admin,
    ),
    logger: silentLogger(),
    now: () => '2026-05-29T12:00:00.000Z',
    newProposalId: () => {
      proposalSeq += 1;
      return `prop_${proposalSeq}`;
    },
  };
  return { deps, proposals, tenants, audit, cockpit };
}

async function postJson(
  app: ReturnType<typeof createAdminTenantJurisdictionRouter>,
  path: string,
  body: unknown,
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Cases ────────────────────────────────────────────────────────────

describe('JC-7 — admin tenant-jurisdiction override (four-eye)', () => {
  it('1. propose then approve by a DIFFERENT admin: applies change + audit + pulse', async () => {
    const { deps, proposals, tenants, audit, cockpit } = buildDeps({
      admin: { userId: 'admin_a', role: 'ADMIN' },
    });
    const app = createAdminTenantJurisdictionRouter(deps);

    // Step 1: PROPOSE as admin_a.
    const proposeRes = await postJson(
      app,
      '/admin/tenants/tn_1/jurisdiction',
      {
        newCountryCode: 'KE',
        reason: 'Tenant moved HQ to Nairobi — verified ticket #4421',
        verifiedWith: 'phone call 2026-05-28, ticket #4421',
      },
    );
    expect(proposeRes.status).toBe(202);
    const proposeBody = await proposeRes.json();
    expect(proposeBody.proposalId).toBe('prop_1');
    expect(proposals.rows).toHaveLength(1);
    expect(proposals.rows[0]!.status).toBe('pending');

    // Step 2: APPROVE as a DIFFERENT admin_b — flips role/identity via
    // a fresh router built with a new resolver.
    const approverDeps = buildDeps({
      admin: { userId: 'admin_b', role: 'SUPER_ADMIN' },
    });
    // Replace proposals/tenants/audit/cockpit with the originals so the
    // four-eye flow sees the same state.
    approverDeps.deps = {
      ...approverDeps.deps,
      proposals,
      tenants,
      auditChain: audit,
      cockpit,
    };
    const approverApp = createAdminTenantJurisdictionRouter(approverDeps.deps);
    const approveRes = await postJson(
      approverApp,
      '/admin/tenants/tn_1/jurisdiction/prop_1/approve',
      { decisionNote: 'Verified second time with owner on call.' },
    );
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    expect(approveBody.applied).toBe(true);
    expect(approveBody.fromCountryCode).toBe('TZ');
    expect(approveBody.toCountryCode).toBe('KE');
    expect(approveBody.proposedBy).toBe('admin_a');
    expect(approveBody.approvedBy).toBe('admin_b');

    // Verify tenant state flipped + lock refreshed.
    expect(tenants.applies).toHaveLength(1);
    expect(tenants.state.get('tn_1')!.countryCode).toBe('KE');
    expect(tenants.state.get('tn_1')!.lockedByUserId).toBe('admin_b');

    // Audit chain captured both admin ids + the verifiedWith string.
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.proposedByUserId).toBe('admin_a');
    expect(audit.entries[0]!.approvedByUserId).toBe('admin_b');
    expect(audit.entries[0]!.reason).toMatch(/Nairobi/);
    expect(audit.entries[0]!.verifiedWith).toMatch(/4421/);

    // Cockpit pulse fired to owner.
    expect(cockpit.emits).toHaveLength(1);
    expect(cockpit.emits[0]!.fromCountryCode).toBe('TZ');
    expect(cockpit.emits[0]!.toCountryCode).toBe('KE');
  });

  it('2. self-approval is REJECTED with four_eye_violation', async () => {
    const { deps, proposals } = buildDeps({
      admin: { userId: 'admin_solo', role: 'ADMIN' },
    });
    const app = createAdminTenantJurisdictionRouter(deps);
    const proposeRes = await postJson(
      app,
      '/admin/tenants/tn_1/jurisdiction',
      {
        newCountryCode: 'KE',
        reason: 'attempting self-approval to test four-eye',
        verifiedWith: 'self attestation',
      },
    );
    expect(proposeRes.status).toBe(202);
    expect(proposals.rows[0]!.proposedByUserId).toBe('admin_solo');

    // Same admin tries to approve — must fail with 409 four_eye_violation.
    const approveRes = await postJson(
      app,
      '/admin/tenants/tn_1/jurisdiction/prop_1/approve',
      {},
    );
    expect(approveRes.status).toBe(409);
    const body = await approveRes.json();
    expect(body.error).toBe('four_eye_violation');
    // Tenant state must NOT have changed.
    const current = await deps.tenants.getCurrentJurisdiction('tn_1');
    expect(current!.countryCode).toBe('TZ');
  });

  it('3. unauthenticated request is 401', async () => {
    const { deps } = buildDeps({ admin: null });
    const app = createAdminTenantJurisdictionRouter(deps);
    const res = await postJson(app, '/admin/tenants/tn_1/jurisdiction', {
      newCountryCode: 'KE',
      reason: 'reason',
      verifiedWith: 'attestation',
    });
    expect(res.status).toBe(401);
  });

  it('4. reject keeps the tenant on the original country', async () => {
    const { deps, proposals, tenants } = buildDeps({
      admin: { userId: 'admin_a', role: 'ADMIN' },
    });
    const app = createAdminTenantJurisdictionRouter(deps);
    const proposeRes = await postJson(
      app,
      '/admin/tenants/tn_1/jurisdiction',
      {
        newCountryCode: 'UG',
        reason: 'tenant claims move, awaiting paperwork',
        verifiedWith: 'ticket #5500',
      },
    );
    expect(proposeRes.status).toBe(202);

    // Different admin rejects.
    const rejectorDeps = buildDeps({
      admin: { userId: 'admin_b', role: 'SUPER_ADMIN' },
    });
    rejectorDeps.deps = {
      ...rejectorDeps.deps,
      proposals,
      tenants,
    };
    const rejectorApp = createAdminTenantJurisdictionRouter(rejectorDeps.deps);
    const rejectRes = await postJson(
      rejectorApp,
      '/admin/tenants/tn_1/jurisdiction/prop_1/reject',
      { decisionNote: 'paperwork incomplete' },
    );
    expect(rejectRes.status).toBe(200);
    const body = await rejectRes.json();
    expect(body.rejected).toBe(true);
    // Tenant country unchanged.
    expect(tenants.state.get('tn_1')!.countryCode).toBe('TZ');
    // Proposal marked rejected.
    expect(proposals.rows[0]!.status).toBe('rejected');
    expect(proposals.rows[0]!.decidedByUserId).toBe('admin_b');
  });

  it('5. proposing the same country returns 409 no_change', async () => {
    const { deps } = buildDeps({
      admin: { userId: 'admin_a', role: 'ADMIN' },
      seedCountry: 'TZ',
    });
    const app = createAdminTenantJurisdictionRouter(deps);
    const res = await postJson(app, '/admin/tenants/tn_1/jurisdiction', {
      newCountryCode: 'TZ',
      reason: 'no-op test',
      verifiedWith: 'test attestation',
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('no_change');
  });
});
