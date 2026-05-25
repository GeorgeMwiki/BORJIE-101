/**
 * Integration test setup for API Gateway
 *
 * - Creates test app instance (Express with Hono routes)
 * - No authentication mocking needed - we use real login flow for auth tests
 *   and valid JWT tokens for protected routes
 * - App uses in-memory mock data (no database connection)
 * - Cleanup utilities for test isolation when needed
 */

import type { Express } from 'express';
import type { Agent } from 'supertest';
import request from 'supertest';
import app from '../index';
import { generateToken } from '../middleware/auth';
import { UserRole } from '../types/user-role';
import {
  DEMO_TENANT,
  DEMO_USERS,
  DEMO_TENANT_USERS,
} from './fixtures/demo-data';

const BASE_PATH = '/api/v1';

/** Test app instance - Express app with Hono routes mounted at /api/v1 */
export const testApp: Express = app;

/** Create supertest agent for the test app */
export function createTestAgent(): Agent {
  return request(testApp);
}

/** Get auth token for a demo user (tenant user) */
export function getAuthToken(
  userId: string = 'user-001',
  tenantId: string = 'tenant-001',
  role: UserRole = UserRole.TENANT_ADMIN
): string {
  const tenantUser = DEMO_TENANT_USERS.find(
    (tu) => tu.userId === userId && tu.tenantId === tenantId
  );
  const effectiveRole = tenantUser?.role ?? role;
  const permissions = tenantUser?.permissions ?? [];
  const propertyAccess = tenantUser?.propertyAccess ?? ['*'];

  return generateToken({
    userId,
    tenantId,
    role: effectiveRole,
    permissions: [...permissions, 'properties:*', 'leases:*', 'payments:*', 'work_orders:*'],
    propertyAccess,
  });
}

/** Get auth token for platform admin */
export function getPlatformAdminToken(): string {
  return generateToken({
    userId: 'admin-001',
    tenantId: 'platform',
    role: UserRole.ADMIN,
    permissions: ['*'],
    propertyAccess: ['*'],
  });
}

/** Get auth token for super admin */
export function getSuperAdminToken(): string {
  return generateToken({
    userId: 'admin-001',
    tenantId: 'platform',
    role: UserRole.SUPER_ADMIN,
    permissions: ['*'],
    propertyAccess: ['*'],
  });
}

/** Auth header for protected routes */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Demo user credentials for login tests */
export const DEMO_CREDENTIALS = {
  tenantAdmin: {
    email: 'admin@mwangaproperties.co.tz',
    password: 'demo123',
  },
  platformAdmin: {
    email: 'admin@borjie.com',
    password: 'demo123',
  },
  invalid: {
    email: 'nonexistent@example.com',
    password: 'wrong',
  },
};

/** Register payload for new user */
export function registerPayload(overrides?: Partial<{
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}>) {
  return {
    email: `test-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    firstName: 'Test',
    lastName: 'User',
    phone: '+255755000099',
    ...overrides,
  };
}

/**
 * Cleanup utilities
 * Note: App uses in-memory mock data. These utilities help reset state
 * when tests mutate shared arrays. For tests that only read, no cleanup needed.
 */
export const cleanup = {
  /** No-op for now - mock data is shared. Use unique IDs in tests to avoid conflicts. */
  reset: () => {
    // In production, you might reset DB or mock state here
  },
};

export { BASE_PATH };
