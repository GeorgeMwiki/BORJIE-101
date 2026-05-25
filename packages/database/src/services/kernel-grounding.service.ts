/**
 * Kernel grounding service — Drizzle-backed
 * `GroundingFactsProvider` implementation. The kernel pre-fetches
 * these facts at step 5b and renders them into the system prompt so
 * the sensor answers from real tenant state, not training memory.
 *
 * Catalogue (today): occupancy, vacant unit count, active leases
 * count, open work-orders, lease expiring count. Each fact is
 * tenant-scoped and read-only; cheap to compute (single COUNT
 * queries with covering indexes).
 *
 * Visibility scoping (role-aware):
 *   - 'tenant'      → only the requesting resident's lease/unit/work-orders
 *   - 'manager'     → properties where this user is the assigned manager
 *   - 'owner'       → properties owned by this user
 *   - 'org-admin'   → tenantId scope (full agency view)
 *   - 'sovereign'   → no grounding (HQ uses DP cohort source instead)
 *
 * The fact selection is keyword-driven so unrelated questions don't
 * trigger expensive queries. Empty result is fine — the kernel
 * simply skips the grounding fragment.
 *
 * SAFETY INVARIANT: when a role-specific filter cannot be expressed
 * with the current schema, fall back to the tenantId-only scope
 * (NEVER widen visibility beyond tenantId).
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { units, properties } from '../schemas/property.schema.js';
import { leases } from '../schemas/lease.schema.js';
import { workOrders } from '../schemas/maintenance.schema.js';
import { customers } from '../schemas/customer.schema.js';
import { users } from '../schemas/tenant.schema.js';
import type { DatabaseClient } from '../client.js';

// Duck-typed copy of the kernel's port — keep in sync with
// @borjie/central-intelligence/kernel/kernel-types.ts.
export interface GroundingFactShape {
  readonly id: string;
  readonly label: string;
  readonly value: string | number;
  readonly unit?: 'pct' | 'count' | 'currency-tzs' | 'currency-kes' | 'days';
  readonly source: string;
  readonly asOf: string;
}

export interface GroundingFactsProviderShape {
  fetch(args: {
    readonly userMessage: string;
    readonly tier: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<GroundingFactShape>>;
}

/**
 * Role used to determine the visibility filter for grounding facts.
 * Mirrors the user-tier surfaces — every Borjie user gets a
 * role-scoped view of the world.
 */
export type GroundingViewRole =
  | 'tenant'
  | 'manager'
  | 'owner'
  | 'org-admin'
  | 'sovereign';

export interface KernelGroundingDeps {
  readonly tenantId: string | null;
  /** Present except for sovereign-tier (HQ has no tenantId). */
  readonly userId?: string | null;
  /** Determines visibility filter; defaults to org-admin (tenant-wide). */
  readonly role?: GroundingViewRole;
}

const KEYWORD_TRIGGERS: ReadonlyArray<{ kind: GroundingKind; re: RegExp }> = [
  { kind: 'occupancy',         re: /\boccupanc\w+|\bvacanc\w+|\bvacant\b|\bempty\s+unit/i },
  { kind: 'active-leases',     re: /\blease\w*|\btenant\w*|\bresidents?\b/i },
  { kind: 'open-work-orders',  re: /\bwork[- ]?order\w*|\bmaintenance\b|\brepair\w*/i },
  { kind: 'lease-expiring',    re: /\brenew\w*|\bexpir\w*|\bend\s+of\s+lease/i },
];

type GroundingKind = 'occupancy' | 'active-leases' | 'open-work-orders' | 'lease-expiring';

export function createKernelGroundingProvider(
  db: DatabaseClient,
  deps: KernelGroundingDeps,
): GroundingFactsProviderShape {
  // Sovereign tier returns no per-tenant facts — HQ uses the DP cohort
  // source for industry aggregates.
  return {
    async fetch({ userMessage, limit }) {
      if (deps.role === 'sovereign') return [];
      if (!deps.tenantId) return [];

      // Pick the unique kinds that match the message; cap at limit.
      const triggered = new Set<GroundingKind>();
      for (const t of KEYWORD_TRIGGERS) {
        if (t.re.test(userMessage)) triggered.add(t.kind);
        if (triggered.size >= limit) break;
      }
      if (triggered.size === 0) return [];

      const tenantId = deps.tenantId;
      const role: GroundingViewRole = deps.role ?? 'org-admin';
      const userId = deps.userId ?? null;
      const tasks: Array<Promise<GroundingFactShape | null>> = [];
      for (const kind of triggered) {
        tasks.push(runOne(db, { tenantId, role, userId }, kind));
      }
      const results = await Promise.all(tasks);
      return results.filter((r): r is GroundingFactShape => r !== null);
    },
  };
}

interface RunScope {
  readonly tenantId: string;
  readonly role: GroundingViewRole;
  readonly userId: string | null;
}

async function runOne(
  db: DatabaseClient,
  scope: RunScope,
  kind: GroundingKind,
): Promise<GroundingFactShape | null> {
  try {
    const at = new Date().toISOString();
    switch (kind) {
      case 'occupancy':         return await runOccupancy(db, scope, at);
      case 'active-leases':     return await runActiveLeases(db, scope, at);
      case 'open-work-orders':  return await runOpenWorkOrders(db, scope, at);
      case 'lease-expiring':    return await runLeaseExpiring(db, scope, at);
    }
  } catch {
    // Swallow per-fact failures — never break the main thought path.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-fact runners
//
// Note on the resident filter: `customers` has no direct `user_id` FK
// today, so the tenant-role lookup bridges via the shared tenant-scoped
// email column on `users` and `customers`. If no match exists the outer
// query returns 0 rows — correct: the user has no lease in this tenant.
// Follow-up schema (Docs/TODO_BACKLOG.md): when a `customers.user_id` FK is added, replace the
// email-bridge sub-queries below with a direct join.
// ---------------------------------------------------------------------------

async function runOccupancy(
  db: DatabaseClient,
  scope: RunScope,
  at: string,
): Promise<GroundingFactShape | null> {
  const { tenantId, role, userId } = scope;

  // Build WHERE clause based on role.
  let whereClause;
  if (role === 'tenant' && userId) {
    // Tenant resident: only count units the resident currently occupies
    // (via leases linked to their customer record).
    const customerSub = db
      .select({ id: customers.id })
      .from(customers)
      .innerJoin(
        users,
        and(eq(users.email, customers.email), eq(users.tenantId, customers.tenantId)),
      )
      .where(and(eq(customers.tenantId, tenantId), eq(users.id, userId)));
    whereClause = and(
      eq(units.tenantId, tenantId),
      sql`${units.id} IN (
        SELECT ${leases.unitId} FROM ${leases}
        WHERE ${leases.tenantId} = ${tenantId}
          AND ${leases.customerId} IN (${customerSub})
      )`,
    );
  } else if (role === 'owner' && userId) {
    // Owner: only units inside properties they own.
    whereClause = and(
      eq(units.tenantId, tenantId),
      sql`${units.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.ownerId} = ${userId}
      )`,
    );
  } else if (role === 'manager' && userId) {
    // Manager: only units inside properties where they're the assigned
    // manager. (No separate staff_assignments table exists today; the
    // properties.manager_id column is the only manager linkage.)
    // Follow-up schema (Docs/TODO_BACKLOG.md): when a multi-manager `staff_assignments` table is
    // introduced, switch to that join.
    whereClause = and(
      eq(units.tenantId, tenantId),
      sql`${units.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.managerId} = ${userId}
      )`,
    );
  } else {
    // org-admin (or unknown role): full tenantId scope.
    whereClause = eq(units.tenantId, tenantId);
  }

  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      occupied: sql<number>`COUNT(*) FILTER (WHERE ${units.status} = 'occupied')::int`,
    })
    .from(units)
    .where(whereClause);
  const total = Number(row?.total ?? 0);
  const occupied = Number(row?.occupied ?? 0);
  if (total === 0) return null;
  return {
    id: 'gf:occupancy',
    label: 'Occupancy',
    value: occupied / total,
    unit: 'pct',
    source: 'units',
    asOf: at,
  };
}

async function runActiveLeases(
  db: DatabaseClient,
  scope: RunScope,
  at: string,
): Promise<GroundingFactShape | null> {
  const { tenantId, role, userId } = scope;

  let whereClause;
  if (role === 'tenant' && userId) {
    // Resident: only their own active/expiring lease (typically one row).
    whereClause = and(
      eq(leases.tenantId, tenantId),
      inArray(leases.status, ['active', 'expiring_soon'] as never[]),
      sql`${leases.customerId} IN (
        SELECT ${customers.id} FROM ${customers}
        INNER JOIN ${users}
          ON ${users.email} = ${customers.email}
          AND ${users.tenantId} = ${customers.tenantId}
        WHERE ${customers.tenantId} = ${tenantId}
          AND ${users.id} = ${userId}
      )`,
    );
  } else if (role === 'owner' && userId) {
    whereClause = and(
      eq(leases.tenantId, tenantId),
      inArray(leases.status, ['active', 'expiring_soon'] as never[]),
      sql`${leases.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.ownerId} = ${userId}
      )`,
    );
  } else if (role === 'manager' && userId) {
    // Follow-up schema (Docs/TODO_BACKLOG.md): widen to a staff_assignments table once it exists.
    whereClause = and(
      eq(leases.tenantId, tenantId),
      inArray(leases.status, ['active', 'expiring_soon'] as never[]),
      sql`${leases.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.managerId} = ${userId}
      )`,
    );
  } else {
    whereClause = and(
      eq(leases.tenantId, tenantId),
      inArray(leases.status, ['active', 'expiring_soon'] as never[]),
    );
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(leases)
    .where(whereClause);
  return {
    id: 'gf:active-leases',
    label: 'Active leases',
    value: Number(row?.count ?? 0),
    unit: 'count',
    source: 'leases',
    asOf: at,
  };
}

async function runOpenWorkOrders(
  db: DatabaseClient,
  scope: RunScope,
  at: string,
): Promise<GroundingFactShape | null> {
  const { tenantId, role, userId } = scope;
  const openStatuses = ['submitted', 'triaged', 'assigned', 'scheduled', 'in_progress', 'pending_parts'] as never[];

  let whereClause;
  if (role === 'tenant' && userId) {
    // Resident: only work orders raised by them (work_orders.customer_id).
    whereClause = and(
      eq(workOrders.tenantId, tenantId),
      inArray(workOrders.status, openStatuses),
      sql`${workOrders.customerId} IN (
        SELECT ${customers.id} FROM ${customers}
        INNER JOIN ${users}
          ON ${users.email} = ${customers.email}
          AND ${users.tenantId} = ${customers.tenantId}
        WHERE ${customers.tenantId} = ${tenantId}
          AND ${users.id} = ${userId}
      )`,
    );
  } else if (role === 'owner' && userId) {
    whereClause = and(
      eq(workOrders.tenantId, tenantId),
      inArray(workOrders.status, openStatuses),
      sql`${workOrders.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.ownerId} = ${userId}
      )`,
    );
  } else if (role === 'manager' && userId) {
    // Follow-up schema (Docs/TODO_BACKLOG.md): widen to a staff_assignments table once it exists.
    whereClause = and(
      eq(workOrders.tenantId, tenantId),
      inArray(workOrders.status, openStatuses),
      sql`${workOrders.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.managerId} = ${userId}
      )`,
    );
  } else {
    whereClause = and(
      eq(workOrders.tenantId, tenantId),
      inArray(workOrders.status, openStatuses),
    );
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(workOrders)
    .where(whereClause);
  return {
    id: 'gf:open-work-orders',
    label: 'Open work orders',
    value: Number(row?.count ?? 0),
    unit: 'count',
    source: 'work_orders',
    asOf: at,
  };
}

async function runLeaseExpiring(
  db: DatabaseClient,
  scope: RunScope,
  at: string,
): Promise<GroundingFactShape | null> {
  const { tenantId, role, userId } = scope;
  const now = new Date();

  let whereClause;
  if (role === 'tenant' && userId) {
    whereClause = and(
      eq(leases.tenantId, tenantId),
      eq(leases.status, 'expiring_soon' as never),
      gte(leases.endDate, now),
      sql`${leases.customerId} IN (
        SELECT ${customers.id} FROM ${customers}
        INNER JOIN ${users}
          ON ${users.email} = ${customers.email}
          AND ${users.tenantId} = ${customers.tenantId}
        WHERE ${customers.tenantId} = ${tenantId}
          AND ${users.id} = ${userId}
      )`,
    );
  } else if (role === 'owner' && userId) {
    whereClause = and(
      eq(leases.tenantId, tenantId),
      eq(leases.status, 'expiring_soon' as never),
      gte(leases.endDate, now),
      sql`${leases.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.ownerId} = ${userId}
      )`,
    );
  } else if (role === 'manager' && userId) {
    // Follow-up schema (Docs/TODO_BACKLOG.md): widen to a staff_assignments table once it exists.
    whereClause = and(
      eq(leases.tenantId, tenantId),
      eq(leases.status, 'expiring_soon' as never),
      gte(leases.endDate, now),
      sql`${leases.propertyId} IN (
        SELECT ${properties.id} FROM ${properties}
        WHERE ${properties.tenantId} = ${tenantId}
          AND ${properties.managerId} = ${userId}
      )`,
    );
  } else {
    whereClause = and(
      eq(leases.tenantId, tenantId),
      eq(leases.status, 'expiring_soon' as never),
      gte(leases.endDate, now),
    );
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(leases)
    .where(whereClause);
  return {
    id: 'gf:lease-expiring',
    label: 'Leases expiring within 30 days',
    value: Number(row?.count ?? 0),
    unit: 'count',
    source: 'leases',
    asOf: at,
  };
}
