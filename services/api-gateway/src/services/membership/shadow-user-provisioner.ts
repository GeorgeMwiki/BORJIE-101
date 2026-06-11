/**
 * Shadow-user provisioner (surface-completion SC-2) — find-or-create the
 * caller's `users` row in a TARGET tenant when an employment-class
 * membership goes ACTIVE (invite redeem, request approval, direct connect).
 *
 * WHY: users.id is a GLOBAL primary key, so one human working for two
 * tenants is TWO users rows. The first (home) row conventionally carries the
 * Supabase sub as its id; every additional tenant gets a synthetic
 * `usr_<uuid>` row, and the org_membership.user_id column carries the
 * mapping the auth override uses to swap userId on tenant switch.
 *
 * BUYERS NEVER PASS THROUGH HERE — a buyer_connection carries no shadow
 * user by the corrected buyer model (0345 CHECK); the membership repository
 * enforces it independently.
 *
 * RESOLUTION ORDER:
 *   1. users row with id = the caller's sub in the target tenant (the
 *      home-tenant convention) → reuse;
 *   2. users row with the same email in the target tenant → reuse;
 *   3. INSERT a fresh `usr_<uuid>` row (active, role-mapped, named from the
 *      identity profile).
 *
 * RLS: the joiner's request is GUC-bound to their CURRENT tenant while the
 * row lands in the TARGET tenant, so every statement runs under
 * `withServiceRoleContext` with explicit tenant predicates (the same
 * pattern as the membership repository).
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';

type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

export interface ProvisionShadowUserInput {
  readonly db: ServiceRoleDb;
  readonly targetTenantId: string;
  readonly supabaseUserId: string;
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly preferredLang?: string | null;
  /** The membership's role label — mapped onto borjie_user_role when valid. */
  readonly memberRole?: string | null;
}

/** borjie_user_role enum values a member_role label may map onto directly. */
const MINING_ROLES = new Set([
  'owner',
  'admin',
  'site_manager',
  'supervisor',
  'driver',
  'geologist',
  'stores',
  'qc_officer',
]);

export function mapMemberRoleToMiningRole(
  memberRole: string | null | undefined,
): string {
  const role = (memberRole ?? '').trim().toLowerCase();
  if (MINING_ROLES.has(role)) return role;
  if (role === 'manager') return 'site_manager';
  // Generic workforce default — classification only; RBAC still resolves
  // through permissions, and the label can be corrected org-side later.
  return 'supervisor';
}

function splitName(displayName: string | null | undefined): {
  first: string;
  last: string;
} {
  const name = (displayName ?? '').trim();
  if (!name) return { first: 'Member', last: '-' };
  const idx = name.indexOf(' ');
  if (idx === -1) return { first: name, last: '-' };
  return { first: name.slice(0, idx), last: name.slice(idx + 1).trim() || '-' };
}

/**
 * Returns the users.id of the shadow row in the target tenant (existing or
 * freshly created).
 */
export async function provisionShadowUser(
  input: ProvisionShadowUserInput,
): Promise<string> {
  if (!input.targetTenantId || !input.supabaseUserId) {
    throw new Error(
      'shadow-user: targetTenantId and supabaseUserId are required',
    );
  }
  const email =
    input.email?.trim().toLowerCase() ||
    `shadow+${input.supabaseUserId}@identity.borjie.app`;
  const { first, last } = splitName(input.displayName);
  const miningRole = mapMemberRoleToMiningRole(input.memberRole);
  const lang = input.preferredLang === 'sw' ? 'sw' : 'en';

  return withServiceRoleContext(input.db, async (tx) => {
    const exec = tx as unknown as DbExec;
    // 1 — home-tenant convention (id = sub) / 2 — same email in the tenant.
    const existing = (await exec.execute(sql`
      SELECT id FROM users
       WHERE tenant_id = ${input.targetTenantId}
         AND (id = ${input.supabaseUserId} OR lower(email) = ${email})
         AND deleted_at IS NULL
       ORDER BY CASE WHEN id = ${input.supabaseUserId} THEN 0 ELSE 1 END
       LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const found = existing[0];
    if (found) return String(found.id);

    // 3 — fresh shadow row. ON CONFLICT (tenant_id, email) absorbs a
    // concurrent provision of the same human; re-read on miss.
    const shadowId = `usr_${randomUUID()}`;
    const inserted = (await exec.execute(sql`
      INSERT INTO users
        (id, tenant_id, email, phone, first_name, last_name, display_name,
         status, mining_role, workforce_status, preferred_lang,
         created_at, updated_at, activated_at)
      VALUES
        (${shadowId}, ${input.targetTenantId}, ${email},
         ${input.phone ?? null}, ${first}, ${last},
         ${input.displayName ?? null},
         'active', ${miningRole}::borjie_user_role, 'active', ${lang},
         now(), now(), now())
      ON CONFLICT (tenant_id, email) DO NOTHING
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const insertedRow = inserted[0];
    if (insertedRow) return String(insertedRow.id);

    const reread = (await exec.execute(sql`
      SELECT id FROM users
       WHERE tenant_id = ${input.targetTenantId} AND lower(email) = ${email}
       LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    const rereadRow = reread[0];
    if (!rereadRow) {
      throw new Error('shadow-user: provisioning failed (no users row)');
    }
    return String(rereadRow.id);
  });
}
