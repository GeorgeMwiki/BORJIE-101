/**
 * Owner-spawn → BUYER tab projection (surface-completion SC-6) — the
 * previously 100%-ABSENT leg of the multi-surface completion web. The
 * workforce leg has had this bridge for a while
 * (routes/workforce/tab-projection.ts); the buyer surface materialized
 * NOTHING when an owner spawned a buyer-facing capability. This closes it.
 *
 * THE BUYER ASYMMETRY (corrected buyer model — buyer ≠ tenant-insider):
 *   - Workforce projections default to EVERY workforce role when the owner
 *     does not restrict them — workers are tenant INSIDERS.
 *   - Buyer projections are EXPLICIT OPT-IN ONLY: a tab projects to buyers
 *     IFF its config carries `buyerProjection` (written by the owner-side
 *     manage_tab verb / the genUI generator). An owner tab NEVER leaks to
 *     external counterparties by default.
 *
 * CONTEXT-AWARE + PER-MEMBERSHIP SCOPE: a buyer is USER-OWNED and
 * multi-org — one account spans many seller orgs. The projection read is by
 * definition CROSS-tenant (the buyer's request carries no seller-tenant
 * GUC), so it runs under the service-role bypass BOUNDED EXACTLY to the
 * tenants where the caller holds an ACTIVE buyer_connection membership —
 * the membership graph IS the permission. Each projected tab carries the
 * org/tenant it came from, so the app renders per-org overlays and the
 * buyer sees only what involves THEM.
 *
 * Mobile contract mirrors the workforce one: the app renders KNOWN kinds
 * parameterized by the payload; unknown kinds are skipped (honest-degrade).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  withServiceRoleContext,
  createDrizzleOrgMembershipRepository,
  createDrizzleIdentityRepository,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];
type OrgMembershipRepository = ReturnType<
  typeof createDrizzleOrgMembershipRepository
>;
type IdentityRepository = ReturnType<typeof createDrizzleIdentityRepository>;

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Projectable kinds + payload schema (pure)
// ---------------------------------------------------------------------------

/**
 * The buyer-actionable semantic tab kinds — the "other side of the coin"
 * surface: see + bid + transact + comply.
 *
 * LOCKSTEP LAW: this set MUST equal what `buyer-mobile` can actually render
 * (`BUYER_PROJECTED_KIND_TO_SCREEN` in
 * `apps/buyer-mobile/src/marketplace/buyerTabProjection.ts`). Admitting a kind
 * the device has no screen for makes the owner believe a buyer-facing
 * capability materialised that the buyer never sees — a broken half-loop.
 * Growing this set is a TWO-PART change: add the buyer-mobile screen + this
 * entry together (guarded by the buyer lockstep test).
 */
export const BUYER_PROJECTABLE_TAB_KINDS = [
  'marketplace',
  // Compiled-flow projection (business-process compiler): the buyer leg of the
  // golden buyer-inquiry flow (their inquiry + response tab).
  'inquiry_respond',
] as const;

export type BuyerProjectableTabKind =
  (typeof BUYER_PROJECTABLE_TAB_KINDS)[number];

const BUYER_KIND_SET: ReadonlySet<string> = new Set(
  BUYER_PROJECTABLE_TAB_KINDS,
);

/** Hard cap on projections returned per response. */
export const MAX_BUYER_PROJECTED_TABS = 20;

export const projectedBuyerTabSchema = z
  .object({
    /** The owner-cockpit stable tab id (`owner_tabs_structural.tab_id`). */
    id: z.string().min(1).max(120),
    kind: z.enum(
      BUYER_PROJECTABLE_TAB_KINDS as unknown as readonly [string, ...string[]],
    ),
    label: z.string().min(1).max(200),
    /** The seller org this projection belongs to — per-org overlay scope. */
    organizationId: z.string().min(1).max(128),
    tenantId: z.string().min(1).max(128),
    /** Seller display name (best-effort; null when unresolvable). */
    tenantName: z.string().max(200).nullable(),
    origin: z.literal('owner-spawned'),
  })
  .strict();

export type ProjectedBuyerTab = z.infer<typeof projectedBuyerTabSchema>;

/** The narrow structural-row slice the projection needs. */
export interface BuyerTabStructuralRow {
  readonly tabId: string;
  readonly tenantId: string;
  readonly label: string;
  readonly position: number;
  readonly config: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Resolve a row's buyer-projected kind. EXPLICIT OPT-IN ONLY: no
 * `config.buyerProjection` → the row does not project to buyers, period —
 * the generic config.kind/type fallbacks the workforce leg allows would be
 * an external-leak hazard here.
 */
export function resolveBuyerProjectedKind(
  config: unknown,
): BuyerProjectableTabKind | null {
  if (!isRecord(config)) return null;
  const bp = config.buyerProjection;
  if (!isRecord(bp)) return null;
  const kind = bp.kind;
  if (typeof kind !== 'string') return null;
  const normalized = kind.trim().toLowerCase();
  return BUYER_KIND_SET.has(normalized)
    ? (normalized as BuyerProjectableTabKind)
    : null;
}

/**
 * Build the validated, ordered, per-org-context buyer projection list.
 * Pure: rows without the explicit opt-in, with unknown kinds, or failing
 * payload validation are skipped.
 */
export function buildBuyerProjectedTabs(
  rows: ReadonlyArray<BuyerTabStructuralRow>,
  memberships: ReadonlyArray<{
    readonly organizationId: string;
    readonly platformTenantId: string;
  }>,
  tenantNames: ReadonlyMap<string, string>,
): ReadonlyArray<ProjectedBuyerTab> {
  const orgByTenant = new Map<string, string>();
  for (const m of memberships) {
    if (!orgByTenant.has(m.platformTenantId)) {
      orgByTenant.set(m.platformTenantId, m.organizationId);
    }
  }
  const sorted = [...rows].sort(
    (a, b) => a.position - b.position || a.label.localeCompare(b.label),
  );
  const seen = new Set<string>();
  const projected: ProjectedBuyerTab[] = [];
  for (const row of sorted) {
    if (projected.length >= MAX_BUYER_PROJECTED_TABS) break;
    const kind = resolveBuyerProjectedKind(row.config);
    if (!kind) continue;
    const organizationId = orgByTenant.get(row.tenantId);
    if (!organizationId) continue; // not a connected tenant — never visible
    const dedupeKey = `${row.tenantId}:${row.tabId}`;
    if (seen.has(dedupeKey)) continue;
    const parsed = projectedBuyerTabSchema.safeParse({
      id: row.tabId,
      kind,
      label: row.label,
      organizationId,
      tenantId: row.tenantId,
      tenantName: tenantNames.get(row.tenantId) ?? null,
      origin: 'owner-spawned',
    });
    if (!parsed.success) continue;
    seen.add(dedupeKey);
    projected.push(parsed.data);
  }
  return projected;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export interface BuyerTabProjectionDeps {
  /** Test seams — default to the Drizzle repos over the request db. */
  readonly membershipRepo?: OrgMembershipRepository;
  readonly identityRepo?: IdentityRepository;
}

/** Bound the structural read so a pathological strip cannot bloat the GET. */
const STRUCTURAL_READ_LIMIT = 400;

export function createBuyerTabProjectionRouter(
  deps: BuyerTabProjectionDeps = {},
): Hono {
  const router = new Hono();
  router.use('*', authMiddleware);
  router.use('*', databaseMiddleware);

  router.get('/', async (c) => {
    const db = (c.get('db') as ServiceRoleDb | null) ?? null;
    if (!db) {
      return c.json(
        {
          success: false,
          error: { code: 'DATABASE_UNAVAILABLE', message: 'No database client' },
        },
        503,
      );
    }
    const auth = c.get('auth');
    const identityRepo =
      deps.identityRepo ??
      createDrizzleIdentityRepository(
        db as Parameters<typeof createDrizzleIdentityRepository>[0],
      );
    const membershipRepo =
      deps.membershipRepo ??
      createDrizzleOrgMembershipRepository(
        db as Parameters<typeof createDrizzleOrgMembershipRepository>[0],
      );

    // Identity → ACTIVE buyer connections. No identity / no connections =
    // honest-empty (a fresh buyer sees the static shell only).
    const identity = await identityRepo.resolveByPrincipal(auth.userId);
    if (!identity) return c.json({ success: true, data: [] });
    const memberships = (
      await membershipRepo.listActiveForIdentity(identity.id)
    ).filter((m) => m.relationshipType === 'buyer_connection');
    if (memberships.length === 0) return c.json({ success: true, data: [] });

    const connectedTenantIds = [
      ...new Set(memberships.map((m) => m.platformTenantId)),
    ];
    // Bind the id list as an explicit `ARRAY[...]::text[]` — a bare
    // `ANY(${connectedTenantIds})` makes drizzle spread it into the invalid
    // record constructor `ANY(($1, $2))`, which throws and the catch below
    // silently degrades the whole projection to empty.
    const connectedTenantIdsArray = sql`ARRAY[${sql.join(
      connectedTenantIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;

    // Cross-tenant structural read, BOUNDED to exactly the connected
    // tenants (the membership graph is the permission); buyer opt-in rows
    // only. Failure degrades honest-empty — the buyer shell never breaks.
    let rows: BuyerTabStructuralRow[] = [];
    const tenantNames = new Map<string, string>();
    try {
      const raw = (await withServiceRoleContext(db, (sdb) =>
        (sdb as unknown as DbExec).execute(sql`
          SELECT tab_id, tenant_id, label, position, config
            FROM owner_tabs_structural
           WHERE tenant_id = ANY(${connectedTenantIdsArray})
             AND status = 'active'
             AND kind = 'custom'
             AND config ? 'buyerProjection'
           ORDER BY position ASC
           LIMIT ${STRUCTURAL_READ_LIMIT}
        `),
      )) as unknown as Array<Record<string, unknown>>;
      rows = raw.map((r) => ({
        tabId: String(r.tab_id),
        tenantId: String(r.tenant_id),
        label: String(r.label ?? ''),
        position: Number(r.position ?? 0),
        config:
          typeof r.config === 'string'
            ? (JSON.parse(r.config) as unknown)
            : r.config,
      }));
      const names = (await withServiceRoleContext(db, (sdb) =>
        (sdb as unknown as DbExec).execute(sql`
          SELECT id, name FROM tenants WHERE id = ANY(${connectedTenantIdsArray})
        `),
      )) as unknown as Array<Record<string, unknown>>;
      for (const n of names) tenantNames.set(String(n.id), String(n.name));
    } catch {
      return c.json({ success: true, data: [] });
    }

    return c.json({
      success: true,
      data: buildBuyerProjectedTabs(rows, memberships, tenantNames),
    });
  });

  return router;
}

export const buyerTabProjectionRouter = createBuyerTabProjectionRouter();
