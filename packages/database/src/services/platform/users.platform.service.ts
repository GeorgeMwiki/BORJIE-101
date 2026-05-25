/**
 * Users Drizzle adapter — backs the HQ-tier `platform.list_users` +
 * `platform.create_user` tools (Central Command Phase B — B1).
 *
 * Implements `UsersServicePort` (paginated list) AND `CreateUserPort`
 * (create + deactivate with rollback) on the existing `users` schema.
 *
 * Role mapping is intentionally heuristic — the HQ surface accepts a
 * normalised set (tenant_resident | owner | manager | org_admin |
 * platform_admin | support) and the existing `users.isOwner` flag plus
 * the `user_roles` join table carry the platform's full RBAC model. For
 * the Phase B Tier 1 cut we encode the role in `users.preferences.role`
 * so the HQ tool can roundtrip without depending on the (still-evolving)
 * roles+permissions join chain.
 *
 * Hard DB failures degrade gracefully:
 *   - listUsers       : returns `{ rows: [], nextCursor: null, totalReturned: 0 }`
 *   - tenantExists    : returns `false`
 *   - emailExistsOnTenant : returns `false`
 *   - createUser      : RE-THROWS
 *   - deactivateUser  : RE-THROWS
 */
import { randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  tenants,
  users,
} from '../../schemas/tenant.schema.js';
import { logger } from '../../logger.js';
import type { DatabaseClient } from '../../client.js';

export type HqUserRole =
  | 'tenant_resident'
  | 'owner'
  | 'manager'
  | 'org_admin'
  | 'platform_admin'
  | 'support';

export type HqUserStatus = 'active' | 'invited' | 'suspended' | 'deactivated';

export interface ListUsersRow {
  readonly userId: string;
  readonly tenantId: string | null;
  readonly email: string;
  readonly role: HqUserRole;
  readonly status: HqUserStatus;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface ListUsersResult {
  readonly rows: ReadonlyArray<ListUsersRow>;
  readonly nextCursor: string | null;
  readonly totalReturned: number;
}

export interface ListUsersArgs {
  readonly tenantId: string | null;
  readonly role: HqUserRole | null;
  readonly limit: number;
  readonly cursor: string | null;
}

export interface CreateUserArgs {
  readonly tenantId: string;
  readonly email: string;
  readonly role: HqUserRole;
  readonly sendInvite: boolean;
  readonly displayName: string | null;
}

export interface CreateUserResult {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: HqUserRole;
  readonly status: 'active' | 'invited';
  readonly invitedAt: string | null;
  readonly createdAt: string;
}

export interface PlatformUsersService {
  listUsers(args: ListUsersArgs): Promise<ListUsersResult>;
  tenantExists(tenantId: string): Promise<boolean>;
  emailExistsOnTenant(args: {
    readonly tenantId: string;
    readonly email: string;
  }): Promise<boolean>;
  createUser(args: CreateUserArgs): Promise<CreateUserResult>;
  deactivateUser(userId: string): Promise<void>;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

const DB_TO_HQ_STATUS: Readonly<Record<string, HqUserStatus>> = {
  active: 'active',
  pending_activation: 'invited',
  suspended: 'suspended',
  deactivated: 'deactivated',
};

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

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

interface RawUserRow {
  id: string;
  tenantId: string | null;
  email: string;
  status: string | null;
  isOwner: boolean | null;
  lastLoginAt: Date | string | null;
  createdAt: Date | string;
  preferences: unknown;
}

function readHqRole(raw: RawUserRow): HqUserRole {
  // Prefer the explicit role stored in preferences.role (we write it on
  // createUser). Fall back to isOwner → owner; otherwise default to
  // tenant_resident.
  const prefs = raw.preferences as Record<string, unknown> | null | undefined;
  const stored = prefs && typeof prefs.role === 'string' ? (prefs.role as string) : null;
  if (
    stored === 'tenant_resident' ||
    stored === 'owner' ||
    stored === 'manager' ||
    stored === 'org_admin' ||
    stored === 'platform_admin' ||
    stored === 'support'
  ) {
    return stored;
  }
  if (raw.isOwner) return 'owner';
  return 'tenant_resident';
}

function toListRow(raw: RawUserRow): ListUsersRow {
  return {
    userId: raw.id,
    tenantId: raw.tenantId ?? null,
    email: raw.email,
    role: readHqRole(raw),
    status: DB_TO_HQ_STATUS[String(raw.status ?? 'pending_activation')] ?? 'invited',
    lastLoginAt: raw.lastLoginAt ? toIso(raw.lastLoginAt) : null,
    createdAt: toIso(raw.createdAt),
  };
}

export function createPlatformUsersService(
  db: DatabaseClient,
): PlatformUsersService {
  return {
    async listUsers(args) {
      try {
        const limit = clampLimit(args.limit);
        const cursor = decodeCursor(args.cursor);

        let whereExpr = isNull(users.deletedAt);
        if (args.tenantId) {
          whereExpr = and(whereExpr, eq(users.tenantId, args.tenantId)) as never;
        }
        if (args.role) {
          // Role is stored in preferences.role JSONB key.
          whereExpr = and(
            whereExpr,
            sql`${users.preferences}->>'role' = ${args.role}`,
          ) as never;
        }
        if (cursor) {
          whereExpr = and(
            whereExpr,
            sql`(${users.createdAt}, ${users.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id})`,
          ) as never;
        }

        const rowsRaw = (await db
          .select({
            id: users.id,
            tenantId: users.tenantId,
            email: users.email,
            status: users.status,
            isOwner: users.isOwner,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
            preferences: users.preferences,
          })
          .from(users)
          .where(whereExpr)
          .orderBy(desc(users.createdAt), desc(users.id))
          .limit(limit + 1)) as ReadonlyArray<RawUserRow>;

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
        return { rows, nextCursor, totalReturned: rows.length };
      } catch (error) {
        logger.error('platform.users.listUsers failed', { error: error });
        return { rows: [], nextCursor: null, totalReturned: 0 };
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
        logger.error('platform.users.tenantExists failed', { error: error });
        return false;
      }
    },

    async emailExistsOnTenant(args) {
      try {
        if (!args.tenantId || !args.email) return false;
        const rows = (await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.tenantId, args.tenantId),
              eq(users.email, args.email),
            ),
          )
          .limit(1)) as ReadonlyArray<{ id: string }>;
        return rows.length > 0;
      } catch (error) {
        logger.error('platform.users.emailExistsOnTenant failed', { error: error });
        return false;
      }
    },

    async createUser(args) {
      const id = randomUUID();
      const now = new Date();
      // Heuristic display name split — sendInvite flow leaves the row in
      // `pending_activation` until the user clicks the invite link.
      const local = (args.displayName ?? args.email.split('@')[0] ?? 'User')
        .toString()
        .trim();
      const [firstName, ...rest] = local.split(/\s+/);
      const lastName = rest.length > 0 ? rest.join(' ') : '-';
      const status = args.sendInvite ? 'pending_activation' : 'active';
      const isOwner = args.role === 'owner';
      try {
        await db.insert(users).values({
          id,
          tenantId: args.tenantId,
          email: args.email,
          firstName: firstName && firstName.length > 0 ? firstName : 'User',
          lastName,
          displayName: args.displayName ?? null,
          status,
          isOwner,
          preferences: { role: args.role } as never,
          createdAt: now,
          updatedAt: now,
          activatedAt: args.sendInvite ? null : now,
          invitationExpiresAt: args.sendInvite
            ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
            : null,
        } as never);
      } catch (error) {
        logger.error('platform.users.createUser failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.users.createUser failed');
      }
      return {
        userId: id,
        tenantId: args.tenantId,
        email: args.email,
        role: args.role,
        status: args.sendInvite ? 'invited' : 'active',
        invitedAt: args.sendInvite ? now.toISOString() : null,
        createdAt: now.toISOString(),
      };
    },

    async deactivateUser(userId) {
      try {
        if (!userId) {
          throw new Error('platform.users.deactivateUser: userId is required');
        }
        await db
          .update(users)
          .set({
            status: 'deactivated',
            invitationToken: null,
            updatedAt: new Date(),
          } as never)
          .where(eq(users.id, userId));
      } catch (error) {
        logger.error('platform.users.deactivateUser failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.users.deactivateUser failed');
      }
    },
  };
}
