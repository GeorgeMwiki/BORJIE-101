/**
 * Postgres-backed InviteCode Repository
 *
 * Redeem is the critical atomic path. Flow inside a single transaction:
 *
 *   1. Lock the invite_codes row (SELECT ... FOR UPDATE).
 *   2. Validate: not revoked, not expired, under max_redemptions.
 *   3. Create membership (+ shadow user) via the injected membership repo.
 *   4. Increment redemptions_used.
 *
 * Concurrency: two parallel redeems of the same limited code cannot both
 * succeed — the FOR UPDATE lock serializes them, and the check-then-
 * increment re-reads redemptions_used inside the critical section.
 */

import { randomBytes } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { inviteCodes, organizations } from '@borjie/database';
import type {
  InviteAttachmentHints,
  InviteCode,
  InviteCodeRecord,
  ISOTimestamp,
  OrgMembership,
  OrganizationId,
  RoleId,
  TenantId,
  TenantIdentityId,
  UserId,
} from '@borjie/domain-models';
import {
  DefaultUserShadowWriter,
  PostgresOrgMembershipRepository,
  type CreateMembershipInput,
  type OrgMembershipRepositoryClient,
  type ShadowUserInput,
  type UserShadowWriter,
} from './postgres-org-membership-repository.js';

export interface InviteCodeRepositoryClient {
  // The drizzle query-builder chain methods return deeply-generic types
  // we do not consume structurally here; `unknown` keeps the surface
  // explicit without escaping the type system via `any`.
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  execute?: (sql: unknown) => Promise<unknown>;
  transaction: <T>(fn: (tx: InviteCodeRepositoryClient) => Promise<T>) => Promise<T>;
}

/** Options accepted by `generate`. */
export interface GenerateOptions {
  readonly expiresAt?: ISOTimestamp;
  readonly maxRedemptions?: number;
  readonly defaultRoleId: RoleId;
  readonly attachmentHints?: InviteAttachmentHints;
}

/** Minimal shape describing the redeemer for shadow-user creation. */
export interface RedeemerProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phone: string | null;
}

/** Successful redeem outcome. */
export interface RedeemResult {
  readonly membership: OrgMembership;
  readonly code: InviteCodeRecord;
}

function rowToRecord(row: {
  code: string;
  organizationId: string;
  platformTenantId: string;
  issuedBy: string;
  issuedAt: Date | string;
  expiresAt: Date | string | null;
  maxRedemptions: number | null;
  redemptionsUsed: number;
  defaultRoleId: string;
  attachmentHints: unknown;
}): InviteCodeRecord {
  const issuedAt =
    row.issuedAt instanceof Date
      ? (row.issuedAt.toISOString() as ISOTimestamp)
      : (row.issuedAt as ISOTimestamp);
  const expiresAt =
    row.expiresAt == null
      ? null
      : row.expiresAt instanceof Date
        ? (row.expiresAt.toISOString() as ISOTimestamp)
        : (row.expiresAt as ISOTimestamp);
  return {
    code: row.code as unknown as InviteCode,
    organizationId: row.organizationId as unknown as OrganizationId,
    platformTenantId: row.platformTenantId as unknown as TenantId,
    issuedBy: row.issuedBy as unknown as UserId,
    issuedAt,
    expiresAt,
    maxRedemptions: row.maxRedemptions,
    redemptionsUsed: row.redemptionsUsed,
    defaultRoleId: row.defaultRoleId as unknown as RoleId,
    attachmentHints: (row.attachmentHints ?? undefined) as
      | InviteAttachmentHints
      | undefined,
  };
}

/** Hex alphabet for the random suffix — unambiguous and URL-safe. */
// eslint-disable-next-line no-secrets/no-secrets -- public Crockford-style alphabet, not a secret
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Produce a 4-char random suffix (~20 bits of entropy). */
function randomSuffix(): string {
  const bytes = randomBytes(4);
  let out = '';
  for (const byte of bytes) {
    out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Build an invite code in the format `<ORG_CODE>-<RANDOM_4>`.
 * Falls back to `INV` when the organization has no short code.
 */
function buildCode(orgCode: string | null): string {
  const prefix = (orgCode ?? 'INV').toUpperCase().slice(0, 8);
  return `${prefix}-${randomSuffix()}`;
}

export class PostgresInviteCodeRepository {
  constructor(
    private readonly db: InviteCodeRepositoryClient,
    private readonly membershipRepo: PostgresOrgMembershipRepository
  ) {}

  async findByCode(code: InviteCode): Promise<InviteCodeRecord | null> {
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code as unknown as string))
      .limit(1);
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async listForOrg(
    orgId: OrganizationId
  ): Promise<readonly InviteCodeRecord[]> {
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.organizationId, orgId as unknown as string))
      .orderBy(asc(inviteCodes.issuedAt));
    return rows.map(rowToRecord);
  }

  async generate(
    orgId: OrganizationId,
    issuedBy: UserId,
    opts: GenerateOptions
  ): Promise<InviteCodeRecord> {
    const orgRows = await this.db
      .select({
        id: organizations.id,
        code: organizations.code,
        tenantId: organizations.tenantId,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId as unknown as string))
      .limit(1);
    const org = orgRows[0];
    if (!org) {
      throw new Error(
        `PostgresInviteCodeRepository.generate: organization ${orgId} not found`
      );
    }

    // Retry on collision — extremely unlikely given 20 bits of entropy per
    // suffix, but loop defensively anyway.
    let attempt = 0;
    while (attempt < 5) {
      const candidate = buildCode(org.code);
      try {
        const inserted = await this.db
          .insert(inviteCodes)
          .values({
            code: candidate,
            organizationId: org.id,
            platformTenantId: org.tenantId,
            issuedBy: issuedBy as unknown as string,
            expiresAt: opts.expiresAt ? new Date(opts.expiresAt) : null,
            maxRedemptions: opts.maxRedemptions ?? null,
            defaultRoleId: opts.defaultRoleId as unknown as string,
            attachmentHints: opts.attachmentHints ?? null,
          })
          .returning();
        const row = inserted[0];
        if (!row) {
          throw new Error(
            'PostgresInviteCodeRepository.generate: insert returned no row'
          );
        }
        return rowToRecord(row);
      } catch (error) {
        const message = (error as Error).message ?? '';
        if (!/unique|duplicate/i.test(message)) {
          throw error;
        }
        attempt += 1;
      }
    }
    throw new Error(
      'PostgresInviteCodeRepository.generate: exhausted retries on code collision'
    );
  }

  /**
   * Redeem a code atomically. Uses a transaction with SELECT ... FOR UPDATE
   * to serialize concurrent redeems of the same code.
   */
  async redeem(
    code: InviteCode,
    identityId: TenantIdentityId,
    redeemer: RedeemerProfile
  ): Promise<RedeemResult> {
    return this.db.transaction(async (tx) => {
      // Lock the invite row for the duration of the transaction.
      // Raw SQL escape hatch: the locked row shape mirrors the
      // `invite_codes` table columns in snake_case (different from the
      // Drizzle camelCase $inferSelect surface). Typed as unknown then
      // narrowed via property accessors below.
      const lockedRows = await tx.execute(
        sql`SELECT * FROM invite_codes WHERE code = ${code as unknown as string} FOR UPDATE`
      );
      type RawInviteRow = {
        code: string;
        organization_id: string;
        platform_tenant_id: string;
        issued_by: string;
        issued_at: Date | string;
        expires_at: Date | string | null;
        max_redemptions: number | null;
        redemptions_used: number;
        default_role_id: string;
        attachment_hints: unknown;
        revoked_at: Date | string | null;
        revoked_by: string | null;
      };
      const rawRows: RawInviteRow[] = Array.isArray(lockedRows)
        ? (lockedRows as RawInviteRow[])
        : ((lockedRows as { rows?: RawInviteRow[] } | undefined)?.rows ?? []);
      const raw = rawRows[0];
      if (!raw) {
        throw new Error(
          `PostgresInviteCodeRepository.redeem: code ${code} not found`
        );
      }
      if (raw.revoked_at != null) {
        throw new Error('INVITE_CODE_REVOKED');
      }
      const expiresAt: Date | null =
        raw.expires_at == null
          ? null
          : raw.expires_at instanceof Date
            ? raw.expires_at
            : new Date(raw.expires_at);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new Error('INVITE_CODE_EXPIRED');
      }
      const maxRedemptions: number | null = raw.max_redemptions;
      const redemptionsUsed: number = raw.redemptions_used ?? 0;
      if (maxRedemptions != null && redemptionsUsed >= maxRedemptions) {
        throw new Error('INVITE_CODE_EXHAUSTED');
      }

      const createInput: CreateMembershipInput = {
        tenantIdentityId: identityId,
        organizationId: raw.organization_id as unknown as OrganizationId,
        roleId: raw.default_role_id as unknown as RoleId,
        viaCode: code,
        shadowProfile: {
          email: redeemer.email,
          phone: redeemer.phone,
          firstName: redeemer.firstName,
          lastName: redeemer.lastName,
        } as Omit<ShadowUserInput, 'tenantId' | 'organizationId'>,
      };
      // Execute the membership create on the SAME transaction client so the
      // shadow-user insert, membership insert, and redemptions increment
      // commit (or roll back) as a single unit.
      const shadowWriter: UserShadowWriter =
        ((this.membershipRepo as unknown as { shadowWriter?: UserShadowWriter })
          .shadowWriter) ?? new DefaultUserShadowWriter();
      // `tx` is the same Drizzle transaction client both clients accept;
      // their interfaces are structurally identical so we narrow via
      // `unknown` rather than escaping through `any`.
      const membershipOnTx = new PostgresOrgMembershipRepository(
        tx as unknown as OrgMembershipRepositoryClient,
        shadowWriter
      );
      const membership = await membershipOnTx.create(createInput);

      const updated = await tx
        .update(inviteCodes)
        .set({ redemptionsUsed: redemptionsUsed + 1 })
        .where(eq(inviteCodes.code, code as unknown as string))
        .returning();
      const updatedRow = updated[0];
      return {
        membership,
        code: rowToRecord(updatedRow),
      };
    });
  }

  async revoke(code: InviteCode): Promise<InviteCodeRecord> {
    const updated = await this.db
      .update(inviteCodes)
      .set({ revokedAt: new Date() })
      .where(eq(inviteCodes.code, code as unknown as string))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new Error(
        `PostgresInviteCodeRepository.revoke: code ${code} not found`
      );
    }
    return rowToRecord(row);
  }
}
