/**
 * Calendar connection store — reads/writes against `owner_calendar_connections`,
 * with all token columns ENCRYPTED via the CalendarTokenCipher before they ever
 * touch the row.
 *
 * Uses raw parameterized `db.execute(sql\`...\`)` (the same seam the workers and
 * signup-wiring use) rather than the Drizzle fluent builder. This keeps the DB
 * dependency to a single `execute(q)` method — trivially stubbable in tests —
 * and avoids the deep builder generics. Every value is bound as a `sql`
 * parameter (never string-interpolated), so there is no injection surface.
 *
 * Every method is tenant + user scoped. RLS (FORCE on app.current_tenant_id) is
 * the backstop; the queries additionally predicate on tenant_id + user_id
 * (belt-and-braces, matching the repo handlers).
 */

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { withTenantContext } from '@borjie/database';
import type { CalendarProvider } from '@borjie/database/schemas';

import type { CalendarTokenCipher } from './token-cipher';

export interface DrizzleLike {
  execute(query: unknown): Promise<unknown>;
}

export interface UpsertConnectionInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly provider: CalendarProvider;
  readonly refreshToken: string;
  readonly accessToken: string | null;
  readonly tokenExpiresAt: Date | null;
  readonly calendarId: string;
  readonly scope: string | null;
}

/** Public, token-free view of a connection for the status endpoint. */
export interface ConnectionStatusView {
  readonly id: string;
  readonly provider: CalendarProvider;
  readonly calendarId: string;
  readonly scope: string | null;
  readonly connectedAt: string;
  readonly tokenExpiresAt: string | null;
}

/** Full active connection row (token blobs SEALED, never plaintext). */
export interface ActiveConnectionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly provider: CalendarProvider;
  readonly encryptedRefreshToken: string;
  readonly encryptedAccessToken: string | null;
  readonly tokenExpiresAt: Date | null;
  readonly calendarId: string;
  readonly scope: string | null;
}

export interface CalendarConnectionStore {
  /**
   * Insert a fresh connection (callback). Tokens are sealed here. Pass `exec`
   * (a transaction handle) to pin the soft-revoke + INSERT to ONE connection
   * alongside a transaction-local RLS GUC; defaults to the store's own db.
   */
  upsert(
    input: UpsertConnectionInput,
    exec?: DrizzleLike,
  ): Promise<{ readonly id: string }>;
  /** Soft-revoke the active connection(s) for (tenant,user[,provider]). */
  disconnect(
    tenantId: string,
    userId: string,
    provider?: CalendarProvider,
  ): Promise<number>;
  /** Token-free status views for the caller's active connections. */
  listStatus(
    tenantId: string,
    userId: string,
  ): Promise<ReadonlyArray<ConnectionStatusView>>;
  /** Full active connection row for one (tenant,user,provider), or null. */
  getActive(
    tenantId: string,
    userId: string,
    provider: CalendarProvider,
  ): Promise<ActiveConnectionRow | null>;
  /** Re-seal a refreshed access (and optional new refresh) token. */
  updateTokens(
    id: string,
    tenantId: string,
    args: {
      readonly accessToken: string;
      readonly refreshToken?: string;
      readonly tokenExpiresAt: Date;
    },
  ): Promise<void>;
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

function rowToActive(r: Record<string, unknown>): ActiveConnectionRow | null {
  const id = str(r.id);
  const tenantId = str(r.tenant_id);
  const userId = str(r.user_id);
  const providerRaw = str(r.provider);
  const encryptedRefreshToken = str(r.encrypted_refresh_token);
  if (!id || !tenantId || !userId || !encryptedRefreshToken) return null;
  if (providerRaw !== 'google' && providerRaw !== 'microsoft') return null;
  return {
    id,
    tenantId,
    userId,
    provider: providerRaw,
    encryptedRefreshToken,
    encryptedAccessToken: str(r.encrypted_access_token),
    tokenExpiresAt: toDate(r.token_expires_at),
    calendarId: str(r.calendar_id) ?? 'primary',
    scope: str(r.scope),
  };
}

export function createCalendarConnectionStore(
  db: DrizzleLike,
  cipher: CalendarTokenCipher,
): CalendarConnectionStore {
  // Each method binds tenant context PER OPERATION in a short transaction
  // (`withTenantContext` issues SET LOCAL on ONE pinned connection), so the
  // query runs on a connection that carries the tenant GUC — never a
  // session-scoped bind that a concurrent worker tick (e.g. calendar-sync)
  // could clobber on the shared pool. The worker's external work (OAuth
  // refresh, Calendar API upsert) happens BETWEEN these store calls, so no
  // connection is ever held across a network round-trip.
  const tenantTx = db as unknown as Parameters<typeof withTenantContext>[0];
  return {
    async upsert(input, exec = db) {
      const id = `cal_${randomUUID()}`;
      // SEAL before write — NEVER a plaintext token in the column.
      const sealedRefresh = cipher.seal(input.refreshToken);
      const sealedAccess = input.accessToken
        ? cipher.seal(input.accessToken)
        : null;
      // One active connection per (tenant,user,provider): soft-revoke any
      // existing active row first so the partial-unique never collides.
      const run = async (e: DrizzleLike): Promise<{ readonly id: string }> => {
        await e.execute(sql`
          UPDATE owner_calendar_connections
             SET revoked_at = NOW(), updated_at = NOW()
           WHERE tenant_id = ${input.tenantId}
             AND user_id = ${input.userId}
             AND provider = ${input.provider}
             AND revoked_at IS NULL
        `);
        await e.execute(sql`
          INSERT INTO owner_calendar_connections (
            id, tenant_id, user_id, provider,
            encrypted_refresh_token, encrypted_access_token,
            token_expires_at, calendar_id, scope
          ) VALUES (
            ${id}, ${input.tenantId}, ${input.userId}, ${input.provider},
            ${sealedRefresh}, ${sealedAccess},
            ${input.tokenExpiresAt}, ${input.calendarId}, ${input.scope}
          )
        `);
        return { id };
      };
      // When the caller passes an explicit transaction handle (the OAuth
      // callback already opened one + bound the GUC), run on it directly.
      // Otherwise open our own short tenant transaction.
      if (exec !== db) return run(exec);
      return withTenantContext(tenantTx, input.tenantId, (txDb) =>
        run(txDb as unknown as DrizzleLike),
      );
    },

    async disconnect(tenantId, userId, provider) {
      return withTenantContext(tenantTx, tenantId, async (txDb) => {
        const res = await (txDb as unknown as DrizzleLike).execute(sql`
          UPDATE owner_calendar_connections
             SET revoked_at = NOW(), updated_at = NOW()
           WHERE tenant_id = ${tenantId}
             AND user_id = ${userId}
             AND revoked_at IS NULL
             ${provider ? sql`AND provider = ${provider}` : sql``}
           RETURNING id
        `);
        return asRows(res).length;
      });
    },

    async listStatus(tenantId, userId) {
      return withTenantContext(tenantTx, tenantId, async (txDb) => {
        const res = await (txDb as unknown as DrizzleLike).execute(sql`
          SELECT id, provider, calendar_id, scope, connected_at, token_expires_at
            FROM owner_calendar_connections
           WHERE tenant_id = ${tenantId}
             AND user_id = ${userId}
             AND revoked_at IS NULL
           ORDER BY connected_at DESC
        `);
        const out: ConnectionStatusView[] = [];
        for (const r of asRows(res)) {
          const id = str(r.id);
          const providerRaw = str(r.provider);
          if (!id || (providerRaw !== 'google' && providerRaw !== 'microsoft')) {
            continue;
          }
          const connectedAt = toDate(r.connected_at);
          const expiresAt = toDate(r.token_expires_at);
          out.push({
            id,
            provider: providerRaw,
            calendarId: str(r.calendar_id) ?? 'primary',
            scope: str(r.scope),
            connectedAt: (connectedAt ?? new Date(0)).toISOString(),
            tokenExpiresAt: expiresAt ? expiresAt.toISOString() : null,
          });
        }
        return out;
      });
    },

    async getActive(tenantId, userId, provider) {
      return withTenantContext(tenantTx, tenantId, async (txDb) => {
        const res = await (txDb as unknown as DrizzleLike).execute(sql`
          SELECT id, tenant_id, user_id, provider,
                 encrypted_refresh_token, encrypted_access_token,
                 token_expires_at, calendar_id, scope
            FROM owner_calendar_connections
           WHERE tenant_id = ${tenantId}
             AND user_id = ${userId}
             AND provider = ${provider}
             AND revoked_at IS NULL
           LIMIT 1
        `);
        const rows = asRows(res);
        if (rows.length === 0) return null;
        return rowToActive(rows[0] as Record<string, unknown>);
      });
    },

    async updateTokens(id, tenantId, args) {
      const sealedAccess = cipher.seal(args.accessToken);
      const sealedRefresh = args.refreshToken
        ? cipher.seal(args.refreshToken)
        : null;
      await withTenantContext(tenantTx, tenantId, async (txDb) => {
        await (txDb as unknown as DrizzleLike).execute(sql`
          UPDATE owner_calendar_connections
             SET encrypted_access_token = ${sealedAccess},
                 token_expires_at = ${args.tokenExpiresAt},
                 updated_at = NOW()
                 ${sealedRefresh ? sql`, encrypted_refresh_token = ${sealedRefresh}` : sql``}
           WHERE id = ${id}
             AND tenant_id = ${tenantId}
        `);
      });
    },
  };
}
