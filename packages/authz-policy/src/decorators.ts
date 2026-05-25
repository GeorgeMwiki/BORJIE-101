/**
 * Authorization decorators for use in services and controllers.
 */

import 'reflect-metadata';
import { Action, Resource, PolicyCondition } from './types.js';

// ============================================================================
// Decorator Metadata Types
// ============================================================================

export interface RequirePermissionOptions {
  resource: Resource;
  action: Action;
  conditions?: PolicyCondition[];
}

export interface RequireRoleOptions {
  roles: string[];
  mode: 'any' | 'all';
}

// ============================================================================
// Metadata Keys
// ============================================================================

export const PERMISSION_METADATA_KEY = Symbol('permission');
export const ROLE_METADATA_KEY = Symbol('role');
export const PUBLIC_METADATA_KEY = Symbol('public');

// ============================================================================
// Decorators
// ============================================================================

/**
 * Decorator to require a specific permission for a method.
 *
 * @example
 * ```typescript
 * @RequirePermission({ resource: 'property', action: 'create' })
 * async createProperty(input: CreatePropertyInput) {
 *   // ...
 * }
 * ```
 */
export function RequirePermission(options: RequirePermissionOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(PERMISSION_METADATA_KEY, options, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator to require specific roles for a method.
 *
 * @example
 * ```typescript
 * @RequireRole({ roles: ['admin', 'property_manager'], mode: 'any' })
 * async deleteProperty(propertyId: string) {
 *   // ...
 * }
 * ```
 */
export function RequireRole(options: RequireRoleOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(ROLE_METADATA_KEY, options, target, propertyKey);
    return descriptor;
  };
}

/**
 * Decorator to mark a method as publicly accessible (no auth required).
 *
 * @example
 * ```typescript
 * @Public()
 * async getPublicPropertyListings() {
 *   // ...
 * }
 * ```
 */
export function Public(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, target, propertyKey);
    return descriptor;
  };
}

// ============================================================================
// Metadata Readers
// ============================================================================

/**
 * Get permission metadata from a method.
 */
export function getPermissionMetadata(
  target: object,
  propertyKey: string | symbol
): RequirePermissionOptions | undefined {
  return Reflect.getMetadata(PERMISSION_METADATA_KEY, target, propertyKey);
}

/**
 * Get role metadata from a method.
 */
export function getRoleMetadata(
  target: object,
  propertyKey: string | symbol
): RequireRoleOptions | undefined {
  return Reflect.getMetadata(ROLE_METADATA_KEY, target, propertyKey);
}

/**
 * Check if a method is marked as public.
 */
export function isPublicMethod(target: object, propertyKey: string | symbol): boolean {
  return Reflect.getMetadata(PUBLIC_METADATA_KEY, target, propertyKey) === true;
}
