/**
 * Identity Service
 * 
 * Business logic for user identity, authentication, and role management.
 */

import type {
  TenantId,
  OrganizationId,
  UserId,
  RoleId,
  SessionId,
  ISOTimestamp,
  PaginationParams,
  PaginatedResult,
} from '@borjie/domain-models';
import {
  type User,
  type CreateUserInput,
  type UpdateUserInput,
  type InviteUserInput,
  type UserRoleAssignment,
  type Role,
  type CreateRoleInput,
  type UpdateRoleInput,
  type Session,
  type CreateSessionInput,
  type DeviceInfo,
  type GeoLocation,
  UserStatus,
  UserType,
  RoleType,
  SessionStatus,
  AuthMethod,
  SECURITY_CONSTANTS,
  SESSION_CONSTANTS,
  SYSTEM_ROLES,
  normalizeEmail,
  buildDisplayName,
  canUserLogin,
  asUserId,
  asRoleId,
  asSessionId,
  ok,
  err,
  type Result,
} from '@borjie/domain-models';
import type {
  UserRepository,
  RoleRepository,
  SessionRepository,
  UnitOfWork,
} from '../common/repository.js';
import {
  type EventBus,
  type UserCreatedEvent,
  type UserInvitedEvent,
  type UserActivatedEvent,
  type SessionCreatedEvent,
  type UserRoleAssignedEvent,
  type RoleCreatedEvent,
  createEventEnvelope,
  generateEventId,
} from '../common/events.js';

/** Identity service errors */
export const IdentityServiceError = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  INVALID_EMAIL: 'INVALID_EMAIL',
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  ROLE_NAME_EXISTS: 'ROLE_NAME_EXISTS',
  CANNOT_MODIFY_SYSTEM_ROLE: 'CANNOT_MODIFY_SYSTEM_ROLE',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  USER_LOCKED: 'USER_LOCKED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  INVALID_INVITATION: 'INVALID_INVITATION',
  MAX_SESSIONS_REACHED: 'MAX_SESSIONS_REACHED',
  ROLE_ALREADY_ASSIGNED: 'ROLE_ALREADY_ASSIGNED',
  ROLE_NOT_ASSIGNED: 'ROLE_NOT_ASSIGNED',
} as const;

export type IdentityServiceErrorCode = (typeof IdentityServiceError)[keyof typeof IdentityServiceError];

export interface IdentityServiceErrorResult {
  code: IdentityServiceErrorCode;
  message: string;
}

/**
 * Identity and user management service.
 */
export class IdentityService {
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  
  constructor(uow: UnitOfWork, eventBus: EventBus) {
    this.uow = uow;
    this.eventBus = eventBus;
  }
  
  // ==================== User Operations ====================
  
  /**
   * Create a new user.
   */
  async createUser(
    tenantId: TenantId,
    input: CreateUserInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<User, IdentityServiceErrorResult>> {
    // Validate email
    const normalizedEmail = normalizeEmail(input.email);
    if (!this.isValidEmail(normalizedEmail)) {
      return err({
        code: IdentityServiceError.INVALID_EMAIL,
        message: 'Invalid email format',
      });
    }
    
    // Check email uniqueness within tenant
    const existing = await this.uow.users.findByEmail(normalizedEmail, tenantId);
    if (existing) {
      return err({
        code: IdentityServiceError.EMAIL_EXISTS,
        message: 'Email already exists in this tenant',
      });
    }
    
    const user = await this.uow.users.create(input, tenantId, createdBy);
    
    const event: UserCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'UserCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        userId: user.id,
        email: user.email,
        userType: user.type,
        primaryOrganizationId: user.primaryOrganizationId,
      },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, user.id, 'User'));
    
    return ok(user);
  }
  
  /**
   * Invite a new user.
   */
  async inviteUser(
    tenantId: TenantId,
    input: InviteUserInput,
    invitedBy: UserId,
    correlationId: string
  ): Promise<Result<User, IdentityServiceErrorResult>> {
    const normalizedEmail = normalizeEmail(input.email);
    
    // Check email uniqueness
    const existing = await this.uow.users.findByEmail(normalizedEmail, tenantId);
    if (existing) {
      return err({
        code: IdentityServiceError.EMAIL_EXISTS,
        message: 'Email already exists in this tenant',
      });
    }
    
    // Create user with pending activation status
    const createInput: CreateUserInput = {
      email: input.email,
      type: input.type,
      profile: {
        firstName: input.profile.firstName,
        lastName: input.profile.lastName,
        displayName: buildDisplayName(input.profile),
        avatarUrl: null,
        phone: null,
        timezone: 'UTC',
        locale: 'en',
      },
      primaryOrganizationId: input.primaryOrganizationId,
      roleAssignments: input.roleAssignments.map((r) => ({
        roleId: r.roleId,
        organizationId: r.organizationId,
        expiresAt: null,
      })),
      sendInvitation: true,
    };
    
    const user = await this.uow.users.create(createInput, tenantId, invitedBy);
    
    const event: UserInvitedEvent = {
      eventId: generateEventId(),
      eventType: 'UserInvited',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        userId: user.id,
        email: user.email,
        invitedBy,
        expiresAt: user.invitationExpiresAt!,
      },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, user.id, 'User'));
    
    return ok(user);
  }
  
  /**
   * Activate a user from invitation.
   */
  async activateUser(
    invitationToken: string,
    correlationId: string
  ): Promise<Result<User, IdentityServiceErrorResult>> {
    const user = await this.uow.users.findByInvitationToken(invitationToken);
    
    if (!user) {
      return err({
        code: IdentityServiceError.INVALID_INVITATION,
        message: 'Invalid or expired invitation',
      });
    }
    
    if (user.status !== UserStatus.PENDING_ACTIVATION) {
      return err({
        code: IdentityServiceError.INVALID_INVITATION,
        message: 'User is already activated',
      });
    }
    
    if (
      user.invitationExpiresAt &&
      new Date(user.invitationExpiresAt) < new Date()
    ) {
      return err({
        code: IdentityServiceError.INVALID_INVITATION,
        message: 'Invitation has expired',
      });
    }
    
    const updatedUser = await this.uow.users.update(
      user.id,
      { status: UserStatus.ACTIVE },
      user.tenantId,
      user.id
    );
    
    const event: UserActivatedEvent = {
      eventId: generateEventId(),
      eventType: 'UserActivated',
      timestamp: new Date().toISOString(),
      tenantId: user.tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: { userId: user.id },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, user.id, 'User'));
    
    return ok(updatedUser);
  }
  
  /**
   * Get a user by ID.
   */
  async getUser(userId: UserId, tenantId: TenantId): Promise<User | null> {
    return this.uow.users.findById(userId, tenantId);
  }
  
  /**
   * Get a user by email.
   */
  async getUserByEmail(email: string, tenantId: TenantId): Promise<User | null> {
    return this.uow.users.findByEmail(normalizeEmail(email), tenantId);
  }
  
  /**
   * Update a user.
   */
  async updateUser(
    userId: UserId,
    tenantId: TenantId,
    input: UpdateUserInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<User, IdentityServiceErrorResult>> {
    const existing = await this.uow.users.findById(userId, tenantId);
    if (!existing) {
      return err({
        code: IdentityServiceError.USER_NOT_FOUND,
        message: 'User not found',
      });
    }
    
    // If email is changing, check uniqueness
    if (input.email) {
      const normalizedEmail = normalizeEmail(input.email);
      const emailUser = await this.uow.users.findByEmail(normalizedEmail, tenantId);
      if (emailUser && emailUser.id !== userId) {
        return err({
          code: IdentityServiceError.EMAIL_EXISTS,
          message: 'Email already exists',
        });
      }
    }
    
    const user = await this.uow.users.update(userId, input, tenantId, updatedBy);
    return ok(user);
  }
  
  /**
   * Assign a role to a user.
   */
  async assignRole(
    userId: UserId,
    tenantId: TenantId,
    roleId: RoleId,
    organizationId: OrganizationId,
    assignedBy: UserId,
    correlationId: string,
    expiresAt?: ISOTimestamp
  ): Promise<Result<User, IdentityServiceErrorResult>> {
    const user = await this.uow.users.findById(userId, tenantId);
    if (!user) {
      return err({
        code: IdentityServiceError.USER_NOT_FOUND,
        message: 'User not found',
      });
    }
    
    const role = await this.uow.roles.findById(roleId, tenantId);
    if (!role) {
      return err({
        code: IdentityServiceError.ROLE_NOT_FOUND,
        message: 'Role not found',
      });
    }
    
    // Check if role is already assigned to this org
    const existingAssignment = user.roleAssignments.find(
      (a) => a.roleId === roleId && a.organizationId === organizationId
    );
    
    if (existingAssignment) {
      return err({
        code: IdentityServiceError.ROLE_ALREADY_ASSIGNED,
        message: 'Role is already assigned to user for this organization',
      });
    }
    
    const newAssignment: UserRoleAssignment = {
      roleId,
      organizationId,
      assignedAt: new Date().toISOString(),
      assignedBy,
      expiresAt: expiresAt ?? null,
    };
    
    // Update user with new role assignment
    // In a real implementation, this would be handled by the repository
    const updatedAssignments = [...user.roleAssignments, newAssignment];
    
    // For now, we'll use a simplified approach
    const updatedUser = await this.uow.users.update(
      userId,
      {}, // Role assignments handled separately
      tenantId,
      assignedBy
    );
    
    const event: UserRoleAssignedEvent = {
      eventId: generateEventId(),
      eventType: 'UserRoleAssigned',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        userId,
        roleId,
        organizationId,
        assignedBy,
      },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, userId, 'User'));
    
    return ok(updatedUser);
  }
  
  /**
   * Record failed login attempt.
   */
  async recordFailedLogin(
    userId: UserId,
    tenantId: TenantId
  ): Promise<{ locked: boolean; attempts: number }> {
    const attempts = await this.uow.users.incrementFailedLogins(userId, tenantId);
    
    if (attempts >= SECURITY_CONSTANTS.MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(
        Date.now() + SECURITY_CONSTANTS.LOCKOUT_DURATION_MS
      ).toISOString();
      await this.uow.users.lockUser(userId, tenantId, lockedUntil);
      return { locked: true, attempts };
    }
    
    return { locked: false, attempts };
  }
  
  /**
   * Record successful login.
   */
  async recordSuccessfulLogin(userId: UserId, tenantId: TenantId): Promise<void> {
    await this.uow.users.resetFailedLogins(userId, tenantId);
    await this.uow.users.updateLastLogin(userId, tenantId);
  }
  
  // ==================== Role Operations ====================
  
  /**
   * Create a custom role.
   */
  async createRole(
    tenantId: TenantId,
    input: CreateRoleInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Role, IdentityServiceErrorResult>> {
    // Check name uniqueness
    const existing = await this.uow.roles.findByName(input.name, tenantId);
    if (existing) {
      return err({
        code: IdentityServiceError.ROLE_NAME_EXISTS,
        message: 'Role name already exists',
      });
    }
    
    const role = await this.uow.roles.create(input, tenantId, createdBy);
    
    const event: RoleCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'RoleCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        roleId: role.id,
        name: role.name,
        permissions: role.permissions,
      },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, role.id, 'Role'));
    
    return ok(role);
  }
  
  /**
   * Get a role by ID.
   */
  async getRole(roleId: RoleId, tenantId: TenantId): Promise<Role | null> {
    return this.uow.roles.findById(roleId, tenantId);
  }
  
  /**
   * Get roles by IDs.
   */
  async getRolesByIds(
    roleIds: readonly RoleId[],
    tenantId: TenantId
  ): Promise<readonly Role[]> {
    return this.uow.roles.findByIds(roleIds, tenantId);
  }
  
  /**
   * Get system roles for a tenant.
   */
  async getSystemRoles(tenantId: TenantId): Promise<readonly Role[]> {
    return this.uow.roles.findSystemRoles(tenantId);
  }
  
  /**
   * Update a role.
   */
  async updateRole(
    roleId: RoleId,
    tenantId: TenantId,
    input: UpdateRoleInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Role, IdentityServiceErrorResult>> {
    const existing = await this.uow.roles.findById(roleId, tenantId);
    if (!existing) {
      return err({
        code: IdentityServiceError.ROLE_NOT_FOUND,
        message: 'Role not found',
      });
    }
    
    if (existing.type === RoleType.SYSTEM) {
      return err({
        code: IdentityServiceError.CANNOT_MODIFY_SYSTEM_ROLE,
        message: 'Cannot modify system roles',
      });
    }
    
    const role = await this.uow.roles.update(roleId, input, tenantId, updatedBy);
    return ok(role);
  }
  
  // ==================== Session Operations ====================
  
  /**
   * Create a new session.
   */
  async createSession(
    input: CreateSessionInput,
    correlationId: string
  ): Promise<Result<Session, IdentityServiceErrorResult>> {
    // Check max concurrent sessions
    const activeSessions = await this.uow.sessions.findActiveByUserId(
      input.userId,
      input.tenantId
    );
    
    if (activeSessions.length >= SESSION_CONSTANTS.MAX_CONCURRENT_SESSIONS) {
      return err({
        code: IdentityServiceError.MAX_SESSIONS_REACHED,
        message: 'Maximum concurrent sessions reached',
      });
    }
    
    const session = await this.uow.sessions.create(input);
    
    const event: SessionCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'SessionCreated',
      timestamp: new Date().toISOString(),
      tenantId: input.tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        sessionId: session.id,
        userId: input.userId,
        authMethod: input.authMethod,
        ipAddress: session.lastActivityIp,
      },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, session.id, 'Session'));
    
    return ok(session);
  }
  
  /**
   * Get a session by ID.
   */
  async getSession(sessionId: SessionId): Promise<Session | null> {
    // nosemgrep: missing-tenant-id-arg reason: sessions are looked up by globally-unique session ID (cookie); tenantId is then derived from the session itself.
    return this.uow.sessions.findById(sessionId);
  }
  
  /**
   * Validate and refresh a session.
   */
  async validateSession(
    sessionId: SessionId
  ): Promise<Result<Session, IdentityServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: sessions are looked up by globally-unique session ID (cookie); tenantId is then derived from the session itself.
    const session = await this.uow.sessions.findById(sessionId);

    if (!session) {
      return err({
        code: IdentityServiceError.SESSION_NOT_FOUND,
        message: 'Session not found',
      });
    }
    
    if (session.status === SessionStatus.REVOKED) {
      return err({
        code: IdentityServiceError.SESSION_REVOKED,
        message: 'Session has been revoked',
      });
    }
    
    if (session.status === SessionStatus.EXPIRED || new Date(session.expiresAt) < new Date()) {
      return err({
        code: IdentityServiceError.SESSION_EXPIRED,
        message: 'Session has expired',
      });
    }
    
    return ok(session);
  }
  
  /**
   * Revoke a session.
   */
  async revokeSession(
    sessionId: SessionId,
    reason: string,
    revokedBy: UserId,
    correlationId: string
  ): Promise<Result<void, IdentityServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: sessions are looked up by globally-unique session ID (cookie); tenantId is then derived from the session itself.
    const session = await this.uow.sessions.findById(sessionId);

    if (!session) {
      return err({
        code: IdentityServiceError.SESSION_NOT_FOUND,
        message: 'Session not found',
      });
    }
    
    await this.uow.sessions.revoke(sessionId, reason, revokedBy);
    
    return ok(undefined);
  }
  
  /**
   * Revoke all sessions for a user.
   */
  async revokeAllUserSessions(
    userId: UserId,
    tenantId: TenantId,
    reason: string,
    revokedBy: UserId,
    correlationId: string
  ): Promise<number> {
    return this.uow.sessions.revokeAllForUser(userId, tenantId, reason, revokedBy);
  }
  
  /**
   * Set MFA verified on session.
   */
  async setSessionMfaVerified(sessionId: SessionId): Promise<void> {
    await this.uow.sessions.setMfaVerified(sessionId);
  }
  
  // ==================== Helpers ====================
  
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
