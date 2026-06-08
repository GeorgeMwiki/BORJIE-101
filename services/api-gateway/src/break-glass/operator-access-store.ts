/**
 * Break-glass operator-access store (INV-A / FIRE-1).
 *
 * The durable engine behind the break-glass spine. Enforces, in code, the
 * four guarantees the invariant demands:
 *   - explicit + DENY-BY-DEFAULT — a request lands `pending`; nothing is
 *     usable until the tenant consents.
 *   - tenant CONSENT — `consent()` flips `pending → active`, stamping who/when.
 *   - TIME-BOXED — `assertActiveGrant()` rejects an expired grant even if its
 *     status column still reads `active`.
 *   - AUDITED (hash-chained) + tenant-VISIBLE — `recordAccess()` appends a
 *     SHA-256-chained row the tenant reads on owner-web.
 *
 * The store is defined as an interface so route handlers + middleware depend
 * on the seam, and unit tests drive an in-memory implementation
 * (`createInMemoryOperatorAccessStore`) without a live Postgres. The Drizzle
 * implementation performs cross-tenant platform writes under
 * `withServiceRoleContext`.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  createDatabaseClient,
  operatorAccessGrants,
  operatorAccessLog,
  withServiceRoleContext,
} from '@borjie/database';
import { computeHash, verifyChain, type ChainableEntry } from './hash-chain';
import {
  DEFAULT_GRANT_TTL_MINUTES,
  GENESIS_HASH,
  type BreakGlassScope,
  type GrantStatus,
  type OperatorAccessGrant,
  type OperatorAccessLogEntry,
  type RequestGrantInput,
} from './types';

// Importing the `DatabaseClient` type by name from '@borjie/database' resolves to
// a drizzle-orm/postgres-js namespace of the same name (TS2709), not the type —
// derive it from the value export instead (same pattern as estate-mind-wiring.ts /
// agency-port-bindings.ts).
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export interface RequestGrantArgs extends RequestGrantInput {
  readonly operatorId: string;
  readonly operatorEmail?: string | null;
}

export interface RecordAccessArgs {
  readonly grantId: string;
  readonly tenantId: string;
  readonly operatorId: string;
  readonly route: string;
  readonly scope: BreakGlassScope;
  readonly rowCount: number;
  readonly metadata?: Record<string, unknown>;
}

export type ActiveGrantCheck =
  | { readonly ok: true; readonly grant: OperatorAccessGrant }
  | {
      readonly ok: false;
      readonly reason:
        | 'no_grant'
        | 'not_consented'
        | 'expired'
        | 'revoked'
        | 'scope_not_granted';
    };

export interface OperatorAccessStore {
  /** Borjie staff files a deny-by-default request for one tenant's data. */
  requestGrant(args: RequestGrantArgs): Promise<OperatorAccessGrant>;
  /** The owning tenant CONSENTS — flips pending → active (time-boxed). */
  consent(args: {
    grantId: string;
    tenantId: string;
    consentedBy: string;
  }): Promise<OperatorAccessGrant>;
  /** Tenant or operator revokes — flips → revoked. Nothing is deleted. */
  revoke(args: {
    grantId: string;
    tenantId: string;
    revokedBy: string;
  }): Promise<OperatorAccessGrant>;
  /** Tenant denies a pending request — flips → denied. */
  deny(args: {
    grantId: string;
    tenantId: string;
    deniedBy: string;
  }): Promise<OperatorAccessGrant>;
  /**
   * The gate. Returns ok only when an ACTIVE, CONSENTED, NON-EXPIRED grant
   * for (operatorId, tenantId) covers `scope`. Deny-by-default for every
   * other case — this is what makes the leaks impossible to reach silently.
   */
  assertActiveGrant(args: {
    operatorId: string;
    tenantId: string;
    scope: BreakGlassScope;
  }): Promise<ActiveGrantCheck>;
  /** Append a hash-chained access row (Access-Transparency). */
  recordAccess(args: RecordAccessArgs): Promise<OperatorAccessLogEntry>;
  /** Tenant-visible: list grants for one tenant (owner-web Trust Center). */
  listGrantsForTenant(tenantId: string): Promise<readonly OperatorAccessGrant[]>;
  /** Tenant-visible: list the access log for one tenant. */
  listAccessLogForTenant(
    tenantId: string,
  ): Promise<readonly OperatorAccessLogEntry[]>;
  /** Verify the tenant's hash chain end-to-end. */
  verifyTenantChain(
    tenantId: string,
  ): Promise<{ ok: true } | { ok: false; brokenAtSeq: number }>;
}

// ── helpers ────────────────────────────────────────────────────────────────

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return iso(value);
}

function isExpired(grant: OperatorAccessGrant, now: Date): boolean {
  return new Date(grant.expiresAt).getTime() <= now.getTime();
}

function effectiveStatus(grant: OperatorAccessGrant, now: Date): GrantStatus {
  if (grant.status === 'active' && isExpired(grant, now)) return 'expired';
  return grant.status;
}

function checkActive(
  grant: OperatorAccessGrant | undefined,
  scope: BreakGlassScope,
  now: Date,
): ActiveGrantCheck {
  if (!grant) return { ok: false, reason: 'no_grant' };
  if (grant.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (grant.status === 'pending' || grant.status === 'denied') {
    return { ok: false, reason: 'not_consented' };
  }
  if (effectiveStatus(grant, now) === 'expired') {
    return { ok: false, reason: 'expired' };
  }
  if (!grant.scopes.includes(scope)) {
    return { ok: false, reason: 'scope_not_granted' };
  }
  return { ok: true, grant };
}

function rowToGrant(row: Record<string, unknown>): OperatorAccessGrant {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId ?? row.tenant_id),
    operatorId: String(row.operatorId ?? row.operator_id),
    operatorEmail:
      (row.operatorEmail ?? row.operator_email) == null
        ? null
        : String(row.operatorEmail ?? row.operator_email),
    justificationCode: String(row.justificationCode ?? row.justification_code),
    reason: String(row.reason ?? ''),
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    status: String(row.status ?? 'pending') as GrantStatus,
    requestedAt: iso(row.requestedAt ?? row.requested_at),
    consentedAt: isoOrNull(row.consentedAt ?? row.consented_at),
    consentedBy:
      (row.consentedBy ?? row.consented_by) == null
        ? null
        : String(row.consentedBy ?? row.consented_by),
    expiresAt: iso(row.expiresAt ?? row.expires_at),
    revokedAt: isoOrNull(row.revokedAt ?? row.revoked_at),
    revokedBy:
      (row.revokedBy ?? row.revoked_by) == null
        ? null
        : String(row.revokedBy ?? row.revoked_by),
  };
}

function rowToLogEntry(row: Record<string, unknown>): OperatorAccessLogEntry {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId ?? row.tenant_id),
    grantId: String(row.grantId ?? row.grant_id),
    operatorId: String(row.operatorId ?? row.operator_id),
    seq: Number(row.seq ?? 0),
    route: String(row.route ?? ''),
    scope: String(row.scope ?? ''),
    rowCount: Number(row.rowCount ?? row.row_count ?? 0),
    prevHash: String(row.prevHash ?? row.prev_hash),
    thisHash: String(row.thisHash ?? row.this_hash),
    accessedAt: iso(row.accessedAt ?? row.accessed_at),
  };
}

// ── Drizzle-backed implementation ────────────────────────────────────────────

class GrantNotFoundError extends Error {}

export function createOperatorAccessStore(
  db: DatabaseClient,
): OperatorAccessStore {
  async function loadGrant(
    tx: DatabaseClient,
    grantId: string,
    tenantId: string,
  ): Promise<OperatorAccessGrant | undefined> {
    const rows = await tx
      .select()
      .from(operatorAccessGrants)
      .where(
        and(
          eq(operatorAccessGrants.id, grantId),
          eq(operatorAccessGrants.tenantId, tenantId),
        ),
      )
      .limit(1);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? rowToGrant(row) : undefined;
  }

  return {
    async requestGrant(args) {
      const now = new Date();
      const ttl = args.ttlMinutes ?? DEFAULT_GRANT_TTL_MINUTES;
      const expiresAt = new Date(now.getTime() + ttl * 60_000);
      const id = `grant_${randomUUID()}`;
      return withServiceRoleContext(db, async (tx) => {
        const [row] = await tx
          .insert(operatorAccessGrants)
          .values({
            id,
            tenantId: args.tenantId,
            operatorId: args.operatorId,
            operatorEmail: args.operatorEmail ?? null,
            justificationCode: args.justificationCode,
            reason: args.reason,
            scopes: args.scopes,
            status: 'pending',
            requestedAt: now,
            expiresAt,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return rowToGrant(row as Record<string, unknown>);
      });
    },

    async consent({ grantId, tenantId, consentedBy }) {
      const now = new Date();
      return withServiceRoleContext(db, async (tx) => {
        const existing = await loadGrant(tx, grantId, tenantId);
        if (!existing) throw new GrantNotFoundError('grant not found');
        const [row] = await tx
          .update(operatorAccessGrants)
          .set({ status: 'active', consentedAt: now, consentedBy, updatedAt: now })
          .where(
            and(
              eq(operatorAccessGrants.id, grantId),
              eq(operatorAccessGrants.tenantId, tenantId),
            ),
          )
          .returning();
        return rowToGrant(row as Record<string, unknown>);
      });
    },

    async revoke({ grantId, tenantId, revokedBy }) {
      const now = new Date();
      return withServiceRoleContext(db, async (tx) => {
        const existing = await loadGrant(tx, grantId, tenantId);
        if (!existing) throw new GrantNotFoundError('grant not found');
        const [row] = await tx
          .update(operatorAccessGrants)
          .set({ status: 'revoked', revokedAt: now, revokedBy, updatedAt: now })
          .where(
            and(
              eq(operatorAccessGrants.id, grantId),
              eq(operatorAccessGrants.tenantId, tenantId),
            ),
          )
          .returning();
        return rowToGrant(row as Record<string, unknown>);
      });
    },

    async deny({ grantId, tenantId, deniedBy }) {
      const now = new Date();
      return withServiceRoleContext(db, async (tx) => {
        const existing = await loadGrant(tx, grantId, tenantId);
        if (!existing) throw new GrantNotFoundError('grant not found');
        const [row] = await tx
          .update(operatorAccessGrants)
          .set({ status: 'denied', revokedBy: deniedBy, updatedAt: now })
          .where(
            and(
              eq(operatorAccessGrants.id, grantId),
              eq(operatorAccessGrants.tenantId, tenantId),
            ),
          )
          .returning();
        return rowToGrant(row as Record<string, unknown>);
      });
    },

    async assertActiveGrant({ operatorId, tenantId, scope }) {
      const now = new Date();
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(operatorAccessGrants)
          .where(
            and(
              eq(operatorAccessGrants.operatorId, operatorId),
              eq(operatorAccessGrants.tenantId, tenantId),
              eq(operatorAccessGrants.status, 'active'),
            ),
          )
          .orderBy(desc(operatorAccessGrants.expiresAt))
          .limit(10);
        // Pick the first non-expired active grant covering the scope.
        for (const r of rows) {
          const grant = rowToGrant(r as Record<string, unknown>);
          const check = checkActive(grant, scope, now);
          if (check.ok) return check;
        }
        // No active+scoped grant — re-derive the most specific deny reason.
        const first = rows[0]
          ? rowToGrant(rows[0] as Record<string, unknown>)
          : undefined;
        return checkActive(first, scope, now);
      });
    },

    async recordAccess(args) {
      const now = new Date();
      return withServiceRoleContext(db, async (tx) => {
        const prevRows = await tx
          .select({
            seq: operatorAccessLog.seq,
            thisHash: operatorAccessLog.thisHash,
          })
          .from(operatorAccessLog)
          .where(eq(operatorAccessLog.tenantId, args.tenantId))
          .orderBy(desc(operatorAccessLog.seq))
          .limit(1);
        const prev = prevRows[0] as
          | { seq: number; thisHash: string }
          | undefined;
        const seq = (prev?.seq ?? 0) + 1;
        const prevHash = prev?.thisHash ?? GENESIS_HASH;
        const base: Omit<ChainableEntry, 'thisHash'> = {
          tenantId: args.tenantId,
          grantId: args.grantId,
          operatorId: args.operatorId,
          seq,
          route: args.route,
          scope: args.scope,
          rowCount: args.rowCount,
          accessedAt: now.toISOString(),
          prevHash,
        };
        const thisHash = computeHash(base);
        const id = `oal_${randomUUID()}`;
        const [row] = await tx
          .insert(operatorAccessLog)
          .values({
            id,
            tenantId: args.tenantId,
            grantId: args.grantId,
            operatorId: args.operatorId,
            seq,
            route: args.route,
            scope: args.scope,
            rowCount: args.rowCount,
            metadata: args.metadata ?? {},
            prevHash,
            thisHash,
            accessedAt: now,
          })
          .returning();
        return rowToLogEntry(row as Record<string, unknown>);
      });
    },

    async listGrantsForTenant(tenantId) {
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(operatorAccessGrants)
          .where(eq(operatorAccessGrants.tenantId, tenantId))
          .orderBy(desc(operatorAccessGrants.requestedAt))
          .limit(200);
        return rows.map((r) => rowToGrant(r as Record<string, unknown>));
      });
    },

    async listAccessLogForTenant(tenantId) {
      return withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(operatorAccessLog)
          .where(eq(operatorAccessLog.tenantId, tenantId))
          .orderBy(asc(operatorAccessLog.seq))
          .limit(1000);
        return rows.map((r) => rowToLogEntry(r as Record<string, unknown>));
      });
    },

    async verifyTenantChain(tenantId) {
      const entries = await this.listAccessLogForTenant(tenantId);
      return verifyChain(
        entries.map((e) => ({
          tenantId: e.tenantId,
          grantId: e.grantId,
          operatorId: e.operatorId,
          seq: e.seq,
          route: e.route,
          scope: e.scope,
          rowCount: e.rowCount,
          accessedAt: e.accessedAt,
          prevHash: e.prevHash,
          thisHash: e.thisHash,
        })),
      );
    },
  };
}

// ── In-memory implementation (tests + dev) ───────────────────────────────────

/**
 * Pure in-memory store with identical semantics to the Drizzle one. Used by
 * unit tests (and as a dev fallback when no DB is wired). It enforces the SAME
 * deny-by-default + time-box + hash-chain rules so the behavioural tests prove
 * the contract, not the persistence layer.
 */
export function createInMemoryOperatorAccessStore(
  clock: () => Date = () => new Date(),
): OperatorAccessStore {
  const grants = new Map<string, OperatorAccessGrant>();
  const logByTenant = new Map<string, OperatorAccessLogEntry[]>();

  function put(grant: OperatorAccessGrant): OperatorAccessGrant {
    grants.set(grant.id, grant);
    return grant;
  }

  function getOwned(grantId: string, tenantId: string): OperatorAccessGrant {
    const g = grants.get(grantId);
    if (!g || g.tenantId !== tenantId) {
      throw new GrantNotFoundError('grant not found');
    }
    return g;
  }

  return {
    async requestGrant(args) {
      const now = clock();
      const ttl = args.ttlMinutes ?? DEFAULT_GRANT_TTL_MINUTES;
      return put({
        id: `grant_${randomUUID()}`,
        tenantId: args.tenantId,
        operatorId: args.operatorId,
        operatorEmail: args.operatorEmail ?? null,
        justificationCode: args.justificationCode,
        reason: args.reason,
        scopes: [...args.scopes],
        status: 'pending',
        requestedAt: now.toISOString(),
        consentedAt: null,
        consentedBy: null,
        expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString(),
        revokedAt: null,
        revokedBy: null,
      });
    },

    async consent({ grantId, tenantId, consentedBy }) {
      const g = getOwned(grantId, tenantId);
      return put({
        ...g,
        status: 'active',
        consentedAt: clock().toISOString(),
        consentedBy,
      });
    },

    async revoke({ grantId, tenantId, revokedBy }) {
      const g = getOwned(grantId, tenantId);
      return put({
        ...g,
        status: 'revoked',
        revokedAt: clock().toISOString(),
        revokedBy,
      });
    },

    async deny({ grantId, tenantId, deniedBy }) {
      const g = getOwned(grantId, tenantId);
      return put({ ...g, status: 'denied', revokedBy: deniedBy });
    },

    async assertActiveGrant({ operatorId, tenantId, scope }) {
      const now = clock();
      const candidates = [...grants.values()].filter(
        (g) => g.operatorId === operatorId && g.tenantId === tenantId,
      );
      for (const g of candidates) {
        const check = checkActive(g, scope, now);
        if (check.ok) return check;
      }
      return checkActive(candidates[0], scope, now);
    },

    async recordAccess(args) {
      const now = clock();
      const log = logByTenant.get(args.tenantId) ?? [];
      const prev = log[log.length - 1];
      const seq = (prev?.seq ?? 0) + 1;
      const prevHash = prev?.thisHash ?? GENESIS_HASH;
      const base: Omit<ChainableEntry, 'thisHash'> = {
        tenantId: args.tenantId,
        grantId: args.grantId,
        operatorId: args.operatorId,
        seq,
        route: args.route,
        scope: args.scope,
        rowCount: args.rowCount,
        accessedAt: now.toISOString(),
        prevHash,
      };
      const entry: OperatorAccessLogEntry = {
        id: `oal_${randomUUID()}`,
        ...base,
        thisHash: computeHash(base),
      };
      log.push(entry);
      logByTenant.set(args.tenantId, log);
      return entry;
    },

    async listGrantsForTenant(tenantId) {
      return [...grants.values()].filter((g) => g.tenantId === tenantId);
    },

    async listAccessLogForTenant(tenantId) {
      return [...(logByTenant.get(tenantId) ?? [])];
    },

    async verifyTenantChain(tenantId) {
      const entries = logByTenant.get(tenantId) ?? [];
      return verifyChain(entries as readonly ChainableEntry[]);
    },
  };
}

export { GrantNotFoundError };
