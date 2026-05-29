/**
 * Permission Resolver
 * 
 * Resolves effective permissions for a user based on their role assignments,
 * including role inheritance and permission aggregation.
 */

import type {
  UserId,
  TenantId,
  RoleId,
  OrganizationId,
} from '@borjie/domain-models';
import {
  type Role,
  type User,
  type UserRoleAssignment,
  permissionMatches,
} from '@borjie/domain-models';

/** Resolved permissions for a user */
export interface ResolvedPermissions {
  /** User ID */
  readonly userId: UserId;
  /** Tenant ID */
  readonly tenantId: TenantId;
  /** All effective permissions (flattened from all roles) */
  readonly permissions: ReadonlySet<string>;
  /** Permissions grouped by organization */
  readonly permissionsByOrg: ReadonlyMap<OrganizationId, ReadonlySet<string>>;
  /** Whether user has any admin role */
  readonly isAdmin: boolean;
  /** Highest priority role */
  readonly maxPriority: number;
  /** Role IDs that were resolved */
  readonly resolvedRoleIds: readonly RoleId[];
}

/** Role resolver interface for dependency injection */
export interface RoleResolver {
  getRole(roleId: RoleId, tenantId: TenantId): Promise<Role | null>;
  getRolesByIds(roleIds: readonly RoleId[], tenantId: TenantId): Promise<readonly Role[]>;
}

/** Cache for resolved permissions */
export interface PermissionCache {
  get(key: string): ResolvedPermissions | undefined;
  set(key: string, value: ResolvedPermissions, ttlMs: number): void;
  delete(key: string): void;
}

/** Simple in-memory cache implementation */
export class InMemoryPermissionCache implements PermissionCache {
  private cache = new Map<string, { value: ResolvedPermissions; expiresAt: number }>();
  
  get(key: string): ResolvedPermissions | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }
  
  set(key: string, value: ResolvedPermissions, ttlMs: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

/** Permission resolver configuration */
export interface PermissionResolverConfig {
  /** Cache TTL in milliseconds */
  cacheTtlMs: number;
  /** Maximum depth for role inheritance */
  maxInheritanceDepth: number;
}

const DEFAULT_CONFIG: PermissionResolverConfig = {
  cacheTtlMs: 60_000, // 1 minute
  maxInheritanceDepth: 5,
};

/**
 * Resolves effective permissions for users based on their role assignments.
 */
export class PermissionResolver {
  private readonly config: PermissionResolverConfig;
  private readonly cache: PermissionCache;
  private readonly roleResolver: RoleResolver;
  
  constructor(
    roleResolver: RoleResolver,
    cache?: PermissionCache,
    config?: Partial<PermissionResolverConfig>
  ) {
    this.roleResolver = roleResolver;
    this.cache = cache ?? new InMemoryPermissionCache();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Resolve all effective permissions for a user.
   */
  async resolvePermissions(user: User): Promise<ResolvedPermissions> {
    const cacheKey = this.getCacheKey(user);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const resolved = await this.computePermissions(user);
    this.cache.set(cacheKey, resolved, this.config.cacheTtlMs);
    return resolved;
  }
  
  /**
   * Check if user has a specific permission.
   */
  async hasPermission(user: User, requiredPermission: string): Promise<boolean> {
    const resolved = await this.resolvePermissions(user);
    return this.checkPermission(resolved.permissions, requiredPermission);
  }
  
  /**
   * Check if user has a permission in a specific organization.
   */
  async hasPermissionInOrg(
    user: User,
    requiredPermission: string,
    organizationId: OrganizationId
  ): Promise<boolean> {
    const resolved = await this.resolvePermissions(user);
    
    // First check global permissions
    if (this.checkPermission(resolved.permissions, requiredPermission)) {
      return true;
    }
    
    // Then check org-specific permissions
    const orgPermissions = resolved.permissionsByOrg.get(organizationId);
    if (orgPermissions) {
      return this.checkPermission(orgPermissions, requiredPermission);
    }
    
    return false;
  }
  
  /**
   * Invalidate cache for a user.
   */
  invalidateUser(userId: UserId, tenantId: TenantId): void {
    this.cache.delete(`${tenantId}:${userId}`);
  }
  
  /**
   * Check if a permission set contains the required permission.
   */
  private checkPermission(permissions: ReadonlySet<string>, required: string): boolean {
    for (const perm of permissions) {
      if (permissionMatches(perm, required)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Compute permissions by resolving all roles and their inheritance.
   */
  private async computePermissions(user: User): Promise<ResolvedPermissions> {
    const roleIds = user.roleAssignments.map((a) => a.roleId);
    const roles = await this.roleResolver.getRolesByIds(roleIds, user.tenantId);
    
    // Build a map of roles by ID for quick lookup
    const roleMap = new Map<RoleId, Role>();
    for (const role of roles) {
      roleMap.set(role.id, role);
    }
    
    // Resolve inherited roles
    const allRoles = await this.resolveInheritedRoles(roles, user.tenantId, roleMap);
    
    // Aggregate permissions
    const allPermissions = new Set<string>();
    const permissionsByOrg = new Map<OrganizationId, Set<string>>();
    let isAdmin = false;
    let maxPriority = 0;
    
    for (const assignment of user.roleAssignments) {
      const role = roleMap.get(assignment.roleId);
      if (!role) continue;
      
      // Check if assignment is expired
      if (assignment.expiresAt && new Date(assignment.expiresAt) < new Date()) {
        continue;
      }
      
      // Get all permissions including inherited
      const rolePermissions = this.getRolePermissions(role, roleMap);
      
      // Add to organization-specific permissions
      let orgPerms = permissionsByOrg.get(assignment.organizationId);
      if (!orgPerms) {
        orgPerms = new Set<string>();
        permissionsByOrg.set(assignment.organizationId, orgPerms);
      }
      
      for (const perm of rolePermissions) {
        allPermissions.add(perm);
        orgPerms.add(perm);
      }
      
      if (role.isAdmin) {
        isAdmin = true;
      }
      
      if (role.priority > maxPriority) {
        maxPriority = role.priority;
      }
    }
    
    // Check all resolved roles for admin flag
    for (const role of allRoles) {
      if (role.isAdmin) {
        isAdmin = true;
      }
    }
    
    return {
      userId: user.id,
      tenantId: user.tenantId,
      permissions: allPermissions,
      permissionsByOrg: permissionsByOrg as ReadonlyMap<OrganizationId, ReadonlySet<string>>,
      isAdmin,
      maxPriority,
      resolvedRoleIds: allRoles.map((r) => r.id),
    };
  }
  
  /**
   * Resolve all inherited roles up to max depth.
   */
  private async resolveInheritedRoles(
    roles: readonly Role[],
    tenantId: TenantId,
    roleMap: Map<RoleId, Role>,
    depth = 0
  ): Promise<readonly Role[]> {
    if (depth >= this.config.maxInheritanceDepth) {
      return roles;
    }
    
    const inheritedRoleIds = new Set<RoleId>();
    for (const role of roles) {
      for (const inheritedId of role.inheritsFrom) {
        if (!roleMap.has(inheritedId)) {
          inheritedRoleIds.add(inheritedId);
        }
      }
    }
    
    if (inheritedRoleIds.size === 0) {
      return roles;
    }
    
    const inheritedRoles = await this.roleResolver.getRolesByIds(
      Array.from(inheritedRoleIds),
      tenantId
    );
    
    for (const role of inheritedRoles) {
      roleMap.set(role.id, role);
    }
    
    // Recursively resolve further inheritance
    return this.resolveInheritedRoles(
      [...roles, ...inheritedRoles],
      tenantId,
      roleMap,
      depth + 1
    );
  }
  
  /**
   * Get all permissions for a role including inherited.
   */
  private getRolePermissions(role: Role, roleMap: Map<RoleId, Role>): Set<string> {
    const permissions = new Set<string>(role.permissions as string[]);
    
    for (const inheritedId of role.inheritsFrom) {
      const inheritedRole = roleMap.get(inheritedId);
      if (inheritedRole) {
        for (const perm of inheritedRole.permissions) {
          permissions.add(perm);
        }
      }
    }
    
    return permissions;
  }
  
  private getCacheKey(user: User): string {
    return `${user.tenantId}:${user.id}`;
  }
}
