/**
 * /api/v1/memberships — the pairing surface (surface-completion SC-4).
 *
 * BOTH pairing modes of the corrected model:
 *   (a) ORG-INITIATED INVITE / QR — the org mints an invite code
 *       (`POST /org/:orgId/invites`; the QR encodes the returned deep link),
 *       the worker/buyer redeems it (`POST /redeem`) → ACTIVE immediately
 *       (the org pre-authorized by issuing the code).
 *   (b) PUBLIC DISCOVERY — the org opts in (`PATCH /org/:orgId/discoverable`),
 *       appears in `GET /orgs/discoverable`, a worker/buyer REQUESTS pairing
 *       (`POST /request` → PENDING), the org works its queue
 *       (`GET /org/:orgId/requests`) and approves/rejects; revoke + block +
 *       re-request complete the lifecycle.
 *
 * THE CORRECTED BUYER MODEL is enforced END-TO-END here:
 *   - the relationship an invite grants comes from the INVITE row (the org
 *     authored it), never from the redeemer;
 *   - employment-class activation provisions the SHADOW USER in the target
 *     tenant (shadow-user-provisioner) — a buyer activation NEVER does (the
 *     repository + the DB CHECK both refuse a buyer shadow user);
 *   - approval happens BEFORE any insider user exists: a PENDING request
 *     carries no users row until the org approves.
 *
 * IDENTITY: every caller resolves through identity_auth_principals →
 * tenant_identities (provisioned on first pairing from the JWT's
 * phone/email claims), so a phone-OTP mobile sub and an email web sub land
 * on the SAME membership graph.
 *
 * AUTHZ: caller-side routes need only authentication (the membership graph
 * itself is the authorization). Org-side routes require an org-admin role
 * AND that the org belongs to the caller's ACTIVE tenant (the RLS-scoped
 * organizations read enforces it naturally; the explicit tenant check is
 * defence in depth). Org-side revoke/block bust the active-tenant override
 * cache so insider access dies within the same request, not the 60s TTL.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import {
  withServiceRoleContext,
  createDrizzleOrgMembershipRepository,
  createDrizzleIdentityRepository,
} from '@borjie/database';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { clearActiveTenantCache } from '../middleware/active-tenant-override';
import { provisionShadowUser } from '../services/membership/shadow-user-provisioner';
import {
  createAudienceFanout,
  type AudienceFanout,
} from '../composition/audience-fanout';
import { UserRole } from '../types/user-role';

type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

// The bundled @borjie/database d.ts surfaces interfaces as namespaces, so
// the repo/domain types are DERIVED from the factory return types instead
// of imported (the established gateway pattern — see me-tenants).
type OrgMembershipRepository = ReturnType<
  typeof createDrizzleOrgMembershipRepository
>;
type IdentityRepository = ReturnType<typeof createDrizzleIdentityRepository>;
type OrgMembership = Awaited<ReturnType<OrgMembershipRepository['connect']>>;
type TenantIdentityView = Awaited<ReturnType<IdentityRepository['provision']>>;

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

export interface MembershipsRouterDeps {
  /** Test seam — defaults to the Drizzle repos over the request db. */
  readonly membershipRepo?: OrgMembershipRepository;
  readonly identityRepo?: IdentityRepository;
  readonly provisionShadow?: typeof provisionShadowUser;
  /** SC-6 realtime leg — defaults to the registry's cross-portal bus. */
  readonly audienceFanout?: AudienceFanout;
}

const RelationshipSchema = z.enum([
  'employment',
  'buyer_connection',
  'contractor',
  'guest',
]);

const RedeemSchema = z.object({
  code: z.string().min(4).max(64),
  nickname: z.string().max(120).optional(),
});

const RequestPairingSchema = z.object({
  organizationId: z.string().min(1).max(128),
  relationshipType: RelationshipSchema,
  note: z.string().max(500).optional(),
});

const LeaveSchema = z.object({
  organizationId: z.string().min(1).max(128),
});

const DecisionSchema = z.object({
  note: z.string().max(500).optional(),
});

const BlockSchema = z.object({
  reason: z.string().max(500).optional(),
});

const CreateInviteSchema = z.object({
  defaultRoleId: z.string().min(1).max(120),
  relationshipType: RelationshipSchema.optional(),
  expiresInHours: z.number().int().min(1).max(24 * 90).optional(),
  maxRedemptions: z.number().int().min(1).max(10_000).optional(),
});

const DiscoverableSchema = z.object({
  discoverable: z.boolean(),
});

/** Org-admin roles allowed to run the org side of the pairing lifecycle. */
const ORG_ADMIN_ROLES = [
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER, // the mining "site manager" slot
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

function fail(code: string, message: string) {
  return { success: false, error: { code, message } };
}

function membershipView(m: OrgMembership) {
  return {
    id: m.id,
    organizationId: m.organizationId,
    tenantId: m.platformTenantId,
    status: m.status,
    relationshipType: m.relationshipType,
    memberRole: m.memberRole,
    nickname: m.nickname,
    joinedAt: new Date(m.joinedAtMs).toISOString(),
    requestedNote: m.requestedNote,
    decisionNote: m.decisionNote,
  };
}

export function createMembershipsRouter(
  deps: MembershipsRouterDeps = {},
): Hono {
  const router = new Hono();
  router.use('*', authMiddleware);
  router.use('*', databaseMiddleware);

  const provisionShadow = deps.provisionShadow ?? provisionShadowUser;

  function getDb(c: { get(key: 'db'): unknown }): ServiceRoleDb | null {
    return (c.get('db') as ServiceRoleDb | null) ?? null;
  }

  function membershipRepo(db: ServiceRoleDb): OrgMembershipRepository {
    return (
      deps.membershipRepo ??
      createDrizzleOrgMembershipRepository(
        db as Parameters<typeof createDrizzleOrgMembershipRepository>[0],
      )
    );
  }

  function identityRepo(db: ServiceRoleDb): IdentityRepository {
    return (
      deps.identityRepo ??
      createDrizzleIdentityRepository(
        db as Parameters<typeof createDrizzleIdentityRepository>[0],
      )
    );
  }

  /**
   * SC-6 — the realtime cascade leg. Resolved lazily from the registry's
   * cross-portal bus; absent (tests / degraded boot) → null, and every
   * call site is best-effort (the membership row is the source of truth).
   */
  function fanout(
    c: { get(key: 'services'): unknown },
    repo: OrgMembershipRepository,
  ): AudienceFanout | null {
    if (deps.audienceFanout) return deps.audienceFanout;
    const services = c.get('services') as
      | { crossPortalBus?: Promise<never> }
      | undefined;
    if (!services?.crossPortalBus) return null;
    return createAudienceFanout({
      membershipResolver: repo,
      crossPortalBus: services.crossPortalBus,
    });
  }

  /** The org-side decider audience (role-label classes, not authz). */
  const ADMIN_AUDIENCE = {
    memberRoles: ['owner', 'admin', 'manager', 'site_manager'],
  } as const;

  /** Resolve-or-provision the caller's identity from their JWT claims. */
  async function provisionCallerIdentity(
    repo: IdentityRepository,
    auth: {
      userId: string;
      phone?: string | undefined;
      email?: string | undefined;
    },
  ): Promise<TenantIdentityView> {
    return repo.provision({
      supabaseUserId: auth.userId,
      phoneE164: auth.phone ?? null,
      email: auth.email ?? null,
    });
  }

  /** Best-effort tenant/org display names (empty maps on failure). */
  async function nameMaps(
    db: ServiceRoleDb,
    tenantIds: ReadonlyArray<string>,
    orgIds: ReadonlyArray<string>,
  ): Promise<{ tenantNames: Map<string, string>; orgNames: Map<string, string> }> {
    const tenantNames = new Map<string, string>();
    const orgNames = new Map<string, string>();
    try {
      if (tenantIds.length > 0) {
        const rows = (await withServiceRoleContext(db, (sdb) =>
          (sdb as unknown as DbExec).execute(sql`
            SELECT id, name FROM tenants WHERE id = ANY(${[...tenantIds]})
          `),
        )) as unknown as Array<{ id: string; name: string }>;
        for (const r of rows) tenantNames.set(String(r.id), String(r.name));
      }
      if (orgIds.length > 0) {
        const rows = (await withServiceRoleContext(db, (sdb) =>
          (sdb as unknown as DbExec).execute(sql`
            SELECT id, name FROM organizations WHERE id = ANY(${[...orgIds]})
          `),
        )) as unknown as Array<{ id: string; name: string }>;
        for (const r of rows) orgNames.set(String(r.id), String(r.name));
      }
    } catch {
      // Display names are decorative — a mock db in tests has no real SQL.
    }
    return { tenantNames, orgNames };
  }

  /**
   * Org-side guard: the org must exist IN THE CALLER'S ACTIVE TENANT. The
   * read runs on the request connection (RLS-scoped), so a foreign org is
   * simply invisible — 404, never 403 (no existence leak).
   */
  async function loadOwnOrg(
    c: { get(key: 'db'): unknown; get(key: 'auth'): { tenantId: string } },
    orgId: string,
  ): Promise<{ id: string; tenantId: string; discoverable: boolean } | null> {
    const db = getDb(c) as unknown as DbExec | null;
    if (!db) return null;
    const auth = c.get('auth');
    const rows = (await db.execute(sql`
      SELECT id, tenant_id, discoverable
        FROM organizations
       WHERE id = ${orgId}
         AND tenant_id = ${auth.tenantId}
       LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      discoverable: row.discoverable === true,
    };
  }

  // ─── Caller side ──────────────────────────────────────────────────────────

  /** Every ACTIVE membership of the caller (the unified home / switcher). */
  router.get('/me', async (c) => {
    const db = getDb(c);
    if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
    const auth = c.get('auth');
    const identity = await identityRepo(db).resolveByPrincipal(auth.userId);
    if (!identity) return c.json({ success: true, data: [] });
    const memberships = await membershipRepo(db).listActiveForIdentity(
      identity.id,
    );
    const { tenantNames, orgNames } = await nameMaps(
      db,
      memberships.map((m) => m.platformTenantId),
      memberships.map((m) => m.organizationId),
    );
    return c.json({
      success: true,
      data: memberships.map((m) => ({
        ...membershipView(m),
        tenantName: tenantNames.get(m.platformTenantId) ?? null,
        organizationName: orgNames.get(m.organizationId) ?? null,
      })),
    });
  });

  /** Peek an invite (the QR-scan confirmation screen). Never consumes. */
  router.get('/invites/:code', async (c) => {
    const db = getDb(c);
    if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
    const peek = await membershipRepo(db).peekInvite(c.req.param('code'));
    if (!peek) return c.json(fail('INVITE_NOT_FOUND', 'Unknown invite code'), 404);
    const { tenantNames, orgNames } = await nameMaps(
      db,
      [peek.platformTenantId],
      [peek.organizationId],
    );
    return c.json({
      success: true,
      data: {
        code: peek.code,
        organizationId: peek.organizationId,
        organizationName: orgNames.get(peek.organizationId) ?? null,
        tenantName: tenantNames.get(peek.platformTenantId) ?? null,
        relationshipType: peek.relationshipType,
        redeemable: peek.redeemable,
      },
    });
  });

  /** Pairing mode (a): redeem an invite/QR code → ACTIVE membership. */
  router.post('/redeem', zValidator('json', RedeemSchema), async (c) => {
    const db = getDb(c);
    if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
    const auth = c.get('auth');
    const { code, nickname } = c.req.valid('json');
    const repo = membershipRepo(db);

    const peek = await repo.peekInvite(code);
    if (!peek) return c.json(fail('INVITE_NOT_FOUND', 'Unknown invite code'), 404);
    if (!peek.redeemable) {
      return c.json(
        fail('INVITE_NOT_REDEEMABLE', 'Invite expired, revoked, or fully redeemed'),
        410,
      );
    }

    let identity: TenantIdentityView;
    try {
      identity = await provisionCallerIdentity(identityRepo(db), auth);
    } catch {
      return c.json(
        fail(
          'IDENTITY_UNPROVISIONABLE',
          'Your account carries neither a phone nor an email claim — cannot create an identity.',
        ),
        400,
      );
    }

    // Employment-class joins are tenant INSIDERS — provision the shadow
    // users row in the invite's tenant BEFORE redeeming. Buyer invites skip
    // this entirely (corrected buyer model).
    let shadowUserId: string | null = null;
    if (peek.relationshipType !== 'buyer_connection') {
      shadowUserId = await provisionShadow({
        db,
        targetTenantId: peek.platformTenantId,
        supabaseUserId: auth.userId,
        displayName: identity.displayName,
        email: identity.email ?? auth.email ?? null,
        phone: auth.phone ?? null,
        memberRole: peek.defaultRoleId,
      });
    }

    try {
      const result = await repo.redeemInvite({
        code,
        tenantIdentityId: identity.id,
        userId: shadowUserId,
        nickname: nickname ?? null,
      });
      if (result.membership.status === 'BLOCKED') {
        return c.json(
          fail('MEMBERSHIP_BLOCKED', 'This organization has blocked your membership.'),
          403,
        );
      }
      return c.json({ success: true, data: membershipView(result.membership) });
    } catch (err) {
      // Typed-error shape checks (the bundled d.ts erases the class types,
      // so instanceof cannot narrow here).
      const e = err as { code?: string; message?: string };
      if (e.code === 'INVITE_NOT_REDEEMABLE') {
        return c.json(fail(e.code, e.message ?? 'Invite not redeemable'), 410);
      }
      if (
        e.code === 'SHADOW_USER_REQUIRED' ||
        e.code === 'SHADOW_USER_FORBIDDEN'
      ) {
        return c.json(fail(e.code, e.message ?? 'Membership invariant'), 409);
      }
      throw err;
    }
  });

  /** Pairing mode (b): request to join a DISCOVERABLE org → PENDING. */
  router.post('/request', zValidator('json', RequestPairingSchema), async (c) => {
    const db = getDb(c);
    if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
    const auth = c.get('auth');
    const { organizationId, relationshipType, note } = c.req.valid('json');

    // CROSS-tenant read by design (the target org is not the caller's) —
    // service-role lifts visibility; ONLY discoverable orgs are addressable
    // and a non-discoverable org is indistinguishable from a missing one.
    const orgs = (await withServiceRoleContext(db, (sdb) =>
      (sdb as unknown as DbExec).execute(sql`
        SELECT id, tenant_id
          FROM organizations
         WHERE id = ${organizationId}
           AND discoverable = true
         LIMIT 1
      `),
    )) as unknown as Array<Record<string, unknown>>;
    const org = orgs[0];
    if (!org) {
      return c.json(
        fail('ORG_NOT_DISCOVERABLE', 'Organization not found or not open to requests'),
        404,
      );
    }

    let identity: TenantIdentityView;
    try {
      identity = await provisionCallerIdentity(identityRepo(db), auth);
    } catch {
      return c.json(
        fail(
          'IDENTITY_UNPROVISIONABLE',
          'Your account carries neither a phone nor an email claim — cannot create an identity.',
        ),
        400,
      );
    }

    const repo = membershipRepo(db);
    const membership = await repo.requestPairing({
      tenantIdentityId: identity.id,
      organizationId: String(org.id),
      platformTenantId: String(org.tenant_id),
      relationshipType,
      memberRole: relationshipType === 'buyer_connection' ? 'buyer' : null,
      requestedNote: note ?? null,
    });
    if (membership.status === 'BLOCKED') {
      return c.json(
        fail('MEMBERSHIP_BLOCKED', 'This organization has blocked your membership.'),
        403,
      );
    }
    if (membership.status === 'ACTIVE') {
      return c.json({ success: true, data: membershipView(membership) }); // already a member
    }
    // SC-6 down-leg: the org's decider audience learns about the new
    // request in realtime (the PENDING row is the source of truth).
    await fanout(c, repo)?.publishToAudience({
      organizationId: String(org.id),
      audience: ADMIN_AUDIENCE,
      kind: 'notification',
      payload: {
        type: 'membership-request-received',
        membershipId: membership.id,
        organizationId: String(org.id),
        relationshipType,
      },
      emittedBy: 'memberships:request',
    });
    return c.json({ success: true, data: membershipView(membership) }, 202);
  });

  /** The public pairing directory (mode b): only opted-in orgs appear. */
  router.get('/orgs/discoverable', async (c) => {
    const db = getDb(c);
    if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
    const q = (c.req.query('q') ?? '').trim();
    const rows = (await withServiceRoleContext(db, (sdb) =>
      (sdb as unknown as DbExec).execute(sql`
        SELECT o.id, o.name, o.tenant_id,
               COALESCE(t.name, 'Tenant') AS tenant_name
          FROM organizations o
          LEFT JOIN tenants t ON t.id::text = o.tenant_id::text
         WHERE o.discoverable = true
           AND (${q} = '' OR o.name ILIKE '%' || ${q} || '%'
                OR t.name ILIKE '%' || ${q} || '%')
         ORDER BY o.name ASC
         LIMIT 50
      `),
    )) as unknown as Array<Record<string, unknown>>;
    return c.json({
      success: true,
      data: rows.map((r) => ({
        organizationId: String(r.id),
        organizationName: String(r.name ?? 'Organization'),
        tenantId: String(r.tenant_id),
        tenantName: String(r.tenant_name ?? 'Tenant'),
      })),
    });
  });

  /** Leave one of your own memberships (ACTIVE → LEFT). */
  router.post('/leave', zValidator('json', LeaveSchema), async (c) => {
    const db = getDb(c);
    if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
    const auth = c.get('auth');
    const { organizationId } = c.req.valid('json');
    const identity = await identityRepo(db).resolveByPrincipal(auth.userId);
    if (!identity) {
      return c.json(fail('MEMBERSHIP_NOT_FOUND', 'No active membership'), 404);
    }
    const left = await membershipRepo(db).leave(identity.id, organizationId);
    if (!left) {
      return c.json(fail('MEMBERSHIP_NOT_FOUND', 'No active membership'), 404);
    }
    clearActiveTenantCache();
    return c.json({ success: true, data: membershipView(left) });
  });

  // ─── Org side (admin-gated, own-tenant only) ──────────────────────────────

  const orgAdmin = requireRole(...ORG_ADMIN_ROLES);

  /** The approval queue, oldest first, with requester display names.
   *  Paginated (?limit=&offset=) and bounded; identities batch-loaded
   *  (scaling S-4: no N+1). */
  router.get('/org/:orgId/requests', orgAdmin, async (c) => {
    const db = getDb(c);
    if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
    const org = await loadOwnOrg(c, c.req.param('orgId'));
    if (!org) return c.json(fail('ORG_NOT_FOUND', 'Organization not found'), 404);
    const limit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const offset = Number.parseInt(c.req.query('offset') ?? '', 10);
    const idRepo = identityRepo(db);
    const pending = await membershipRepo(db).listPendingForOrg(org.id, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
    // One batched identity read for the whole page (no per-row N+1).
    const identities = await idRepo.getByIds(
      pending.map((m) => m.tenantIdentityId),
    );
    type IdentityView = (typeof identities)[number];
    const byId = new Map<string, IdentityView>(
      identities.map((i) => [i.id, i] as const),
    );
    const data = pending.map((m) => {
      const identity = byId.get(m.tenantIdentityId);
      return {
        ...membershipView(m),
        requesterName: identity?.displayName ?? null,
        requesterPhone: identity?.phoneNormalized ?? null,
        requesterEmail: identity?.email ?? null,
      };
    });
    return c.json({ success: true, data });
  });

  /** Approve a PENDING request (provisions the shadow user for insiders). */
  router.post(
    '/org/:orgId/requests/:membershipId/approve',
    orgAdmin,
    zValidator('json', DecisionSchema),
    async (c) => {
      const db = getDb(c);
      if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
      const auth = c.get('auth');
      const org = await loadOwnOrg(c, c.req.param('orgId'));
      if (!org) return c.json(fail('ORG_NOT_FOUND', 'Organization not found'), 404);
      const membershipId = c.req.param('membershipId');
      const repo = membershipRepo(db);
      // O(1) PK lookup — never scan the whole queue to find one row (S-3).
      const pending = await repo.getPendingByIdAndOrg(membershipId, org.id);
      if (!pending) {
        return c.json(fail('REQUEST_NOT_FOUND', 'No pending request'), 404);
      }
      let shadowUserId: string | null = null;
      if (pending.relationshipType !== 'buyer_connection') {
        const identity = await identityRepo(db).getById(pending.tenantIdentityId);
        // The principal that created the request — provisioning keys the
        // shadow row's identity on it; absent (test seams) we fall back to
        // a synthetic provisioning keyed on the membership id.
        const principalSub = await resolvePrincipalSub(
          db,
          pending.tenantIdentityId,
        );
        shadowUserId = await provisionShadow({
          db,
          targetTenantId: pending.platformTenantId,
          supabaseUserId: principalSub ?? pending.tenantIdentityId,
          displayName: identity?.displayName ?? null,
          email: identity?.email ?? null,
          phone: identity?.phoneNormalized ?? null,
          memberRole: pending.memberRole,
        });
      }
      const approved = await repo.approve({
        organizationId: org.id,
        membershipId,
        decidedBy: auth.userId,
        decisionNote: c.req.valid('json').note ?? null,
        userId: shadowUserId,
      });
      if (!approved) {
        return c.json(fail('REQUEST_NOT_FOUND', 'No pending request'), 404);
      }
      // SC-6 up-leg: tell the requester instantly, on THEIR identity topic.
      await fanout(c, repo)?.publishToIdentity({
        tenantIdentityId: approved.tenantIdentityId,
        kind: 'notification',
        payload: {
          type: 'membership-approved',
          membershipId: approved.id,
          organizationId: org.id,
          relationshipType: approved.relationshipType,
        },
        emittedBy: 'memberships:approve',
      });
      return c.json({ success: true, data: membershipView(approved) });
    },
  );

  /** Reject a PENDING request (re-request stays possible). */
  router.post(
    '/org/:orgId/requests/:membershipId/reject',
    orgAdmin,
    zValidator('json', DecisionSchema),
    async (c) => {
      const db = getDb(c);
      if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
      const auth = c.get('auth');
      const org = await loadOwnOrg(c, c.req.param('orgId'));
      if (!org) return c.json(fail('ORG_NOT_FOUND', 'Organization not found'), 404);
      const repo = membershipRepo(db);
      const rejected = await repo.reject({
        organizationId: org.id,
        membershipId: c.req.param('membershipId'),
        decidedBy: auth.userId,
        decisionNote: c.req.valid('json').note ?? null,
      });
      if (!rejected) {
        return c.json(fail('REQUEST_NOT_FOUND', 'No pending request'), 404);
      }
      await fanout(c, repo)?.publishToIdentity({
        tenantIdentityId: rejected.tenantIdentityId,
        kind: 'notification',
        payload: {
          type: 'membership-rejected',
          membershipId: rejected.id,
          organizationId: org.id,
        },
        emittedBy: 'memberships:reject',
      });
      return c.json({ success: true, data: membershipView(rejected) });
    },
  );

  /** Org-initiated end of an ACTIVE membership (ACTIVE → REVOKED). */
  router.post(
    '/org/:orgId/members/:membershipId/revoke',
    orgAdmin,
    zValidator('json', DecisionSchema),
    async (c) => {
      const db = getDb(c);
      if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
      const auth = c.get('auth');
      const org = await loadOwnOrg(c, c.req.param('orgId'));
      if (!org) return c.json(fail('ORG_NOT_FOUND', 'Organization not found'), 404);
      const repo = membershipRepo(db);
      const revoked = await repo.revoke({
        organizationId: org.id,
        membershipId: c.req.param('membershipId'),
        decidedBy: auth.userId,
        decisionNote: c.req.valid('json').note ?? null,
      });
      if (!revoked) {
        return c.json(fail('MEMBERSHIP_NOT_FOUND', 'No active membership'), 404);
      }
      clearActiveTenantCache(); // cut switched-in access now, not at TTL
      await fanout(c, repo)?.publishToIdentity({
        tenantIdentityId: revoked.tenantIdentityId,
        kind: 'notification',
        payload: {
          type: 'membership-revoked',
          membershipId: revoked.id,
          organizationId: org.id,
        },
        emittedBy: 'memberships:revoke',
      });
      return c.json({ success: true, data: membershipView(revoked) });
    },
  );

  /** Block a member (terminal until the org unblocks). */
  router.post(
    '/org/:orgId/members/:membershipId/block',
    orgAdmin,
    zValidator('json', BlockSchema),
    async (c) => {
      const db = getDb(c);
      if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
      const org = await loadOwnOrg(c, c.req.param('orgId'));
      if (!org) return c.json(fail('ORG_NOT_FOUND', 'Organization not found'), 404);
      const blocked = await membershipRepo(db).block({
        organizationId: org.id,
        membershipId: c.req.param('membershipId'),
        reason: c.req.valid('json').reason ?? null,
      });
      if (!blocked) {
        return c.json(fail('MEMBERSHIP_NOT_FOUND', 'Membership not found'), 404);
      }
      clearActiveTenantCache();
      return c.json({ success: true, data: membershipView(blocked) });
    },
  );

  /** Mint an invite (mode a). The QR encodes the returned deep link. */
  router.post(
    '/org/:orgId/invites',
    orgAdmin,
    zValidator('json', CreateInviteSchema),
    async (c) => {
      const db = getDb(c);
      if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
      const auth = c.get('auth');
      const org = await loadOwnOrg(c, c.req.param('orgId'));
      if (!org) return c.json(fail('ORG_NOT_FOUND', 'Organization not found'), 404);
      const body = c.req.valid('json');
      const invite = await membershipRepo(db).createInvite({
        organizationId: org.id,
        platformTenantId: org.tenantId,
        issuedBy: auth.userId,
        defaultRoleId: body.defaultRoleId,
        relationshipType: body.relationshipType ?? 'employment',
        expiresAt: body.expiresInHours
          ? new Date(Date.now() + body.expiresInHours * 3_600_000)
          : null,
        maxRedemptions: body.maxRedemptions ?? null,
      });
      return c.json(
        {
          success: true,
          data: {
            code: invite.code,
            relationshipType: invite.relationshipType,
            defaultRoleId: invite.defaultRoleId,
            // The QR payload — both mobile apps register this scheme.
            deepLink: `borjie://membership/join?code=${invite.code}`,
          },
        },
        201,
      );
    },
  );

  /** Pairing mode (b) opt-in toggle. */
  router.patch(
    '/org/:orgId/discoverable',
    orgAdmin,
    zValidator('json', DiscoverableSchema),
    async (c) => {
      const db = getDb(c) as unknown as DbExec | null;
      if (!db) return c.json(fail('DATABASE_UNAVAILABLE', 'No database client'), 503);
      const auth = c.get('auth');
      const { discoverable } = c.req.valid('json');
      // RLS-scoped UPDATE on the request connection + explicit tenant
      // predicate (defence in depth) — an org outside the caller's tenant
      // is unaffected AND invisible.
      const rows = (await db.execute(sql`
        UPDATE organizations
           SET discoverable = ${discoverable}, updated_at = now()
         WHERE id = ${c.req.param('orgId')}
           AND tenant_id = ${auth.tenantId}
         RETURNING id, discoverable
      `)) as unknown as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row) return c.json(fail('ORG_NOT_FOUND', 'Organization not found'), 404);
      return c.json({
        success: true,
        data: { organizationId: String(row.id), discoverable: row.discoverable === true },
      });
    },
  );

  return router;
}

/** sub lookup for shadow provisioning at approve time (newest principal). */
async function resolvePrincipalSub(
  db: ServiceRoleDb,
  tenantIdentityId: string,
): Promise<string | null> {
  try {
    const rows = (await withServiceRoleContext(db, (sdb) =>
      (sdb as unknown as DbExec).execute(sql`
        SELECT supabase_user_id
          FROM identity_auth_principals
         WHERE tenant_identity_id = ${tenantIdentityId}
         ORDER BY created_at DESC
         LIMIT 1
      `),
    )) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    return row ? String(row.supabase_user_id) : null;
  } catch {
    return null;
  }
}

export const membershipsRouter = createMembershipsRouter();
