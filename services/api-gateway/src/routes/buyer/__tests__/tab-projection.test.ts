/**
 * Buyer tab projection (SC-6) — the previously-absent buyer leg.
 *
 * Pure-layer contract:
 *   - EXPLICIT OPT-IN ONLY: rows without config.buyerProjection NEVER
 *     project (the workforce kind/type fallbacks are an external-leak
 *     hazard for buyers and are deliberately absent);
 *   - unknown kinds are skipped; the projection carries the org/tenant
 *     context (per-membership overlay scope); rows from unconnected
 *     tenants are invisible even if present in the input.
 *
 * Route contract (in-memory repos + db stub):
 *   - unmapped principal / zero buyer connections → honest-empty;
 *   - a connected buyer receives only buyer-opted tabs of THEIR sellers.
 */

import { describe, it, expect } from 'vitest';
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
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import {
  buildBuyerProjectedTabs,
  resolveBuyerProjectedKind,
  createBuyerTabProjectionRouter,
} from '../tab-projection.hono';

const BUYER_SUB = 'a0000000-0000-0000-0000-000000000002';
const SELLER_TENANT = 'b0000000-0000-0000-0000-00000000000a';
const SELLER_ORG = 'org_seller_1';

describe('resolveBuyerProjectedKind — explicit opt-in only', () => {
  it('projects only config.buyerProjection.kind, never generic kind/type', () => {
    expect(
      resolveBuyerProjectedKind({ buyerProjection: { kind: 'marketplace' } }),
    ).toBe('marketplace');
    // The workforce-style fallbacks MUST NOT leak owner tabs to buyers.
    expect(resolveBuyerProjectedKind({ kind: 'marketplace' })).toBeNull();
    expect(resolveBuyerProjectedKind({ type: 'procurement' })).toBeNull();
    expect(
      resolveBuyerProjectedKind({ buyerProjection: { kind: 'safety' } }),
    ).toBeNull(); // not a buyer-actionable kind
    expect(resolveBuyerProjectedKind(null)).toBeNull();
  });
});

describe('buildBuyerProjectedTabs', () => {
  const memberships = [
    { organizationId: SELLER_ORG, platformTenantId: SELLER_TENANT },
  ];
  const names = new Map([[SELLER_TENANT, 'Kilima Mining Estate']]);

  it('projects opted-in rows with per-org context; skips foreign tenants', () => {
    const tabs = buildBuyerProjectedTabs(
      [
        {
          tabId: 'tab-1',
          tenantId: SELLER_TENANT,
          label: 'Gold lots',
          position: 1,
          config: { buyerProjection: { kind: 'marketplace' } },
        },
        {
          tabId: 'tab-2',
          tenantId: 'tenant_FOREIGN',
          label: 'Should not appear',
          position: 0,
          config: { buyerProjection: { kind: 'marketplace' } },
        },
        {
          tabId: 'tab-3',
          tenantId: SELLER_TENANT,
          label: 'Internal safety',
          position: 2,
          config: { kind: 'safety' }, // no buyer opt-in
        },
      ],
      memberships,
      names,
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      id: 'tab-1',
      kind: 'marketplace',
      organizationId: SELLER_ORG,
      tenantId: SELLER_TENANT,
      tenantName: 'Kilima Mining Estate',
      origin: 'owner-spawned',
    });
  });

  it('dedupes per (tenant, tab) and orders by position', () => {
    const row = (tabId: string, position: number) => ({
      tabId,
      tenantId: SELLER_TENANT,
      label: tabId,
      position,
      config: { buyerProjection: { kind: 'marketplace' } },
    });
    const tabs = buildBuyerProjectedTabs(
      [row('b', 2), row('a', 1), row('a', 1)],
      memberships,
      names,
    );
    expect(tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('GET /buyer/tabs (route)', () => {
  function bearer(): string {
    return `Bearer ${generateToken({
      userId: BUYER_SUB,
      tenantId: SELLER_TENANT,
      role: UserRole.RESIDENT as never,
      permissions: ['*'],
      propertyAccess: ['*'],
      email: 'buyer@example.com',
    } as never)}`;
  }

  function mount(opts: { connected: boolean; rows: Array<Record<string, unknown>> }) {
    const membershipRepo = createInMemoryOrgMembershipRepository();
    const identityRepo = createInMemoryIdentityRepository();
    const router = createBuyerTabProjectionRouter({
      membershipRepo,
      identityRepo,
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', {
        execute: async (q: unknown) => {
          const sqlText =
            typeof q === 'object' && q !== null && 'queryChunks' in q
              ? JSON.stringify((q as { queryChunks: unknown }).queryChunks)
              : JSON.stringify(q);
          if (sqlText.includes('owner_tabs_structural')) return opts.rows;
          if (sqlText.includes('FROM tenants')) {
            return [{ id: SELLER_TENANT, name: 'Kilima Mining Estate' }];
          }
          return [];
        },
      } as never);
      await next();
    });
    app.route('/buyer/tabs', router);
    return { app, membershipRepo, identityRepo };
  }

  it('honest-empty for an unmapped principal', async () => {
    const { app } = mount({ connected: false, rows: [] });
    const res = await app.request('/buyer/tabs', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('a connected buyer sees the buyer-opted tabs of their sellers', async () => {
    const harness = mount({
      connected: true,
      rows: [
        {
          tab_id: 'tab-gold',
          tenant_id: SELLER_TENANT,
          label: 'Gold lots',
          position: 1,
          config: { buyerProjection: { kind: 'marketplace' } },
        },
        {
          tab_id: 'tab-internal',
          tenant_id: SELLER_TENANT,
          label: 'Internal ops',
          position: 2,
          config: { kind: 'treasury' }, // not buyer-opted
        },
      ],
    });
    // Pair the buyer: identity + ACTIVE buyer_connection in the seller org.
    const identity = await harness.identityRepo.provision({
      supabaseUserId: BUYER_SUB,
      email: 'buyer@example.com',
    });
    await harness.membershipRepo.connect({
      tenantIdentityId: identity.id,
      organizationId: SELLER_ORG,
      platformTenantId: SELLER_TENANT,
      relationshipType: 'buyer_connection',
      memberRole: 'buyer',
      userId: null,
    });

    const res = await harness.app.request('/buyer/tabs', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; kind: string; tenantName: string | null }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: 'tab-gold',
      kind: 'marketplace',
      tenantName: 'Kilima Mining Estate',
    });
  });
});
