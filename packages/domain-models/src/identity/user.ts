/**
 * User Domain Model
 * 
 * Users are the identity principals in the system. Each user belongs to a tenant
 * and can have multiple roles across different organizations within that tenant.
 */

import type {
  TenantId,
  OrganizationId,
  UserId,
  RoleId,
  EntityMetadata,
  SoftDeletable,
  TenantScoped,
  ISOTimestamp,
} from '../common/types.js';
import type { AuthorityLevelId, WorkerTag } from './authority-level.js';

/** User status lifecycle */
export const UserStatus = {
  /** User invitation sent, awaiting first login */
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
  /** User is active */
  ACTIVE: 'ACTIVE',
  /** User is temporarily suspended */
  SUSPENDED: 'SUSPENDED',
  /** User is locked due to security event */
  LOCKED: 'LOCKED',
  /** User has been deactivated */
  DEACTIVATED: 'DEACTIVATED',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** MFA method types */
export const MfaMethod = {
  /** Time-based one-time password (authenticator app) */
  TOTP: 'TOTP',
  /** SMS-based verification */
  SMS: 'SMS',
  /** Email-based verification */
  EMAIL: 'EMAIL',
  /** WebAuthn/FIDO2 security key */
  WEBAUTHN: 'WEBAUTHN',
  /** Backup codes */
  BACKUP_CODES: 'BACKUP_CODES',
} as const;

export type MfaMethod = (typeof MfaMethod)[keyof typeof MfaMethod];

/** User type classification for application surface routing */
export const UserType = {
  /** Property owner/investor with access to Owner Portal */
  OWNER: 'OWNER',
  /** Estate/property manager with access to Manager App */
  MANAGER: 'MANAGER',
  /** Tenant/customer with access to Customer App */
  CUSTOMER: 'CUSTOMER',
  /** BORJIE internal admin with access to Admin Portal */
  INTERNAL_ADMIN: 'INTERNAL_ADMIN',
  /** System service account */
  SERVICE_ACCOUNT: 'SERVICE_ACCOUNT',
} as const;

export type UserType = (typeof UserType)[keyof typeof UserType];

/** Tenant MFA policy - controls who must set up MFA */
export const MfaPolicy = {
  /** MFA optional for all users */
  OPTIONAL: 'OPTIONAL',
  /** MFA required for admins and owners only */
  REQUIRED_ADMINS: 'REQUIRED_ADMINS',
  /** MFA required for all users */
  REQUIRED_ALL: 'REQUIRED_ALL',
} as const;

export type MfaPolicy = (typeof MfaPolicy)[keyof typeof MfaPolicy];

/** User profile information */
export interface UserProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly phone: string | null;
  readonly timezone: string;
  readonly locale: string;
}

/** User security settings */
export interface UserSecuritySettings {
  /** MFA enabled status */
  readonly mfaEnabled: boolean;
  /** Configured MFA methods */
  readonly mfaMethods: readonly MfaMethod[];
  /** Preferred MFA method */
  readonly preferredMfaMethod: MfaMethod | null;
  /** Last password change */
  readonly passwordChangedAt: ISOTimestamp;
  /** Password history hashes (for preventing reuse) */
  readonly passwordHistoryCount: number;
  /** Failed login attempts (resets on successful login) */
  readonly failedLoginAttempts: number;
  /** Account locked until timestamp */
  readonly lockedUntil: ISOTimestamp | null;
  /** Last failed login attempt */
  readonly lastFailedLoginAt: ISOTimestamp | null;
}

/** User role assignment (user can have multiple roles in different orgs) */
export interface UserRoleAssignment {
  readonly roleId: RoleId;
  readonly organizationId: OrganizationId;
  readonly assignedAt: ISOTimestamp;
  readonly assignedBy: UserId;
  /** Optional expiration for temporary assignments */
  readonly expiresAt: ISOTimestamp | null;
  /**
   * Orthogonal chain-of-command tier. Optional for backwards compatibility:
   * legacy rows without an explicit value are treated as
   * `DEFAULT_AUTHORITY_FOR_ROLE[roleId]` at read time and backfilled by a
   * one-time migration. See `./authority-level.ts`.
   */
  readonly authorityLevel?: AuthorityLevelId;
  /**
   * Tags that route workflows to this user (e.g. station-master, surveyor).
   * Absent or empty array means no tag-based routing applies. See
   * `./authority-level.ts` for the `WorkerTag` shape.
   */
  readonly workerTags?: readonly WorkerTag[];
}

/** Core User entity */
export interface User extends EntityMetadata, SoftDeletable, TenantScoped {
  readonly id: UserId;
  /** Primary email (used for login) */
  readonly email: string;
  /** Normalized email for uniqueness checking */
  readonly emailNormalized: string;
  /** Email verification status */
  readonly emailVerified: boolean;
  /** Email verification timestamp */
  readonly emailVerifiedAt: ISOTimestamp | null;
  /** User type */
  readonly type: UserType;
  /** Current status */
  readonly status: UserStatus;
  /** Profile information */
  readonly profile: UserProfile;
  /** Security settings */
  readonly security: UserSecuritySettings;
  /** Primary organization membership */
  readonly primaryOrganizationId: OrganizationId;
  /** Role assignments across organizations */
  readonly roleAssignments: readonly UserRoleAssignment[];
  /** Last login timestamp */
  readonly lastLoginAt: ISOTimestamp | null;
  /** Last activity timestamp */
  readonly lastActivityAt: ISOTimestamp | null;
  /** Invitation token (for pending users) */
  readonly invitationToken: string | null;
  /** Invitation expiration */
  readonly invitationExpiresAt: ISOTimestamp | null;
  /** External identity provider ID (for SSO) */
  readonly externalIdpId: string | null;
  /** External identity provider user ID (for SSO) */
  readonly externalUserId: string | null;
}

/** Input for creating a new user */
export interface CreateUserInput {
  readonly email: string;
  readonly type: UserType;
  readonly profile: Omit<UserProfile, 'displayName'> & { displayName?: string };
  readonly primaryOrganizationId: OrganizationId;
  readonly roleAssignments: readonly Omit<UserRoleAssignment, 'assignedAt' | 'assignedBy'>[];
  readonly sendInvitation?: boolean;
}

/** Input for updating a user */
export interface UpdateUserInput {
  readonly email?: string;
  readonly status?: UserStatus;
  readonly profile?: Partial<UserProfile>;
  readonly primaryOrganizationId?: OrganizationId;
}

/** Input for inviting a user */
export interface InviteUserInput {
  readonly email: string;
  readonly type: UserType;
  readonly profile: {
    readonly firstName: string;
    readonly lastName: string;
  };
  readonly primaryOrganizationId: OrganizationId;
  readonly roleAssignments: readonly {
    readonly roleId: RoleId;
    readonly organizationId: OrganizationId;
  }[];
}

/** User with resolved role details */
export interface UserWithRoles extends User {
  readonly roles: readonly {
    readonly id: RoleId;
    readonly name: string;
    readonly organizationId: OrganizationId;
    readonly organizationName: string;
  }[];
}

/** Normalize email for uniqueness checking */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Build display name from profile */
export function buildDisplayName(profile: { firstName: string; lastName: string }): string {
  return `${profile.firstName} ${profile.lastName}`.trim();
}

/** Check if user can login */
export function canUserLogin(user: User): boolean {
  return (
    user.status === UserStatus.ACTIVE &&
    user.deletedAt === null &&
    (user.security.lockedUntil === null || new Date(user.security.lockedUntil) <= new Date())
  );
}

/** Check if user requires MFA setup */
export function requiresMfaSetup(user: User, tenantMfaPolicy: MfaPolicy): boolean {
  if (user.security.mfaEnabled) {
    return false;
  }
  
  switch (tenantMfaPolicy) {
    case MfaPolicy.REQUIRED_ALL:
      return true;
    case MfaPolicy.REQUIRED_ADMINS:
      return user.type === UserType.INTERNAL_ADMIN || user.type === UserType.OWNER;
    default:
      return false;
  }
}

/** Check if user invitation is valid */
export function isInvitationValid(user: User): boolean {
  if (user.status !== UserStatus.PENDING_ACTIVATION) {
    return false;
  }
  if (!user.invitationToken || !user.invitationExpiresAt) {
    return false;
  }
  return new Date(user.invitationExpiresAt) > new Date();
}

/** Get all organization IDs the user has access to */
export function getUserOrganizationIds(user: User): readonly OrganizationId[] {
  const orgIds = new Set<OrganizationId>();
  orgIds.add(user.primaryOrganizationId);
  for (const assignment of user.roleAssignments) {
    orgIds.add(assignment.organizationId);
  }
  return Array.from(orgIds);
}

/** Constants for security thresholds */
export const SECURITY_CONSTANTS = {
  /** Maximum failed login attempts before lockout */
  MAX_FAILED_ATTEMPTS: 5,
  /** Lockout duration in milliseconds (15 minutes) */
  LOCKOUT_DURATION_MS: 15 * 60 * 1000,
  /** Invitation validity duration in milliseconds (7 days) */
  INVITATION_VALIDITY_MS: 7 * 24 * 60 * 60 * 1000,
  /** Password reset validity duration in milliseconds (1 hour) */
  PASSWORD_RESET_VALIDITY_MS: 60 * 60 * 1000,
} as const;
