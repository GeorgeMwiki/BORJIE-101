/**
 * Wave-6 closure — MOUNTED jurisdiction four-eye route, end-to-end.
 *
 * The isolated factory test (routes/admin/__tests__/tenant-jurisdiction.test.ts)
 * exercises the router with hand-rolled fakes. This test exercises the
 * MOUNTED route through the REAL composition-root Drizzle adapters
 * (createJurisdictionOverrideRouteDeps → SQL stores + canonical audit
 * recorder + cockpit pulse) against an in-memory SQL executor that
 * faithfully models the `jurisdiction_proposals` + `tenants` +
 * `audit_trail_entries` + `tab_event_log` tables.
 *
 * MANDATORY four-eye assertions (the inviolable):
 *   - PROPOSE as admin_a then APPROVE as a DIFFERENT admin_b → 200 applied
 *     AND the tenant's country flips AND an audit row is appended.
 *   - SELF-approval by admin_a → 409 four_eye_violation (the gate stays
 *     enforced end-to-end through the mounted handler, not just the
 *     isolated factory).
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  createAdminTenantJurisdictionRouter,
  type AdminContext,
} from '../../routes/admin/tenant-jurisdiction.hono.js';
import {
  createJurisdictionProposalStore,
  createTenantJurisdictionWriter,
  createAdminJurisdictionAuditChainWriter,
  createJurisdictionCockpitPulseEmitter,
} from '../jurisdiction-override-wiring.js';

// ─────────────────────────────────────────────────────────────────────
// In-memory SQL executor — models the four tables the adapters touch by
// recognising each statement and applying it to plain-object state. The
// bound params are pulled off drizzle's `sql` query object (Param nodes
// carry `.value`; string chunks carry `.value: string[]`).
// ─────────────────────────────────────────────────────────────────────

function decompose(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: ReadonlyArray<unknown> })
    ?.queryChunks;
  if (!Array.isArray(chunks)) return { text: String(query), params: [] };
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const c of chunks) {
    // A `StringChunk` carries `.value: string[]` (the literal SQL text).
    const sv = (c as { value?: unknown })?.value;
    if (Array.isArray(sv)) {
      parts.push(sv.join(' '));
      continue;
    }
    if (typeof sv === 'string') {
      parts.push(sv);
      continue;
    }
    // A drizzle `Param` node nests the bound value under `.value`.
    if (sv !== undefined && sv !== null && typeof sv === 'object' && 'value' in (sv as object)) {
      parts.push(' ? ');
      params.push((sv as { value: unknown }).value);
      continue;
    }
    // Otherwise the chunk IS the bound value itself (a boxed
    // String/Number/etc, or a plain primitive embedded by sql``).
    parts.push(' ? ');
    params.push(typeof c === 'object' ? String(c) : c);
  }
  return { text: parts.join(' '), params };
}

interface TenantRow {
  id: string;
  country: string | null;
  country_code: string;
  jurisdiction_locked_at: string | null;
  jurisdiction_locked_by_user_id: string | null;
}

interface ProposalRow {
  proposal_id: string;
  tenant_id: string;
  from_country_code: string;
  to_country_code: string;
  reason: string;
  verified_with: string;
  proposed_by_user_id: string;
  proposed_at: string;
  status: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

function createInMemoryDb(seedTenant: TenantRow) {
  const tenants = new Map<string, TenantRow>([[seedTenant.id, seedTenant]]);
  const proposals = new Map<string, ProposalRow>();
  const auditRows: Record<string, unknown>[] = [];
  const pulseRows: Record<string, unknown>[] = [];

  return {
    tenants,
    proposals,
    auditRows,
    pulseRows,
    db: {
      async execute(query: unknown): Promise<unknown> {
        const { text, params } = decompose(query);

        // ── jurisdiction_proposals INSERT ──────────────────────────────
        if (/INSERT INTO\s+jurisdiction_proposals/i.test(text)) {
          const [
            proposalId,
            tenantId,
            fromCountryCode,
            toCountryCode,
            reason,
            verifiedWith,
            proposedByUserId,
            proposedAt,
          ] = params as string[];
          if (!proposals.has(proposalId!)) {
            proposals.set(proposalId!, {
              proposal_id: proposalId!,
              tenant_id: tenantId!,
              from_country_code: fromCountryCode!,
              to_country_code: toCountryCode!,
              reason: reason!,
              verified_with: verifiedWith!,
              proposed_by_user_id: proposedByUserId!,
              proposed_at: proposedAt!,
              status: 'pending',
              decided_by_user_id: null,
              decided_at: null,
              decision_note: null,
            });
          }
          return { rows: [] };
        }

        // ── jurisdiction_proposals UPDATE (decide) ─────────────────────
        if (/UPDATE\s+jurisdiction_proposals/i.test(text)) {
          const [status, decidedBy, decidedAt, decisionNote, tenantId, proposalId] =
            params as (string | null)[];
          const row = proposals.get(proposalId as string);
          if (row && row.status === 'pending') {
            row.status = status as string;
            row.decided_by_user_id = decidedBy as string;
            row.decided_at = decidedAt as string;
            row.decision_note = (decisionNote as string) ?? null;
          }
          return { rows: [] };
        }

        // ── jurisdiction_proposals SELECT (findById / list) ────────────
        if (/FROM\s+jurisdiction_proposals/i.test(text)) {
          const all = [...proposals.values()];
          // list() filters by tenant only; findById filters by tenant + id.
          const tenantId = params[0] as string;
          const proposalId = params.length > 1 ? (params[1] as string) : null;
          const matched = all.filter(
            (r) =>
              r.tenant_id === tenantId &&
              (proposalId == null || r.proposal_id === proposalId),
          );
          return { rows: matched };
        }

        // ── tenants SELECT ─────────────────────────────────────────────
        if (/FROM\s+tenants/i.test(text)) {
          const tenantId = params[0] as string;
          const row = tenants.get(tenantId);
          return { rows: row ? [row] : [] };
        }

        // ── tenants UPDATE ─────────────────────────────────────────────
        if (/UPDATE\s+tenants/i.test(text)) {
          const [country, countryCode, lockedAt, lockedBy, tenantId] =
            params as string[];
          const row = tenants.get(tenantId!);
          if (row) {
            row.country = country!;
            row.country_code = countryCode!;
            row.jurisdiction_locked_at = lockedAt!;
            row.jurisdiction_locked_by_user_id = lockedBy!;
          }
          return { rows: [] };
        }

        // ── audit_trail_entries — recorder getLatest + insert ──────────
        if (/FROM\s+audit_trail_entries/i.test(text)) {
          // getLatest — return the most-recent appended row (or none).
          return { rows: auditRows.length ? [auditRows[auditRows.length - 1]] : [] };
        }
        if (/INSERT INTO\s+audit_trail_entries/i.test(text)) {
          auditRows.push({ inserted: true, params });
          return { rows: [] };
        }

        // ── tab_event_log INSERT (cockpit pulse) ───────────────────────
        if (/INSERT INTO\s+tab_event_log/i.test(text)) {
          pulseRows.push({ params });
          return { rows: [] };
        }

        // Default — empty result.
        return { rows: [] };
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Build the mounted router with the REAL Drizzle adapters but a
// header-driven admin resolver (so we exercise the four-eye + persistence
// path without minting real Supabase JWTs — the auth wrapper's 401 is
// covered by the separate guard test below).
// ─────────────────────────────────────────────────────────────────────

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

function headerAdminResolver() {
  return {
    resolve(req: Request): AdminContext | null {
      const userId = req.headers.get('x-test-admin-id');
      const role = req.headers.get('x-test-admin-role') as
        | AdminContext['role']
        | null;
      if (!userId || !role) return null;
      return { userId, role };
    },
  };
}

function mountRealAdapters(seedTenant: TenantRow) {
  const mem = createInMemoryDb(seedTenant);
  const router = createAdminTenantJurisdictionRouter({
    proposals: createJurisdictionProposalStore(mem.db),
    tenants: createTenantJurisdictionWriter(mem.db),
    auditChain: createAdminJurisdictionAuditChainWriter(mem.db, {
      signingSecret: 'test-secret',
    }),
    cockpit: createJurisdictionCockpitPulseEmitter(mem.db, silentLogger),
    admin: headerAdminResolver(),
    logger: silentLogger,
    now: () => '2026-06-09T00:00:00.000Z',
    newProposalId: (() => {
      let n = 0;
      return () => `jcp_test_${++n}`;
    })(),
  });
  const app = new Hono();
  app.route('/', router);
  return { app, mem };
}

const TENANT_ID = 'tenant-acme';
const ADMIN_A = { 'x-test-admin-id': 'admin_a', 'x-test-admin-role': 'ADMIN' };
const ADMIN_B = {
  'x-test-admin-id': 'admin_b',
  'x-test-admin-role': 'SUPER_ADMIN',
};

function seed(): TenantRow {
  return {
    id: TENANT_ID,
    country: 'TZ',
    country_code: 'TZ',
    jurisdiction_locked_at: '2026-01-01T00:00:00.000Z',
    jurisdiction_locked_by_user_id: 'signup',
  };
}

describe('jurisdiction four-eye — mounted route, real Drizzle adapters', () => {
  it('PROPOSE (admin_a) -> APPROVE (admin_b) applies the change + appends audit', async () => {
    const { app, mem } = mountRealAdapters(seed());

    // 1. PROPOSE as admin_a.
    const proposeRes = await app.request(
      `/admin/tenants/${TENANT_ID}/jurisdiction`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ADMIN_A },
        body: JSON.stringify({
          newCountryCode: 'KE',
          reason: 'tenant legally re-domiciled to Kenya',
          verifiedWith: 'support ticket #4821 + phone callback',
        }),
      },
    );
    expect(proposeRes.status).toBe(202);
    const proposeBody = (await proposeRes.json()) as {
      proposalId: string;
      proposedBy: string;
    };
    expect(proposeBody.proposedBy).toBe('admin_a');
    const proposalId = proposeBody.proposalId;

    // 2. APPROVE as admin_b (DIFFERENT admin — four-eye satisfied).
    const approveRes = await app.request(
      `/admin/tenants/${TENANT_ID}/jurisdiction/${proposalId}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ADMIN_B },
        body: JSON.stringify({ decisionNote: 'verified, approved' }),
      },
    );
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as {
      applied: boolean;
      fromCountryCode: string;
      toCountryCode: string;
      approvedBy: string;
    };
    expect(approveBody.applied).toBe(true);
    expect(approveBody.fromCountryCode).toBe('TZ');
    expect(approveBody.toCountryCode).toBe('KE');
    expect(approveBody.approvedBy).toBe('admin_b');

    // The tenant row actually flipped.
    expect(mem.tenants.get(TENANT_ID)?.country_code).toBe('KE');
    expect(mem.tenants.get(TENANT_ID)?.jurisdiction_locked_by_user_id).toBe(
      'admin_b',
    );
    // An audit row was appended (append-only canonical chain).
    expect(mem.auditRows.length).toBeGreaterThan(0);
    // The proposal is now approved.
    expect(mem.proposals.get(proposalId)?.status).toBe('approved');
  });

  it('SELF-approval by the proposer is rejected 409 four_eye_violation', async () => {
    const { app, mem } = mountRealAdapters(seed());

    const proposeRes = await app.request(
      `/admin/tenants/${TENANT_ID}/jurisdiction`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ADMIN_A },
        body: JSON.stringify({
          newCountryCode: 'UG',
          reason: 'attempted self-approved jurisdiction move',
          verifiedWith: 'self only — should be blocked',
        }),
      },
    );
    expect(proposeRes.status).toBe(202);
    const { proposalId } = (await proposeRes.json()) as { proposalId: string };

    // admin_a tries to approve their OWN proposal — must be blocked.
    const approveRes = await app.request(
      `/admin/tenants/${TENANT_ID}/jurisdiction/${proposalId}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ADMIN_A },
        body: JSON.stringify({}),
      },
    );
    expect(approveRes.status).toBe(409);
    const body = (await approveRes.json()) as { error: string };
    expect(body.error).toBe('four_eye_violation');

    // The tenant did NOT change, and the proposal is still pending.
    expect(mem.tenants.get(TENANT_ID)?.country_code).toBe('TZ');
    expect(mem.proposals.get(proposalId)?.status).toBe('pending');
    // No audit row for an unapproved change.
    expect(mem.auditRows.length).toBe(0);
  });

  it('unauthenticated request (no admin context) is 401', async () => {
    const { app } = mountRealAdapters(seed());
    const res = await app.request(
      `/admin/tenants/${TENANT_ID}/jurisdiction`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newCountryCode: 'KE',
          reason: 'no auth attached',
          verifiedWith: 'none',
        }),
      },
    );
    expect(res.status).toBe(401);
  });
});
