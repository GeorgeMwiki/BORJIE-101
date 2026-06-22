/**
 * /api/v1/mining/internal/tenants — Borjie HQ tenant administration.
 *
 * SUPER_ADMIN-only surface for provisioning + suspension. All mutations
 * skip the per-tenant RLS scope (these rows ARE the tenant index) but
 * the route still requires platform-admin role.
 *
 * Routes:
 *   GET    /             list tenants
 *   POST   /             provision tenant
 *   PATCH  /:id          update plan / billing
 *   POST   /:id/suspend  suspend
 *   POST   /:id/activate activate (suspended/pending → active) [AD-8]
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  tenants,
  users,
  decisionTraces,
  complianceEscalations,
  ledgerEntries,
  withServiceRoleContext,
} from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  internalTenantsListRoute,
  internalTenantsProvisionRoute,
  internalTenantsUpdateRoute,
  internalTenantsSuspendRoute,
  internalTenantsActivateRoute,
} from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalTenantsListRoute, async (c) => {
  const db = c.get('db');
  const rows = await db
    .select()
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(100);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  internalTenantsProvisionRoute,
  withSecurityEvents(
    { action: 'platform.tenant.provision', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const input = c.req.valid('json');
      const now = new Date();
      const [row] = await db
        .insert(tenants)
        .values({
          id: randomUUID(),
          name: input.name,
          slug: input.slug,
          status: 'pending',
          subscriptionTier: input.subscriptionTier,
          plan: input.plan,
          primaryEmail: input.primaryEmail,
          primaryPhone: input.primaryPhone ?? null,
          country: input.country,
          region: input.region ?? 'af-south-1',
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  internalTenantsUpdateRoute,
  withSecurityEvents(
    { action: 'platform.tenant.update', resource: 'platform.tenant', severity: 'info' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const [row] = await db
        .update(tenants)
        .set({ ...input, updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

app.openapi(
  internalTenantsSuspendRoute,
  withSecurityEvents(
    { action: 'platform.tenant.suspend', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const { id } = c.req.valid('param');
      const [row] = await db
        .update(tenants)
        .set({ status: 'suspended', updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

// AD-8 — Activate. The mirror of suspend: flips a `suspended` (or
// `pending`) tenant back to `active`. Reactivating an already-active
// tenant is a 409 no-op so the operator gets explicit feedback rather
// than a silent re-write. Admin-role guarded (router-level requireRole)
// and audited via withSecurityEvents, exactly like suspend.
app.openapi(
  internalTenantsActivateRoute,
  withSecurityEvents(
    { action: 'platform.tenant.activate', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const { id } = c.req.valid('param');

      // Read current status first so we can reject an idempotent re-activate
      // with a clear 409 (and never silently bump updatedAt on a no-op).
      const [current] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      if (!current) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      if (current.status === 'active') {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'ALREADY_ACTIVE',
              message: 'Tenant is already active',
            },
          },
          409,
        );
      }

      const [row] = await db
        .update(tenants)
        .set({ status: 'active', updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Tenant not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

// ───────────────────────────────────────────────────────────────────────────
// Per-tenant DETAIL rollups for the console tenant-detail tabs (overview
// summary, operator roster, invoice history). These read TENANT-SCOPED
// FORCE-RLS tables for a SPECIFIC TARGET tenant — but the admin's request GUC
// is bound to the admin's OWN tenant, so each read runs inside
// `withServiceRoleContext` (the service-role bypass policy lifts row
// visibility) with an EXPLICIT `tenant_id` predicate as the real
// authorization gate. The surface is already platform-admin gated by the
// router-level requireRole(SUPER_ADMIN, ADMIN). All three are read-only.
// ───────────────────────────────────────────────────────────────────────────

// ISO-4217 zero-decimal currencies: their `amount_minor_units` IS the major
// amount (no subunit), so converting to major divides by 10^0, not 10^2.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'TZS', 'UGX', 'RWF', 'BIF', 'DJF', 'GNF', 'KMF', 'XAF', 'XOF', 'XPF',
  'JPY', 'KRW', 'PYG', 'ISK', 'CLP', 'VUV',
]);

function minorToMajor(minor: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? minor : minor / 100;
}

// GET /:id/operator-summary — the three live counts behind the overview tiles.
app.get('/:id/operator-summary', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  // decisions in the trailing 24h — startedAt is a timestamptz column, so a
  // Date cutoff compares correctly (no string/clock ambiguity).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const summary = await withServiceRoleContext(db, async (tx) => {
    // Operators are the tenant's active users. (The unified org_memberships
    // graph is the forward model but is not backfilled in every deployment;
    // `users` is the authoritative, populated per-tenant operator table the
    // request-path auth itself resolves through.)
    const [ops] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.tenantId, id),
          eq(users.status, 'active'),
          isNull(users.deletedAt),
        ),
      );
    const [dec] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(decisionTraces)
      .where(
        and(eq(decisionTraces.tenantId, id), gte(decisionTraces.startedAt, since)),
      );
    const [tix] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(complianceEscalations)
      .where(
        and(
          eq(complianceEscalations.tenantId, id),
          isNull(complianceEscalations.resolvedAt),
        ),
      );
    return {
      activeOperators: ops?.n ?? 0,
      decisions24h: dec?.n ?? 0,
      openTickets: tix?.n ?? 0,
    };
  });
  return c.json({ success: true as const, data: summary }, 200);
});

// GET /:id/operators — the live operator roster (the tenant's active users,
// with their mining role + last-active). Sourced from `users` for the same
// reason as the summary count above.
app.get('/:id/operators', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const rows = await withServiceRoleContext(db, async (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        displayName: users.displayName,
        role: users.miningRole,
        lastActivityAt: users.lastActivityAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(
        and(
          eq(users.tenantId, id),
          eq(users.status, 'active'),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(desc(users.lastActivityAt))
      .limit(200),
  );
  const data = rows.map((r) => {
    const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
    return {
      id: r.id,
      name: r.displayName ?? (fullName || r.email),
      role: r.role ?? 'operator',
      lastActiveAt: (r.lastActivityAt ?? r.lastLoginAt)?.toISOString() ?? null,
    };
  });
  return c.json({ success: true as const, data }, 200);
});

// GET /:id/invoices — invoice history. No discrete invoices table exists; the
// honest source is the double-entry ledger's PLATFORM_FEE postings (real money
// movement). Empty until the tenant is billed — the UI renders an honest empty
// state, never a fabricated invoice list.
app.get('/:id/invoices', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const rows = await withServiceRoleContext(db, async (tx) =>
    tx
      .select({
        id: ledgerEntries.id,
        invoiceId: ledgerEntries.invoiceId,
        amountMinorUnits: ledgerEntries.amountMinorUnits,
        currency: ledgerEntries.currency,
        postedAt: ledgerEntries.postedAt,
        effectiveDate: ledgerEntries.effectiveDate,
        description: ledgerEntries.description,
      })
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.tenantId, id), eq(ledgerEntries.type, 'PLATFORM_FEE')),
      )
      .orderBy(desc(ledgerEntries.effectiveDate))
      .limit(50),
  );
  const data = rows.map((r) => ({
    id: r.invoiceId ?? r.id,
    issuedAt: (r.postedAt ?? r.effectiveDate).toISOString(),
    amount: minorToMajor(r.amountMinorUnits, r.currency),
    currency: r.currency,
    // A posted double-entry PLATFORM_FEE is a settled accounting fact; an entry
    // with no postedAt is still pending. We expose the LEDGER posting status,
    // never a fabricated payment status.
    status: r.postedAt ? ('Paid' as const) : ('Open' as const),
    ...(r.description ? { description: r.description } : {}),
  }));
  return c.json({ success: true as const, data }, 200);
});

export const miningInternalTenantsRouter = app;
