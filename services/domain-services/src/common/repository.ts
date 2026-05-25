/**
 * Repository Interfaces
 * 
 * Abstract repository interfaces for data access.
 * Implementations can be provided for different databases.
 */

import type {
  TenantId,
  OrganizationId,
  UserId,
  RoleId,
  PolicyId,
  SessionId,
  AuditEventId,
  PaginationParams,
  PaginatedResult,
} from '@borjie/domain-models';
import type {
  Tenant,
  CreateTenantInput,
  UpdateTenantInput,
  TenantWithUsage,
  Organization,
  CreateOrganizationInput,
  UpdateOrganizationInput,
  User,
  CreateUserInput,
  UpdateUserInput,
  Role,
  CreateRoleInput,
  UpdateRoleInput,
  Policy,
  CreatePolicyInput,
  UpdatePolicyInput,
  Session,
  CreateSessionInput,
  AuditEvent,
  CreateAuditEventInput,
  AuditEventFilters,
} from '@borjie/domain-models';

/** Transaction context for unit of work pattern */
export interface TransactionContext {
  readonly id: string;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Base repository interface */
export interface Repository<T, TId, TCreateInput, TUpdateInput> {
  findById(id: TId, tenantId: TenantId): Promise<T | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<T>>;
  create(input: TCreateInput, tenantId: TenantId, createdBy: UserId): Promise<T>;
  update(id: TId, input: TUpdateInput, tenantId: TenantId, updatedBy: UserId): Promise<T>;
  delete(id: TId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
}

/** Tenant repository interface */
export interface TenantRepository {
  findById(id: TenantId): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  findMany(pagination?: PaginationParams): Promise<PaginatedResult<Tenant>>;
  findWithUsage(id: TenantId): Promise<TenantWithUsage | null>;
  create(input: CreateTenantInput, createdBy: UserId): Promise<Tenant>;
  update(id: TenantId, input: UpdateTenantInput, updatedBy: UserId): Promise<Tenant>;
  delete(id: TenantId, deletedBy: UserId): Promise<void>;
  updateLastActivity(id: TenantId): Promise<void>;
}

/** Organization repository interface */
export interface OrganizationRepository extends Repository<Organization, OrganizationId, CreateOrganizationInput, UpdateOrganizationInput> {
  findByCode(code: string, tenantId: TenantId): Promise<Organization | null>;
  findByParent(parentId: OrganizationId, tenantId: TenantId): Promise<readonly Organization[]>;
  findDescendants(id: OrganizationId, tenantId: TenantId): Promise<readonly Organization[]>;
  findAncestors(id: OrganizationId, tenantId: TenantId): Promise<readonly Organization[]>;
  findRoot(tenantId: TenantId): Promise<Organization | null>;
}

/** User repository interface */
export interface UserRepository extends Repository<User, UserId, CreateUserInput, UpdateUserInput> {
  findByEmail(email: string, tenantId: TenantId): Promise<User | null>;
  findByInvitationToken(token: string): Promise<User | null>;
  findByOrganization(organizationId: OrganizationId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<User>>;
  findByRole(roleId: RoleId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<User>>;
  updateLastLogin(id: UserId, tenantId: TenantId): Promise<void>;
  updateLastActivity(id: UserId, tenantId: TenantId): Promise<void>;
  incrementFailedLogins(id: UserId, tenantId: TenantId): Promise<number>;
  resetFailedLogins(id: UserId, tenantId: TenantId): Promise<void>;
  lockUser(id: UserId, tenantId: TenantId, lockedUntil: string): Promise<void>;
  unlockUser(id: UserId, tenantId: TenantId): Promise<void>;
}

/** Role repository interface */
export interface RoleRepository extends Repository<Role, RoleId, CreateRoleInput, UpdateRoleInput> {
  findByName(name: string, tenantId: TenantId): Promise<Role | null>;
  findSystemRoles(tenantId: TenantId): Promise<readonly Role[]>;
  findByIds(ids: readonly RoleId[], tenantId: TenantId): Promise<readonly Role[]>;
}

/** Policy repository interface */
export interface PolicyRepository extends Repository<Policy, PolicyId, CreatePolicyInput, UpdatePolicyInput> {
  findByName(name: string, tenantId: TenantId): Promise<Policy | null>;
  findActive(tenantId: TenantId): Promise<readonly Policy[]>;
  findSystemPolicies(tenantId: TenantId): Promise<readonly Policy[]>;
}

/** Session repository interface */
export interface SessionRepository {
  findById(id: SessionId): Promise<Session | null>;
  findByUserId(userId: UserId, tenantId: TenantId): Promise<readonly Session[]>;
  findActiveByUserId(userId: UserId, tenantId: TenantId): Promise<readonly Session[]>;
  create(input: CreateSessionInput): Promise<Session>;
  updateLastActivity(id: SessionId, ipAddress: string): Promise<void>;
  setMfaVerified(id: SessionId): Promise<void>;
  revoke(id: SessionId, reason: string, revokedBy: UserId): Promise<void>;
  revokeAllForUser(userId: UserId, tenantId: TenantId, reason: string, revokedBy: UserId): Promise<number>;
  deleteExpired(): Promise<number>;
}

/** Audit event repository interface (append-only) */
export interface AuditEventRepository {
  findById(id: AuditEventId): Promise<AuditEvent | null>;
  findMany(filters: AuditEventFilters, pagination?: PaginationParams): Promise<PaginatedResult<AuditEvent>>;
  create(input: CreateAuditEventInput): Promise<AuditEvent>;
  countByFilters(filters: AuditEventFilters): Promise<number>;
  deleteOlderThan(timestamp: string): Promise<number>;
}

/** Unit of work for transactional operations */
export interface UnitOfWork {
  readonly tenants: TenantRepository;
  readonly organizations: OrganizationRepository;
  readonly users: UserRepository;
  readonly roles: RoleRepository;
  readonly policies: PolicyRepository;
  readonly sessions: SessionRepository;
  readonly auditEvents: AuditEventRepository;
  
  beginTransaction(): Promise<TransactionContext>;
  executeInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** Repository factory */
export interface RepositoryFactory {
  createUnitOfWork(): UnitOfWork;
}
