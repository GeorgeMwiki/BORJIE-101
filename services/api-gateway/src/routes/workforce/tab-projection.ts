/**
 * Owner-spawn → workforce tab PROJECTION — the bridge between the owner
 * cockpit's dynamic tab strip and the workforce app's fixed tab shell.
 *
 * THE VISION (universal-core porting law): the owner spawns a tab in
 * owner-web (e.g. a marketplace cockpit tab) and every workforce member
 * of that SAME tenant sees a role-scoped PROJECTION of it appear in
 * workforce-mobile. Mobile does NO dynamic UI generation — it renders a
 * KNOWN tab kind, parameterized by the projection payload below. A new
 * vertical changes only the projectable-kind semantics, never this wiring.
 *
 * Source of truth: `owner_tabs_structural` (migration 0169) — one row per
 * (tenant, user, tab_id), written by the `manage_tab` action-executor verb
 * (services/api-gateway/src/services/action-executor/handlers/tabs.ts).
 * Only owner-side actors can reach that verb (confirm-action gated), so
 * every `kind='custom'` row is owner-spawned by construction.
 *
 * Semantic-kind contract (v1)
 * ---------------------------
 * The structural `kind` column is only 'system' | 'custom'; the SEMANTIC
 * kind a projection carries lives in the row's `config` jsonb bag. We
 * resolve it in priority order:
 *
 *   1. config.workforceProjection.kind   — explicit projection opt-in
 *   2. config.kind | config.type | config.template — spawn-time semantic
 *
 * Only kinds in PROJECTABLE_TAB_KINDS (the owner-cockpit tab kinds the
 * workforce can act on) project; anything else is silently not projected
 * (honest-degrade: no guessing from labels).
 *
 * Role-scoping rule (v1)
 * ----------------------
 * If the row carries `config.workforceProjection.roles` (an array of
 * workforce role ids) the projection is visible ONLY to those roles.
 * When absent, the projection is visible to EVERY workforce role of the
 * tenant (manager + workers) — documented v1 default.
 *
 * Tenant isolation: `fetchProjectedTabs` predicates on
 * `tenant_id = <caller's tenant>` explicitly (belt-and-braces on top of
 * the FORCE-enabled RLS bound by databaseMiddleware). A worker can NEVER
 * see another tenant's tabs.
 */

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { ownerTabsStructural } from '@borjie/database';
import { WORKFORCE_ROLE_IDS } from '@borjie/persona-runtime';

// ---------------------------------------------------------------------------
// Projectable kinds + outgoing payload schema
// ---------------------------------------------------------------------------

/**
 * Owner-cockpit semantic tab kinds the workforce surface can act on.
 * Mirrors the workforce-actionable subset of owner-web's `OwnerTabKind`
 * (apps/owner-web/src/lib/owner-tabs-store.ts). Mobile renders the kinds
 * it knows and SKIPS the rest with a logged warning, so growing this set
 * is additive and non-breaking.
 */
export const PROJECTABLE_TAB_KINDS = [
  'marketplace',
  'procurement',
  'treasury',
  'compliance',
  'safety',
  'reports',
  // Compiled-flow projection (business-process compiler): the worker leg of the
  // golden buyer-inquiry flow (the response queue).
  'inquiry_respond',
] as const;

export type ProjectableTabKind = (typeof PROJECTABLE_TAB_KINDS)[number];

const PROJECTABLE_KIND_SET: ReadonlySet<string> = new Set(
  PROJECTABLE_TAB_KINDS,
);

const WORKFORCE_ROLE_SET: ReadonlySet<string> = new Set(
  WORKFORCE_ROLE_IDS as ReadonlyArray<string>,
);

/** Hard cap on projections returned per tab-config response. */
export const MAX_PROJECTED_TABS = 12;

/** The additive `projectedTabs[]` entry contract — zod-validated on egress. */
export const projectedWorkforceTabSchema = z
  .object({
    /** The owner-cockpit stable tab id (`owner_tabs_structural.tab_id`). */
    id: z.string().min(1).max(120),
    /** Semantic kind — mobile maps this onto a KNOWN screen. */
    kind: z.enum(
      PROJECTABLE_TAB_KINDS as unknown as readonly [string, ...string[]],
    ),
    /** The owner-given label, rendered verbatim on the mobile tab. */
    label: z.string().min(1).max(200),
    /** Provenance marker — every projection is owner-spawned. */
    origin: z.literal('owner-spawned'),
  })
  .strict();

export type ProjectedWorkforceTab = z.infer<typeof projectedWorkforceTabSchema>;

// ---------------------------------------------------------------------------
// Pure resolution helpers
// ---------------------------------------------------------------------------

/** The narrow structural-row slice the projection needs. */
export interface OwnerTabStructuralLite {
  readonly tabId: string;
  readonly label: string;
  readonly position: number;
  readonly config: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function readWorkforceProjection(
  config: unknown,
): Record<string, unknown> | null {
  if (!isRecord(config)) return null;
  const wp = config.workforceProjection;
  return isRecord(wp) ? wp : null;
}

/**
 * Resolve a structural row's SEMANTIC kind from its config bag. Returns
 * null when no projectable kind is declared — the row simply does not
 * project (no label guessing, no defaults).
 */
export function resolveProjectedKind(
  config: unknown,
): ProjectableTabKind | null {
  const wp = readWorkforceProjection(config);
  const candidates: ReadonlyArray<unknown> = [
    wp?.kind,
    isRecord(config) ? config.kind : undefined,
    isRecord(config) ? config.type : undefined,
    isRecord(config) ? config.template : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toLowerCase();
    if (PROJECTABLE_KIND_SET.has(normalized)) {
      return normalized as ProjectableTabKind;
    }
  }
  return null;
}

/**
 * Resolve the set of workforce roles a projection is visible to.
 * `null` = visible to EVERY workforce role (the documented v1 default
 * when the owner did not restrict the projection).
 */
export function resolveProjectionRoles(
  config: unknown,
): ReadonlySet<string> | null {
  const wp = readWorkforceProjection(config);
  const raw = wp?.roles;
  if (!Array.isArray(raw)) return null;
  const roles = raw.filter(
    (r): r is string => typeof r === 'string' && WORKFORCE_ROLE_SET.has(r),
  );
  return roles.length > 0 ? new Set(roles) : null;
}

/**
 * Build the role-scoped, validated, ordered projection list from raw
 * structural rows. Pure: never throws — rows that fail kind resolution,
 * role scoping, or payload validation are skipped.
 */
export function buildProjectedTabs(
  rows: ReadonlyArray<OwnerTabStructuralLite>,
  role: string,
): ReadonlyArray<ProjectedWorkforceTab> {
  const sorted = [...rows].sort(
    (a, b) => a.position - b.position || a.label.localeCompare(b.label),
  );
  const seen = new Set<string>();
  const projected: ProjectedWorkforceTab[] = [];
  for (const row of sorted) {
    if (projected.length >= MAX_PROJECTED_TABS) break;
    const kind = resolveProjectedKind(row.config);
    if (!kind) continue;
    const roles = resolveProjectionRoles(row.config);
    if (roles && !roles.has(role)) continue;
    if (seen.has(row.tabId)) continue;
    const parsed = projectedWorkforceTabSchema.safeParse({
      id: row.tabId,
      kind,
      label: row.label,
      origin: 'owner-spawned',
    });
    if (!parsed.success) continue;
    seen.add(row.tabId);
    projected.push(parsed.data);
  }
  return projected;
}

// ---------------------------------------------------------------------------
// Data path — read the caller-tenant's active owner-spawned tabs
// ---------------------------------------------------------------------------

interface ProjectionLogger {
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

/** Bound the structural read so a pathological strip cannot bloat the GET. */
const STRUCTURAL_READ_LIMIT = 200;

/**
 * Fetch + project the caller-tenant's active owner-spawned tabs.
 *
 * HONEST-DEGRADE: any failure on this auxiliary path logs a warning and
 * returns `[]` — the base tab-config contract is never broken by the
 * projection extension.
 */
export async function fetchProjectedTabs(
  db: {
    select: (...args: ReadonlyArray<unknown>) => any;
  },
  tenantId: string,
  role: string,
  logger: ProjectionLogger,
): Promise<ReadonlyArray<ProjectedWorkforceTab>> {
  try {
    const rows: ReadonlyArray<OwnerTabStructuralLite> = await db
      .select({
        tabId: ownerTabsStructural.tabId,
        label: ownerTabsStructural.label,
        position: ownerTabsStructural.position,
        config: ownerTabsStructural.config,
      })
      .from(ownerTabsStructural)
      .where(
        and(
          // Belt-and-braces tenant clamp on top of FORCE-enabled RLS:
          // a worker NEVER sees another tenant's tabs.
          eq(ownerTabsStructural.tenantId, tenantId),
          eq(ownerTabsStructural.status, 'active'),
          eq(ownerTabsStructural.kind, 'custom'),
        ),
      )
      .limit(STRUCTURAL_READ_LIMIT);
    return buildProjectedTabs(rows, role);
  } catch (error) {
    logger.warn('workforce-tab-projection: structural read failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
