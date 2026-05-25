/**
 * Permission Resolver Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PermissionResolver,
  InMemoryPermissionCache,
  type RoleResolver,
} from './permission-resolver.js';
import {
  type User,
  type Role,
  UserStatus,
  UserType,
  RoleType,
  RoleScope,
} from '@borjie/domain-models';
import { asTenantId, asOrganizationId, asUserId, asRoleId } from '@borjie/domain-models';

const createMockRole = (overrides: Partial<Role> = {}): Role => ({
  id: asRoleId('role-1'),
  tenantId: asTenantId('tenant-1'),
  name: 'Test Role',
  description: 'Test role description',
  type: RoleType.CUSTOM,
  scope: RoleScope.GLOBAL,
  permissions: ['user:read', 'user:list'],
  isAdmin: false,
  priority: 100,
  inheritsFrom: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdBy: asUserId('admin-1'),
  updatedBy: asUserId('admin-1'),
  deletedAt: null,
  deletedBy: null,
  ...overrides,
});

const createMockUser = (overrides: Partial<User> = {}): User => ({
  id: asUserId('user-1'),
  tenantId: asTenantId('tenant-1'),
  email: 'test@example.com',
  emailNormalized: 'test@example.com',
  emailVerified: true,
  emailVerifiedAt: '2024-01-01T00:00:00Z',
  type: UserType.OWNER,
  status: UserStatus.ACTIVE,
  profile: {
    firstName: 'Test',
    lastName: 'User',
    displayName: 'Test User',
    avatarUrl: null,
    phone: null,
    timezone: 'UTC',
    locale: 'en',
  },
  security: {
    mfaEnabled: false,
    mfaMethods: [],
    preferredMfaMethod: null,
    passwordChangedAt: '2024-01-01T00:00:00Z',
    passwordHistoryCount: 0,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastFailedLoginAt: null,
  },
  primaryOrganizationId: asOrganizationId('org-1'),
  roleAssignments: [
    {
      roleId: asRoleId('role-1'),
      organizationId: asOrganizationId('org-1'),
      assignedAt: '2024-01-01T00:00:00Z',
      assignedBy: asUserId('admin-1'),
      expiresAt: null,
    },
  ],
  lastLoginAt: null,
  lastActivityAt: null,
  invitationToken: null,
  invitationExpiresAt: null,
  externalIdpId: null,
  externalUserId: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdBy: asUserId('admin-1'),
  updatedBy: asUserId('admin-1'),
  deletedAt: null,
  deletedBy: null,
  ...overrides,
});

describe('PermissionResolver', () => {
  let resolver: PermissionResolver;
  let mockRoleResolver: RoleResolver;
  let roles: Map<string, Role>;
  
  beforeEach(() => {
    roles = new Map();
    roles.set('role-1', createMockRole());
    
    mockRoleResolver = {
      getRole: async (roleId, tenantId) => roles.get(roleId) ?? null,
      getRolesByIds: async (roleIds, tenantId) => 
        roleIds.map(id => roles.get(id)).filter((r): r is Role => r !== undefined),
    };
    
    resolver = new PermissionResolver(mockRoleResolver);
  });
  
  describe('resolvePermissions', () => {
    it('should resolve permissions from user roles', async () => {
      const user = createMockUser();
      const resolved = await resolver.resolvePermissions(user);
      
      expect(resolved.userId).toBe(user.id);
      expect(resolved.tenantId).toBe(user.tenantId);
      expect(resolved.permissions.has('user:read')).toBe(true);
      expect(resolved.permissions.has('user:list')).toBe(true);
      expect(resolved.isAdmin).toBe(false);
    });
    
    it('should aggregate permissions from multiple roles', async () => {
      const role2 = createMockRole({
        id: asRoleId('role-2'),
        permissions: ['property:read', 'property:list'],
      });
      roles.set('role-2', role2);
      
      const user = createMockUser({
        roleAssignments: [
          {
            roleId: asRoleId('role-1'),
            organizationId: asOrganizationId('org-1'),
            assignedAt: '2024-01-01T00:00:00Z',
            assignedBy: asUserId('admin-1'),
            expiresAt: null,
          },
          {
            roleId: asRoleId('role-2'),
            organizationId: asOrganizationId('org-1'),
            assignedAt: '2024-01-01T00:00:00Z',
            assignedBy: asUserId('admin-1'),
            expiresAt: null,
          },
        ],
      });
      
      const resolved = await resolver.resolvePermissions(user);
      
      expect(resolved.permissions.has('user:read')).toBe(true);
      expect(resolved.permissions.has('property:read')).toBe(true);
    });
    
    it('should track org-specific permissions', async () => {
      const user = createMockUser({
        roleAssignments: [
          {
            roleId: asRoleId('role-1'),
            organizationId: asOrganizationId('org-1'),
            assignedAt: '2024-01-01T00:00:00Z',
            assignedBy: asUserId('admin-1'),
            expiresAt: null,
          },
        ],
      });
      
      const resolved = await resolver.resolvePermissions(user);
      
      const org1Perms = resolved.permissionsByOrg.get(asOrganizationId('org-1'));
      expect(org1Perms?.has('user:read')).toBe(true);
    });
    
    it('should identify admin roles', async () => {
      const adminRole = createMockRole({
        id: asRoleId('admin-role'),
        isAdmin: true,
        permissions: ['*:*'],
      });
      roles.set('admin-role', adminRole);
      
      const user = createMockUser({
        roleAssignments: [
          {
            roleId: asRoleId('admin-role'),
            organizationId: asOrganizationId('org-1'),
            assignedAt: '2024-01-01T00:00:00Z',
            assignedBy: asUserId('admin-1'),
            expiresAt: null,
          },
        ],
      });
      
      const resolved = await resolver.resolvePermissions(user);
      expect(resolved.isAdmin).toBe(true);
    });
    
    it('should skip expired role assignments', async () => {
      const user = createMockUser({
        roleAssignments: [
          {
            roleId: asRoleId('role-1'),
            organizationId: asOrganizationId('org-1'),
            assignedAt: '2024-01-01T00:00:00Z',
            assignedBy: asUserId('admin-1'),
            expiresAt: new Date(Date.now() - 60000).toISOString(), // Expired
          },
        ],
      });
      
      const resolved = await resolver.resolvePermissions(user);
      expect(resolved.permissions.size).toBe(0);
    });
  });
  
  describe('hasPermission', () => {
    it('should return true for exact permission match', async () => {
      const user = createMockUser();
      expect(await resolver.hasPermission(user, 'user:read')).toBe(true);
    });
    
    it('should return false for missing permission', async () => {
      const user = createMockUser();
      expect(await resolver.hasPermission(user, 'property:read')).toBe(false);
    });
    
    it('should handle wildcard permissions', async () => {
      const wildcardRole = createMockRole({
        id: asRoleId('wildcard-role'),
        permissions: ['user:*'],
      });
      roles.set('wildcard-role', wildcardRole);
      
      const user = createMockUser({
        roleAssignments: [
          {
            roleId: asRoleId('wildcard-role'),
            organizationId: asOrganizationId('org-1'),
            assignedAt: '2024-01-01T00:00:00Z',
            assignedBy: asUserId('admin-1'),
            expiresAt: null,
          },
        ],
      });
      
      expect(await resolver.hasPermission(user, 'user:read')).toBe(true);
      expect(await resolver.hasPermission(user, 'user:delete')).toBe(true);
    });
    
    it('should handle super wildcard', async () => {
      const superRole = createMockRole({
        id: asRoleId('super-role'),
        permissions: ['*:*'],
      });
      roles.set('super-role', superRole);
      
      const user = createMockUser({
        roleAssignments: [
          {
            roleId: asRoleId('super-role'),
            organizationId: asOrganizationId('org-1'),
            assignedAt: '2024-01-01T00:00:00Z',
            assignedBy: asUserId('admin-1'),
            expiresAt: null,
          },
        ],
      });
      
      expect(await resolver.hasPermission(user, 'anything:here')).toBe(true);
    });
  });
  
  describe('caching', () => {
    it('should cache resolved permissions', async () => {
      let callCount = 0;
      const countingResolver: RoleResolver = {
        getRole: async (roleId, tenantId) => {
          callCount++;
          return roles.get(roleId) ?? null;
        },
        getRolesByIds: async (roleIds, tenantId) => {
          callCount++;
          return roleIds.map(id => roles.get(id)).filter((r): r is Role => r !== undefined);
        },
      };
      
      const cachingResolver = new PermissionResolver(countingResolver);
      const user = createMockUser();
      
      await cachingResolver.resolvePermissions(user);
      await cachingResolver.resolvePermissions(user);
      
      expect(callCount).toBe(1); // Only called once due to caching
    });
    
    it('should respect cache invalidation', async () => {
      let callCount = 0;
      const countingResolver: RoleResolver = {
        getRole: async (roleId, tenantId) => {
          callCount++;
          return roles.get(roleId) ?? null;
        },
        getRolesByIds: async (roleIds, tenantId) => {
          callCount++;
          return roleIds.map(id => roles.get(id)).filter((r): r is Role => r !== undefined);
        },
      };
      
      const cachingResolver = new PermissionResolver(countingResolver);
      const user = createMockUser();
      
      await cachingResolver.resolvePermissions(user);
      cachingResolver.invalidateUser(user.id, user.tenantId);
      await cachingResolver.resolvePermissions(user);
      
      expect(callCount).toBe(2); // Called twice after invalidation
    });
  });
});
