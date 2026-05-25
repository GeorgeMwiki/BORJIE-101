/**
 * Tenants Drizzle adapter — backs the HQ-tier `platform.list_tenants` +
 * `platform.create_tenant` tools (Central Command Phase B — B1).
 *
 * Implements both the read-side `TenantsServicePort` (paginated list)
 * AND the write-side `CreateTenantPort` (provision tenant + owner user
 * with rollback). One adapter for both to keep the dependency surface
 * small — composition root wires the same instance into both HQ tools.
 *
 * Identity-scoped filtering happens AT THE HQ-TOOL layer (it iterates
 * `callerCanReachTenant`). This service stays scope-agnostic so the
 * same code path serves caller-scoped reads and platform-wide ops
 * (e.g. cron jobs, the sovereign composition root).
 *
 * Hard DB failures degrade gracefully:
 *   - listTenants     : returns `{ rows: [], nextCursor: null, totalReturned: 0 }`
 *   - slugExists      : returns `false` (caller treats as "unknown / proceed")
 *   - provisionTenant : RE-THROWS — sovereign-ledger requires the caller
 *                       to know the write failed
 *   - rollbackTenantProvision : logs + RE-THROWS — same contract
 */
import { randomUUID } from 'crypto';
import { and, asc, desc, eq, sql, gt, isNull } from 'drizzle-orm';
import {
  tenants,
  users,
  userStatusEnum,
  type tenantStatusEnum,
} from '../../schemas/tenant.schema.js';
import { logger } from '../../logger.js';
import type { DatabaseClient } from '../../client.js';

// ─────────────────────────────────────────────────────────────────────
// Port shapes (kept structural so we don't compile-time-depend on
// `@borjie/central-intelligence`).
// ─────────────────────────────────────────────────────────────────────

export interface ListTenantsRow {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: 'active' | 'churned' | 'pending' | 'suspended';
  readonly mrrUsdCents: number;
  readonly lastActiveAt: string | null;
  readonly createdAt: string;
}

export interface ListTenantsResult {
  readonly rows: ReadonlyArray<ListTenantsRow>;
  readonly nextCursor: string | null;
  readonly totalReturned: number;
}

export interface ListTenantsArgs {
  readonly filter: 'active' | 'churned' | 'all';
  readonly limit: number;
  readonly cursor: string | null;
}

export interface CreateTenantArgs {
  readonly slug: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly plan: 'starter' | 'pro' | 'enterprise';
  /**
   * Owner's family name. Optional — when omitted we mark the user row
   * as profile-incomplete via `preferences.isProfileIncomplete = true`
   * instead of seeding a literal `'TBD'` string that previously shipped
   * to the UI verbatim. The HQ tool surface keeps email-only creation
   * legal so the operator can move fast; the "complete your profile"
   * nudge is the system-of-record for finishing the row.
   */
  readonly ownerLastName?: string | null;
}

export interface CreateTenantResult {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly plan: 'starter' | 'pro' | 'enterprise';
  readonly ownerUserId: string;
  readonly ownerEmail: string;
  readonly createdAt: string;
}

export interface RollbackTenantArgs {
  readonly tenantId: string;
  readonly ownerUserId: string;
}

export interface PlatformTenantsService {
  listTenants(args: ListTenantsArgs): Promise<ListTenantsResult>;
  slugExists(slug: string): Promise<boolean>;
  provisionTenant(args: CreateTenantArgs): Promise<CreateTenantResult>;
  rollbackTenantProvision(args: RollbackTenantArgs): Promise<void>;
  /** Used by `platform.create_user` — see users.platform.service.ts. */
  tenantExists(tenantId: string): Promise<boolean>;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

// Existing tenants.subscription_tier enum is starter|professional|enterprise|custom.
// HQ tool input uses starter|pro|enterprise. Map between them.
const HQ_TO_DB_PLAN: Readonly<
  Record<CreateTenantArgs['plan'], 'starter' | 'professional' | 'enterprise'>
> = {
  starter: 'starter',
  pro: 'professional',
  enterprise: 'enterprise',
};

const DB_TO_HQ_STATUS: Readonly<
  Record<string, ListTenantsRow['status']>
> = {
  active: 'active',
  suspended: 'suspended',
  pending: 'pending',
  trial: 'pending',
  cancelled: 'churned',
};

function toIso(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
    return value;
  }
  return '';
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

interface CursorPayload {
  readonly createdAt: string;
  readonly id: string;
}

function encodeCursor(c: CursorPayload): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

interface RawTenantRow {
  id: string;
  slug: string;
  name: string;
  status: string | null;
  lastActivityAt: Date | string | null;
  createdAt: Date | string;
}

function toListRow(raw: RawTenantRow): ListTenantsRow {
  const dbStatus = String(raw.status ?? 'pending');
  const mapped = DB_TO_HQ_STATUS[dbStatus] ?? 'pending';
  return {
    tenantId: raw.id,
    slug: raw.slug,
    name: raw.name,
    status: mapped,
    // MRR is not on the tenants table directly — billing lives in a
    // separate aggregate that B1 deliberately does NOT join here to
    // keep the page query cheap. Composition root may layer a billing
    // join later via a separate B2-owned adapter; until then this is
    // a deterministic zero so the schema validator accepts the row.
    // Follow-up B2 (Docs/TODO_BACKLOG.md): wire MRR from tenant_finance / subscription tables.
    mrrUsdCents: 0,
    lastActiveAt: raw.lastActivityAt ? toIso(raw.lastActivityAt) : null,
    createdAt: toIso(raw.createdAt),
  };
}

export function createPlatformTenantsService(
  db: DatabaseClient,
): PlatformTenantsService {
  return {
    async listTenants(args) {
      try {
        const limit = clampLimit(args.limit);
        const cursor = decodeCursor(args.cursor);

        // Filter mapping:
        //   active   → status = 'active'
        //   churned  → status IN ('cancelled', 'suspended')
        //   all      → no filter
        let whereExpr;
        if (args.filter === 'active') {
          whereExpr = and(
            eq(tenants.status, 'active' as never),
            isNull(tenants.deletedAt),
          );
        } else if (args.filter === 'churned') {
          whereExpr = and(
            sql`${tenants.status} IN ('cancelled', 'suspended')`,
            isNull(tenants.deletedAt),
          );
        } else {
          whereExpr = isNull(tenants.deletedAt);
        }

        if (cursor) {
          // Forward-walk: (createdAt, id) > cursor (descending, so flip
          // to a `<` for our ORDER BY createdAt DESC). The HQ tool
          // pages backwards in time (newest first).
          whereExpr = and(
            whereExpr,
            sql`(${tenants.createdAt}, ${tenants.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`,
          );
        }

        // Fetch limit+1 so we can detect whether more rows exist.
        const rowsRaw = (await db
          .select({
            id: tenants.id,
            slug: tenants.slug,
            name: tenants.name,
            status: tenants.status,
            lastActivityAt: tenants.lastActivityAt,
            createdAt: tenants.createdAt,
          })
          .from(tenants)
          .where(whereExpr)
          .orderBy(desc(tenants.createdAt), desc(tenants.id))
          .limit(limit + 1)) as ReadonlyArray<RawTenantRow>;

        const trimmed = rowsRaw.slice(0, limit);
        const hasMore = rowsRaw.length > limit;
        const last = trimmed[trimmed.length - 1];
        const nextCursor =
          hasMore && last
            ? encodeCursor({
                createdAt: toIso(last.createdAt),
                id: last.id,
              })
            : null;

        const rows = trimmed.map(toListRow);
        return {
          rows,
          nextCursor,
          totalReturned: rows.length,
        };
      } catch (error) {
        logger.error('platform.tenants.listTenants failed', { error: error });
        return { rows: [], nextCursor: null, totalReturned: 0 };
      }
    },

    async slugExists(slug) {
      try {
        if (!slug) return false;
        const rows = (await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.slug, slug))
          .limit(1)) as ReadonlyArray<{ id: string }>;
        return rows.length > 0;
      } catch (error) {
        logger.error('platform.tenants.slugExists failed', { error: error });
        return false;
      }
    },

    async tenantExists(tenantId) {
      try {
        if (!tenantId) return false;
        const rows = (await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1)) as ReadonlyArray<{ id: string }>;
        return rows.length > 0;
      } catch (error) {
        logger.error('platform.tenants.tenantExists failed', { error: error });
        return false;
      }
    },

    async provisionTenant(args) {
      if (!args.slug) {
        throw new Error('platform.tenants.provisionTenant: slug is required');
      }
      if (!args.ownerEmail) {
        throw new Error(
          'platform.tenants.provisionTenant: ownerEmail is required',
        );
      }
      const tenantId = randomUUID();
      const ownerUserId = randomUUID();
      const now = new Date();
      const dbPlan = HQ_TO_DB_PLAN[args.plan];
      // Heuristic owner name from email local-part. Production composition
      // root may layer a separate "send invite + collect profile" step;
      // the HQ-tool surface intentionally only requires email at create-time.
      const local = args.ownerEmail.split('@')[0] ?? 'owner';
      const firstName = local.length > 0 ? local : 'Owner';
      // Previously seeded the literal `'TBD'` string which shipped to
      // the UI verbatim. Now we either take the explicit caller value
      // (preferred — keeps the HQ surface clean) or default to an empty
      // string and flag the row as profile-incomplete via the
      // `preferences.isProfileIncomplete` JSONB key. The "complete your
      // profile" surface in the owner-portal reads this flag and shows
      // a nudge until the operator fills the row.
      const explicitLastName =
        typeof args.ownerLastName === 'string' ? args.ownerLastName.trim() : '';
      const lastName = explicitLastName;
      const isProfileIncomplete = explicitLastName.length === 0;
      try {
        // Drizzle-postgres exposes `.transaction(cb)`. Duck-type to a
        // minimal Transactional surface so tests can mock it without
        // implementing the full Drizzle client.
        const tx = db as unknown as {
          transaction<T>(
            cb: (t: typeof db) => Promise<T>,
          ): Promise<T>;
        };
        await tx.transaction(async (tx) => {
          await tx.insert(tenants).values({
            id: tenantId,
            name: args.name,
            slug: args.slug,
            status: 'active',
            subscriptionTier: dbPlan,
            primaryEmail: args.ownerEmail,
            createdAt: now,
            updatedAt: now,
          } as never);
          await tx.insert(users).values({
            id: ownerUserId,
            tenantId,
            email: args.ownerEmail,
            firstName,
            lastName,
            status: 'pending_activation',
            isOwner: true,
            preferences: { isProfileIncomplete },
            createdAt: now,
            updatedAt: now,
          } as never);
        });
      } catch (error) {
        logger.error('platform.tenants.provisionTenant failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.tenants.provisionTenant failed');
      }
      return {
        tenantId,
        slug: args.slug,
        name: args.name,
        plan: args.plan,
        ownerUserId,
        ownerEmail: args.ownerEmail,
        createdAt: now.toISOString(),
      };
    },

    async rollbackTenantProvision(args) {
      try {
        // Soft-delete the tenant (preserves audit chain). Cascade ON
        // DELETE rules would wipe users; we want them retained too —
        // mark the owner user `deactivated` instead.
        const tx = db as unknown as {
          transaction<T>(
            cb: (t: typeof db) => Promise<T>,
          ): Promise<T>;
        };
        await tx.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              status: 'deactivated',
              updatedAt: new Date(),
            } as never)
            .where(eq(users.id, args.ownerUserId));
          await tx
            .update(tenants)
            .set({
              status: 'cancelled',
              deletedAt: new Date(),
              updatedAt: new Date(),
            } as never)
            .where(eq(tenants.id, args.tenantId));
        });
      } catch (error) {
        logger.error('platform.tenants.rollbackTenantProvision failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.tenants.rollbackTenantProvision failed');
      }
    },
  };
}

// Suppress unused-import lint for type-only re-exports kept for caller convenience.
export type {
  tenantStatusEnum,
  userStatusEnum,
};
// `asc` / `gt` imported for forward compatibility with cursor-asc paging.
void asc;
void gt;
