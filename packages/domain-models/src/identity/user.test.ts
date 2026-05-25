/**
 * User Domain Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  buildDisplayName,
  canUserLogin,
  requiresMfaSetup,
  isInvitationValid,
  getUserOrganizationIds,
  UserStatus,
  UserType,
  MfaPolicy,
  type User,
} from './user.js';
import { asTenantId, asOrganizationId, asUserId, asRoleId } from '../common/types.js';

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
  lastLoginAt: '2024-01-01T00:00:00Z',
  lastActivityAt: '2024-01-01T00:00:00Z',
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

describe('normalizeEmail', () => {
  it('should lowercase and trim email', () => {
    expect(normalizeEmail('  TEST@EXAMPLE.COM  ')).toBe('test@example.com');
  });
});

describe('buildDisplayName', () => {
  it('should combine first and last name', () => {
    expect(buildDisplayName({ firstName: 'John', lastName: 'Doe' })).toBe('John Doe');
  });
  
  it('should handle empty last name', () => {
    expect(buildDisplayName({ firstName: 'John', lastName: '' })).toBe('John');
  });
});

describe('canUserLogin', () => {
  it('should return true for active unlocked user', () => {
    const user = createMockUser();
    expect(canUserLogin(user)).toBe(true);
  });
  
  it('should return false for suspended user', () => {
    const user = createMockUser({ status: UserStatus.SUSPENDED });
    expect(canUserLogin(user)).toBe(false);
  });
  
  it('should return false for locked user', () => {
    const user = createMockUser({
      security: {
        ...createMockUser().security,
        lockedUntil: new Date(Date.now() + 60000).toISOString(),
      },
    });
    expect(canUserLogin(user)).toBe(false);
  });
  
  it('should return true if lock has expired', () => {
    const user = createMockUser({
      security: {
        ...createMockUser().security,
        lockedUntil: new Date(Date.now() - 60000).toISOString(),
      },
    });
    expect(canUserLogin(user)).toBe(true);
  });
  
  it('should return false for deleted user', () => {
    const user = createMockUser({ deletedAt: '2024-01-01T00:00:00Z' });
    expect(canUserLogin(user)).toBe(false);
  });
});

describe('requiresMfaSetup', () => {
  it('should return false if MFA already enabled', () => {
    const user = createMockUser({
      security: { ...createMockUser().security, mfaEnabled: true },
    });
    expect(requiresMfaSetup(user, MfaPolicy.REQUIRED_ALL)).toBe(false);
  });
  
  it('should return true for REQUIRED_ALL policy', () => {
    const user = createMockUser();
    expect(requiresMfaSetup(user, MfaPolicy.REQUIRED_ALL)).toBe(true);
  });
  
  it('should return true for admin user with REQUIRED_ADMINS policy', () => {
    const user = createMockUser({ type: UserType.INTERNAL_ADMIN });
    expect(requiresMfaSetup(user, MfaPolicy.REQUIRED_ADMINS)).toBe(true);
  });
  
  it('should return false for customer user with REQUIRED_ADMINS policy', () => {
    const user = createMockUser({ type: UserType.CUSTOMER });
    expect(requiresMfaSetup(user, MfaPolicy.REQUIRED_ADMINS)).toBe(false);
  });
  
  it('should return false for OPTIONAL policy', () => {
    const user = createMockUser();
    expect(requiresMfaSetup(user, MfaPolicy.OPTIONAL)).toBe(false);
  });
});

describe('isInvitationValid', () => {
  it('should return false if user is not pending activation', () => {
    const user = createMockUser({ status: UserStatus.ACTIVE });
    expect(isInvitationValid(user)).toBe(false);
  });
  
  it('should return false if no invitation token', () => {
    const user = createMockUser({ 
      status: UserStatus.PENDING_ACTIVATION,
      invitationToken: null,
    });
    expect(isInvitationValid(user)).toBe(false);
  });
  
  it('should return false if invitation expired', () => {
    const user = createMockUser({ 
      status: UserStatus.PENDING_ACTIVATION,
      invitationToken: 'token',
      invitationExpiresAt: new Date(Date.now() - 60000).toISOString(),
    });
    expect(isInvitationValid(user)).toBe(false);
  });
  
  it('should return true if invitation is valid', () => {
    const user = createMockUser({ 
      status: UserStatus.PENDING_ACTIVATION,
      invitationToken: 'token',
      invitationExpiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(isInvitationValid(user)).toBe(true);
  });
});

describe('getUserOrganizationIds', () => {
  it('should return primary org and all role assignment orgs', () => {
    const user = createMockUser({
      primaryOrganizationId: asOrganizationId('org-1'),
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
          organizationId: asOrganizationId('org-2'),
          assignedAt: '2024-01-01T00:00:00Z',
          assignedBy: asUserId('admin-1'),
          expiresAt: null,
        },
      ],
    });
    
    const orgIds = getUserOrganizationIds(user);
    expect(orgIds).toHaveLength(2);
    expect(orgIds).toContain(asOrganizationId('org-1'));
    expect(orgIds).toContain(asOrganizationId('org-2'));
  });
});
