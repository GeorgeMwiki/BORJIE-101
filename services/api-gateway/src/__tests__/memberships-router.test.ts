/**
 * /api/v1/memberships — the SC-4 pairing surface, driven end-to-end over the
 * in-memory repository twins + a stubbed shadow-user provisioner.
 *
 * Covers the corrected-model contract at the HTTP layer:
 *   - mode (a): mint invite (org-side, admin-gated) → redeem → ACTIVE;
 *     employment redeems provision a shadow user, buyer redeems NEVER do;
 *   - mode (b): request against a discoverable org → 202 PENDING →
 *     approve (employment provisions the shadow at APPROVE time) / reject;
 *     non-discoverable orgs are indistinguishable from missing (404);
 *   - org-side lifecycle: queue read, revoke, block — all org-scoped and
 *     role-gated (a buyer-role caller gets 403);
 *   - leave (member-initiated).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createInMemoryOrgMembershipRepository,
  createInMemoryIdentityRepository,
} from '@borjie/database';
import { generateToken } from '../middleware/auth';
import { UserRole } from '../types/user-role';
import { createMembershipsRouter } from '../routes/memberships.hono';
import { clearActiveTenantCache } from '../middleware/active-tenant-override';

const WORKER_SUB = 'a0000000-0000-0000-0000-000000000001';
const BUYER_SUB = 'a0000000-0000-0000-0000-000000000002';
const ADMIN_SUB = 'a0000000-0000-0000-0000-000000000003';
const TENANT = 'b0000000-0000-0000-0000-00000000000a';
const ORG = 'org_test_1';

function bearer(sub: string, role: UserRole, email: string): string {
  return `Bearer ${generateToken({
    userId: sub,
    tenantId: TENANT,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
    email,
  } as never)}`;
}

const workerAuth = () =>
  bearer(WORKER_SUB, UserRole.MAINTENANCE_STAFF, 'worker@example.com');
const buyerAuth = () =>
  bearer(BUYER_SUB, UserRole.RESIDENT, 'buyer@example.com');
const adminAuth = () =>
  bearer(ADMIN_SUB, UserRole.OWNER, 'owner@example.com');

interface Harness {
  app: Hono;
  membershipRepo: ReturnType<typeof createInMemoryOrgMembershipRepository>;
  identityRepo: ReturnType<typeof createInMemoryIdentityRepository>;
  shadowCalls: Array<Record<string, unknown>>;
}

function buildHarness(opts?: { orgDiscoverable?: boolean }): Harness {
  const membershipRepo = createInMemoryOrgMembershipRepository();
  const identityRepo = createInMemoryIdentityRepository();
  const shadowCalls: Array<Record<string, unknown>> = [];
  const discoverable = opts?.orgDiscoverable ?? true;

  const router = createMembershipsRouter({
    membershipRepo,
    identityRepo,
    provisionShadow: (async (input: Record<string, unknown>) => {
      shadowCalls.push(input);
      return `usr_shadow_${String(input.supabaseUserId).slice(-4)}`;
    }) as never,
  });

  const app = new Hono();
  // Pre-inject the db stub: org lookups (own-tenant + discoverable) and
  // the decorative name queries route through execute().
  app.use('*', async (c, next) => {
    c.set('db', {
      execute: async (q: unknown) => {
        const sqlText =
          typeof q === 'object' && q !== null && 'queryChunks' in q
            ? JSON.stringify((q as { queryChunks: unknown }).queryChunks)
            : JSON.stringify(q);
        if (sqlText.includes('FROM organizations') || sqlText.includes('UPDATE organizations')) {
          if (sqlText.includes('discoverable = true') && !discoverable) {
            return [];
          }
          return [
            { id: ORG, tenant_id: TENANT, discoverable, name: 'Kilima Pit A' },
          ];
        }
        return [];
      },
    } as never);
    await next();
  });
  app.route('/memberships', router);
  return { app, membershipRepo, identityRepo, shadowCalls };
}

async function json(res: Response): Promise<Record<string, never>> {
  return (await res.json()) as Record<string, never>;
}

beforeEach(() => {
  clearActiveTenantCache();
});

describe('pairing mode (a) — invite mint + redeem', () => {
  it('org admin mints an invite; a worker redeems it into an ACTIVE insider membership', async () => {
    const h = buildHarness();
    const mint = await h.app.request(`/memberships/org/${ORG}/invites`, {
      method: 'POST',
      headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultRoleId: 'driller' }),
    });
    expect(mint.status).toBe(201);
    const minted = (await json(mint)) as {
      data: { code: string; deepLink: string };
    };
    expect(minted.data.deepLink).toContain(minted.data.code);

    const redeem = await h.app.request('/memberships/redeem', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.data.code }),
    });
    expect(redeem.status).toBe(200);
    const body = (await json(redeem)) as {
      data: { status: string; relationshipType: string };
    };
    expect(body.data.status).toBe('ACTIVE');
    expect(body.data.relationshipType).toBe('employment');
    // The insider shadow user WAS provisioned, in the invite's tenant.
    expect(h.shadowCalls).toHaveLength(1);
    expect(h.shadowCalls[0]?.targetTenantId).toBe(TENANT);
  });

  it('a BUYER invite redeems into a buyer_connection with NO shadow user', async () => {
    const h = buildHarness();
    const mint = await h.app.request(`/memberships/org/${ORG}/invites`, {
      method: 'POST',
      headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultRoleId: 'buyer',
        relationshipType: 'buyer_connection',
      }),
    });
    const minted = (await json(mint)) as { data: { code: string } };

    const redeem = await h.app.request('/memberships/redeem', {
      method: 'POST',
      headers: { Authorization: buyerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.data.code }),
    });
    expect(redeem.status).toBe(200);
    const body = (await json(redeem)) as {
      data: { relationshipType: string };
    };
    expect(body.data.relationshipType).toBe('buyer_connection');
    expect(h.shadowCalls).toHaveLength(0); // corrected buyer model
  });

  it('unknown code → 404; exhausted invite → 410', async () => {
    const h = buildHarness();
    const unknown = await h.app.request('/memberships/redeem', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NOPE-404' }),
    });
    expect(unknown.status).toBe(404);

    const mint = await h.app.request(`/memberships/org/${ORG}/invites`, {
      method: 'POST',
      headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultRoleId: 'driller', maxRedemptions: 1 }),
    });
    const minted = (await json(mint)) as { data: { code: string } };
    await h.app.request('/memberships/redeem', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.data.code }),
    });
    const exhausted = await h.app.request('/memberships/redeem', {
      method: 'POST',
      headers: { Authorization: buyerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.data.code }),
    });
    expect(exhausted.status).toBe(410);
  });

  it('invite minting is role-gated (buyer-role caller → 403)', async () => {
    const h = buildHarness();
    const res = await h.app.request(`/memberships/org/${ORG}/invites`, {
      method: 'POST',
      headers: { Authorization: buyerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultRoleId: 'driller' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('pairing mode (b) — request → approve / reject', () => {
  it('request against a discoverable org → 202 PENDING; queue shows it; approve provisions the shadow user', async () => {
    const h = buildHarness();
    const request = await h.app.request('/memberships/request', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: ORG,
        relationshipType: 'employment',
        note: 'I can drill.',
      }),
    });
    expect(request.status).toBe(202);
    const pendingBody = (await json(request)) as {
      data: { id: string; status: string };
    };
    expect(pendingBody.data.status).toBe('PENDING');
    expect(h.shadowCalls).toHaveLength(0); // never before approval

    const queue = await h.app.request(`/memberships/org/${ORG}/requests`, {
      headers: { Authorization: adminAuth() },
    });
    expect(queue.status).toBe(200);
    const queueBody = (await json(queue)) as {
      data: Array<{ id: string; requestedNote: string }>;
    };
    expect(queueBody.data).toHaveLength(1);
    expect(queueBody.data[0]?.requestedNote).toBe('I can drill.');

    const approve = await h.app.request(
      `/memberships/org/${ORG}/requests/${pendingBody.data.id}/approve`,
      {
        method: 'POST',
        headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'welcome' }),
      },
    );
    expect(approve.status).toBe(200);
    const approved = (await json(approve)) as { data: { status: string } };
    expect(approved.data.status).toBe('ACTIVE');
    expect(h.shadowCalls).toHaveLength(1); // provisioned AT approval
  });

  it('a buyer request approves WITHOUT shadow provisioning', async () => {
    const h = buildHarness();
    const request = await h.app.request('/memberships/request', {
      method: 'POST',
      headers: { Authorization: buyerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: ORG,
        relationshipType: 'buyer_connection',
      }),
    });
    expect(request.status).toBe(202);
    const pendingBody = (await json(request)) as { data: { id: string } };

    const approve = await h.app.request(
      `/memberships/org/${ORG}/requests/${pendingBody.data.id}/approve`,
      {
        method: 'POST',
        headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(approve.status).toBe(200);
    expect(h.shadowCalls).toHaveLength(0);
  });

  it('reject → REJECTED; re-request goes PENDING again', async () => {
    const h = buildHarness();
    const request = await h.app.request('/memberships/request', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: ORG, relationshipType: 'employment' }),
    });
    const pendingBody = (await json(request)) as { data: { id: string } };

    const reject = await h.app.request(
      `/memberships/org/${ORG}/requests/${pendingBody.data.id}/reject`,
      {
        method: 'POST',
        headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'not hiring' }),
      },
    );
    expect(reject.status).toBe(200);
    const rejected = (await json(reject)) as { data: { status: string } };
    expect(rejected.data.status).toBe('REJECTED');

    const reRequest = await h.app.request('/memberships/request', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: ORG, relationshipType: 'employment' }),
    });
    expect(reRequest.status).toBe(202);
  });

  it('a non-discoverable org is indistinguishable from missing (404)', async () => {
    const h = buildHarness({ orgDiscoverable: false });
    const res = await h.app.request('/memberships/request', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: ORG, relationshipType: 'employment' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('org-side lifecycle + caller reads', () => {
  async function activateWorker(h: Harness): Promise<string> {
    const mint = await h.app.request(`/memberships/org/${ORG}/invites`, {
      method: 'POST',
      headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultRoleId: 'driller' }),
    });
    const minted = (await json(mint)) as { data: { code: string } };
    const redeem = await h.app.request('/memberships/redeem', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.data.code }),
    });
    const body = (await json(redeem)) as { data: { id: string } };
    return body.data.id;
  }

  it('GET /me lists the caller memberships after joining', async () => {
    const h = buildHarness();
    await activateWorker(h);
    const res = await h.app.request('/memberships/me', {
      headers: { Authorization: workerAuth() },
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: Array<{ status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.status).toBe('ACTIVE');
  });

  it('revoke ends an ACTIVE membership org-side (REVOKED)', async () => {
    const h = buildHarness();
    const membershipId = await activateWorker(h);
    const res = await h.app.request(
      `/memberships/org/${ORG}/members/${membershipId}/revoke`,
      {
        method: 'POST',
        headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'contract ended' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { status: string } };
    expect(body.data.status).toBe('REVOKED');
  });

  it('block is terminal; leave works member-side', async () => {
    const h = buildHarness();
    const membershipId = await activateWorker(h);
    const block = await h.app.request(
      `/memberships/org/${ORG}/members/${membershipId}/block`,
      {
        method: 'POST',
        headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'fraud' }),
      },
    );
    expect(block.status).toBe(200);

    // A blocked member's redeem attempt is refused.
    const mint = await h.app.request(`/memberships/org/${ORG}/invites`, {
      method: 'POST',
      headers: { Authorization: adminAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultRoleId: 'driller' }),
    });
    const minted = (await json(mint)) as { data: { code: string } };
    const redeem = await h.app.request('/memberships/redeem', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: minted.data.code }),
    });
    expect(redeem.status).toBe(403);
  });

  it('leave moves an ACTIVE membership to LEFT', async () => {
    const h = buildHarness();
    await activateWorker(h);
    const res = await h.app.request('/memberships/leave', {
      method: 'POST',
      headers: { Authorization: workerAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: ORG }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { data: { status: string } };
    expect(body.data.status).toBe('LEFT');
  });

  it('org queue/decisions are role-gated', async () => {
    const h = buildHarness();
    const res = await h.app.request(`/memberships/org/${ORG}/requests`, {
      headers: { Authorization: workerAuth() },
    });
    expect(res.status).toBe(403);
  });
});
