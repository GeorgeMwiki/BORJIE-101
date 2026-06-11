/**
 * IdentityRepository — resolve-or-provision the caller's tenant_identity from
 * an authenticated Supabase principal (the sub claim), via the
 * identity_auth_principals bridge (migration 0345).
 *
 * THE MODEL: tenant_identities = one row per real HUMAN (keyed on phone when
 * present, email otherwise); identity_auth_principals = the sub↔identity
 * bridge (one human can hold a phone-OTP sub on mobile AND an email sub on
 * web). Every membership route resolves the caller through here, so any
 * principal lands on the SAME membership graph.
 *
 * RESOLUTION ORDER (provision):
 *   1. principal already mapped → its identity (fast path).
 *   2. phone present → identity keyed on the digits-only normalization;
 *   3. else email → identity keyed on the email;
 *   4. else create a fresh identity (phone may be NULL — the 0345 CHECK
 *      requires at least one of phone/email, asserted here first).
 *   Steps 2-4 attach the principal (idempotent on supabase_user_id).
 *
 * Cross-org/global by nature → every method runs under
 * `withServiceRoleContext` (identity_auth_principals + tenant_identities are
 * service-role-only). Inputs validated; reads return frozen snapshots.
 */

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import {
  tenantIdentities,
  identityAuthPrincipals,
} from '../schemas/identity.schema.js';
import type { DatabaseClient } from '../client.js';
import { withServiceRoleContext } from '../rls/with-tenant-context.js';

export interface TenantIdentityView {
  readonly id: string;
  readonly phoneNormalized: string | null;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
}

export interface ProvisionIdentityInput {
  readonly supabaseUserId: string;
  /** E.164-ish phone from the JWT/profile; normalized to digits here. */
  readonly phoneE164?: string | null;
  readonly email?: string | null;
  readonly displayName?: string | null;
  readonly locale?: string | null;
  /** phone-otp | email | sso */
  readonly authMethod?: string;
}

export interface IdentityRepository {
  /** sub → identity through the principal bridge. Null when unmapped. */
  resolveByPrincipal(supabaseUserId: string): Promise<TenantIdentityView | null>;
  /** Find-or-create the identity + attach the principal (idempotent). */
  provision(input: ProvisionIdentityInput): Promise<TenantIdentityView>;
}

export function normalizePhoneDigits(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : null;
}

function countryFromDigits(digits: string | null): string | null {
  if (!digits) return null;
  if (digits.startsWith('255')) return 'TZ';
  if (digits.startsWith('254')) return 'KE';
  if (digits.startsWith('256')) return 'UG';
  if (digits.startsWith('234')) return 'NG';
  return 'ZZ';
}

interface IdentityRow {
  id: string;
  phoneNormalized: string | null;
  email: string | null;
  profile: unknown;
  status: TenantIdentityView['status'];
}

function rowToView(row: IdentityRow): TenantIdentityView {
  const profile = (row.profile ?? {}) as { displayName?: unknown };
  return Object.freeze({
    id: row.id,
    phoneNormalized: row.phoneNormalized ?? null,
    email: row.email ?? null,
    displayName:
      typeof profile.displayName === 'string' ? profile.displayName : null,
    status: row.status,
  });
}

function assertProvisionable(input: ProvisionIdentityInput): void {
  if (!input.supabaseUserId) {
    throw new Error('identity: provision requires a non-empty supabaseUserId');
  }
}

// ---------------------------------------------------------------------------
// Drizzle implementation
// ---------------------------------------------------------------------------

export function createDrizzleIdentityRepository(
  db: DatabaseClient,
): IdentityRepository {
  async function findByPrincipal(
    tx: DatabaseClient,
    supabaseUserId: string,
  ): Promise<TenantIdentityView | null> {
    const rows = (await tx
      .select({
        id: tenantIdentities.id,
        phoneNormalized: tenantIdentities.phoneNormalized,
        email: tenantIdentities.email,
        profile: tenantIdentities.profile,
        status: tenantIdentities.status,
      })
      .from(identityAuthPrincipals)
      .innerJoin(
        tenantIdentities,
        eq(identityAuthPrincipals.tenantIdentityId, tenantIdentities.id),
      )
      .where(eq(identityAuthPrincipals.supabaseUserId, supabaseUserId))
      .limit(1)) as unknown as IdentityRow[];
    const row = rows[0];
    return row ? rowToView(row) : null;
  }

  async function attachPrincipal(
    tx: DatabaseClient,
    tenantIdentityId: string,
    supabaseUserId: string,
    authMethod: string,
  ): Promise<void> {
    await tx
      .insert(identityAuthPrincipals)
      .values({
        id: `iap_${randomUUID()}`,
        tenantIdentityId,
        supabaseUserId,
        authMethod,
      })
      .onConflictDoNothing({
        target: [identityAuthPrincipals.supabaseUserId],
      });
  }

  return {
    async resolveByPrincipal(supabaseUserId) {
      if (!supabaseUserId) {
        throw new Error(
          'identity: resolveByPrincipal requires a non-empty supabaseUserId',
        );
      }
      return withServiceRoleContext(db, (tx) =>
        findByPrincipal(tx, supabaseUserId),
      );
    },

    async provision(input) {
      assertProvisionable(input);
      const phone = normalizePhoneDigits(input.phoneE164);
      const email = input.email?.trim().toLowerCase() || null;
      if (!phone && !email) {
        throw new Error(
          'identity: provision requires at least one of phone/email ' +
            '(tenant_identities_phone_or_email)',
        );
      }
      const authMethod =
        input.authMethod ?? (phone ? 'phone-otp' : 'email');
      return withServiceRoleContext(db, async (tx) => {
        // 1 — principal fast path.
        const mapped = await findByPrincipal(tx, input.supabaseUserId);
        if (mapped) return mapped;

        // 2/3 — match an existing identity by phone, then email.
        let existing: IdentityRow | undefined;
        if (phone) {
          const byPhone = (await tx
            .select()
            .from(tenantIdentities)
            .where(eq(tenantIdentities.phoneNormalized, phone))
            .limit(1)) as unknown as IdentityRow[];
          existing = byPhone[0];
        }
        if (!existing && email) {
          const byEmail = (await tx
            .select()
            .from(tenantIdentities)
            .where(sql`lower(${tenantIdentities.email}) = ${email}`)
            .limit(1)) as unknown as IdentityRow[];
          existing = byEmail[0];
        }
        if (existing) {
          await attachPrincipal(
            tx,
            existing.id,
            input.supabaseUserId,
            authMethod,
          );
          return rowToView(existing);
        }

        // 4 — fresh identity. ON CONFLICT on the phone key absorbs a
        // concurrent provision of the same human; re-read on miss.
        const inserted = (await tx
          .insert(tenantIdentities)
          .values({
            id: `tid_${randomUUID()}`,
            phoneNormalized: phone,
            phoneCountryCode: countryFromDigits(phone),
            email,
            profile: {
              displayName: input.displayName ?? null,
              locale: input.locale ?? null,
            },
            status: 'ACTIVE',
          })
          .onConflictDoNothing({
            target: [tenantIdentities.phoneNormalized],
          })
          .returning()) as unknown as IdentityRow[];
        let identity = inserted[0];
        if (!identity && phone) {
          const reread = (await tx
            .select()
            .from(tenantIdentities)
            .where(eq(tenantIdentities.phoneNormalized, phone))
            .limit(1)) as unknown as IdentityRow[];
          identity = reread[0];
        }
        if (!identity) {
          throw new Error('identity: provision failed (no identity row)');
        }
        await attachPrincipal(
          tx,
          identity.id,
          input.supabaseUserId,
          authMethod,
        );
        return rowToView(identity);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests; same surface)
// ---------------------------------------------------------------------------

export function createInMemoryIdentityRepository(): IdentityRepository {
  const identities = new Map<string, IdentityRow>();
  const principals = new Map<string, string>(); // sub → identity id

  function find(predicate: (r: IdentityRow) => boolean): IdentityRow | null {
    for (const r of identities.values()) {
      if (predicate(r)) return r;
    }
    return null;
  }

  return {
    async resolveByPrincipal(supabaseUserId) {
      if (!supabaseUserId) {
        throw new Error(
          'identity: resolveByPrincipal requires a non-empty supabaseUserId',
        );
      }
      const id = principals.get(supabaseUserId);
      const row = id ? identities.get(id) : undefined;
      return row ? rowToView(row) : null;
    },

    async provision(input) {
      assertProvisionable(input);
      const phone = normalizePhoneDigits(input.phoneE164);
      const email = input.email?.trim().toLowerCase() || null;
      if (!phone && !email) {
        throw new Error(
          'identity: provision requires at least one of phone/email ' +
            '(tenant_identities_phone_or_email)',
        );
      }
      const mappedId = principals.get(input.supabaseUserId);
      if (mappedId) {
        const row = identities.get(mappedId);
        if (row) return rowToView(row);
      }
      const existing =
        (phone && find((r) => r.phoneNormalized === phone)) ||
        (email && find((r) => (r.email ?? '').toLowerCase() === email)) ||
        null;
      if (existing) {
        principals.set(input.supabaseUserId, existing.id);
        return rowToView(existing);
      }
      const row: IdentityRow = {
        id: `tid_${randomUUID()}`,
        phoneNormalized: phone,
        email,
        profile: {
          displayName: input.displayName ?? null,
          locale: input.locale ?? null,
        },
        status: 'ACTIVE',
      };
      identities.set(row.id, row);
      principals.set(input.supabaseUserId, row.id);
      return rowToView(row);
    },
  };
}
