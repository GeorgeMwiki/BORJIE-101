/**
 * Estate-OS server-side authorization gate — regression coverage.
 *
 * Before this fix the estate routers (groups / entities / assets /
 * capital-movements / succession-plans) served OWNER-ONLY estate data
 * (succession plans, the asset register, intercompany capital movements,
 * holdings, family-office groups) gated ONLY by `authMiddleware` — the
 * front-end chrome was the only role gate. ANY authenticated tenant
 * principal (a field-worker / buyer login mapped to MAINTENANCE_STAFF /
 * RESIDENT) could read or mutate another role's owner-only estate data by
 * hitting the mounted route directly.
 *
 * `requireEstateOwner()` (a router-level `requireRole(...ESTATE_OWNER_ROLES)`
 * mounted after auth) now fails CLOSED for every non-owner-class principal.
 * This suite LOCKS that gate: a buyer/field-worker is 403'd on every estate
 * route + verb, and the owner-class roles (OWNER / TENANT_ADMIN /
 * SUPER_ADMIN) clear the gate (reaching the DB-unavailable degrade, never
 * 403). Same self-contained pattern as `routes/__tests__/authz-gates.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { UserRole } from '../../../types/user-role';

// The role + db the stub auth middleware injects per-test. `vi.hoisted` so it
// is initialised BEFORE the hoisted `vi.mock` factory runs.
const injected = vi.hoisted(() => ({
  role: 'RESIDENT',
  db: null as unknown,
  tenantId: 'tenant-a',
  userId: 'user-a',
}));

// Stub auth + database middleware; `requireRole` (and thus
// `requireEstateOwner`) stays REAL — it is the gate under test.
vi.mock('../../../middleware/hono-auth', async (orig) => {
  const actual = await (orig() as Promise<
    typeof import('../../../middleware/hono-auth')
  >);
  return {
    ...actual,
    authMiddleware: async (c: any, next: () => Promise<void>) => {
      c.set('auth', {
        tenantId: injected.tenantId,
        userId: injected.userId,
        role: injected.role,
        permissions: ['*'],
        propertyAccess: ['*'],
      });
      await next();
    },
  };
});

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set('db', injected.db);
    await next();
  },
}));

import { estateGroupsRouter } from '../groups.hono';
import { estateEntitiesRouter } from '../entities.hono';
import { estateAssetsRouter } from '../assets.hono';
import { estateCapitalMovementsRouter } from '../capital-movements.hono';
import { estateSuccessionPlansRouter } from '../succession-plans.hono';

beforeEach(() => {
  injected.role = UserRole.RESIDENT;
  injected.db = null;
  injected.tenantId = 'tenant-a';
  injected.userId = 'user-a';
});

function mount(router: Hono): Hono {
  const app = new Hono();
  app.route('/', router);
  return app;
}

function req(app: Hono, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Each estate surface, with a read (GET) and a write (POST) path so the
// router-level guard is proven to cover EVERY verb, not just writes.
const SURFACES: ReadonlyArray<{
  readonly name: string;
  readonly router: Hono;
  readonly read: string;
  readonly write: readonly [string, unknown];
}> = [
  {
    name: 'groups',
    router: estateGroupsRouter,
    read: '/',
    write: ['/', { name: 'X', holdingType: 'family_office', principalOwnerName: 'P' }],
  },
  {
    name: 'entities',
    router: estateEntitiesRouter,
    read: '/',
    write: [
      '/',
      {
        estateGroupId: '11111111-1111-1111-1111-111111111111',
        name: 'Sub',
        kind: 'subsidiary',
      },
    ],
  },
  {
    name: 'assets',
    router: estateAssetsRouter,
    read: '/',
    write: [
      '/',
      {
        estateEntityId: '11111111-1111-1111-1111-111111111111',
        assetClass: 'equipment',
        descriptor: 'Excavator',
      },
    ],
  },
  {
    name: 'capital-movements',
    router: estateCapitalMovementsRouter,
    read: '/',
    write: ['/', { kind: 'dividend', amount: 100 }],
  },
  {
    name: 'succession-plans',
    router: estateSuccessionPlansRouter,
    read: '/',
    write: [
      '/',
      {
        estateGroupId: '11111111-1111-1111-1111-111111111111',
        currentPrincipalName: 'P',
        designatedSuccessorName: 'S',
        designatedSuccessorRelation: 'child',
        nextReviewDueAt: '2999-01-01T00:00:00.000Z',
      },
    ],
  },
];

// Roles that must be REFUSED — every non-owner-class tenant principal.
const FORBIDDEN_ROLES: ReadonlyArray<UserRole> = [
  UserRole.RESIDENT, // marketplace buyer
  UserRole.MAINTENANCE_STAFF, // field worker
  UserRole.PROPERTY_MANAGER, // site manager
  UserRole.ACCOUNTANT,
  UserRole.SUPPORT, // platform support is not an estate-data role
];

// Roles that must CLEAR the gate. Includes the gateway-internal
// persona-tool loopback principal ('PLATFORM_ADMIN') the owner's brain uses
// to read its OWN estate data through the shared HTTP path — gating it out
// would 403 the owner-estate brain tools against their own data.
const ALLOWED_ROLES: ReadonlyArray<UserRole> = [
  UserRole.OWNER,
  UserRole.TENANT_ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  'PLATFORM_ADMIN' as UserRole, // persona-tool loopback principal
];

describe('estate routers fail CLOSED for non-owner roles', () => {
  for (const s of SURFACES) {
    for (const role of FORBIDDEN_ROLES) {
      it(`403s ${role} on GET ${s.name}`, async () => {
        injected.role = role;
        const res = await req(mount(s.router), 'GET', s.read);
        expect(res.status).toBe(403);
        const env = (await res.json()) as { error?: { code?: string } };
        expect(env.error?.code).toBe('FORBIDDEN');
      });

      it(`403s ${role} on POST ${s.name}`, async () => {
        injected.role = role;
        const [path, body] = s.write;
        const res = await req(mount(s.router), 'POST', path, body);
        expect(res.status).toBe(403);
        const env = (await res.json()) as { error?: { code?: string } };
        expect(env.error?.code).toBe('FORBIDDEN');
      });
    }
  }
});

describe('estate routers clear the gate for owner-class roles', () => {
  for (const s of SURFACES) {
    for (const role of ALLOWED_ROLES) {
      it(`lets ${role} past the gate on GET ${s.name} (DB unwired → 503, never 403)`, async () => {
        injected.role = role;
        injected.db = null; // honest-degrade: DB not configured in this fixture
        const res = await req(mount(s.router), 'GET', s.read);
        expect(res.status).not.toBe(403);
        expect(res.status).toBe(503);
      });
    }
  }
});
