/**
 * Audit Logger - BORJIE Platform
 * 
 * Simplified audit logging interface with immutable storage support.
 * Provides both a simple function API and the full fluent builder API.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AuditEvent,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
  AuditActor,
  AuditTarget,
  AuditTenantContext,
  AuditRequestContext,
  AuditChangeRecord,
} from './types/audit.types.js';
import { AuditSeverity as AuditSeverityEnum } from './types/audit.types.js';
import { AuditLogger, AuditEventBuilder } from './audit/audit-logger.js';
import type { IAuditStore } from './audit/audit-store.interface.js';

// ============================================================================
// Types
// ============================================================================

/**
 * User context for audit logging
 */
export interface AuditUser {
  id: string;
  name?: string;
  email?: string;
  roles?: string[];
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Resource being acted upon
 */
export interface AuditResource {
  type: string;
  id: string;
  name?: string;
  identifiers?: Record<string, string>;
}

/**
 * Details of the audit event
 */
export interface AuditDetails {
  category?: AuditCategory;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  description?: string;
  reason?: string;
  changes?: AuditChangeRecord[];
  metadata?: Record<string, unknown>;
  tenant?: AuditTenantContext;
  request?: AuditRequestContext;
}

/**
 * Configuration for the audit logger
 */
export interface SimpleAuditLoggerConfig {
  store: IAuditStore;
  defaultTenant?: AuditTenantContext;
  serviceName?: string;
  onError?: (error: Error, event: Partial<AuditEvent>) => void;
}

// ============================================================================
// Simple Audit Logger
// ============================================================================

let auditLoggerInstance: AuditLogger | null = null;
let simpleConfig: SimpleAuditLoggerConfig | null = null;

/**
 * Initialize the audit logger
 */
export function initAuditLogger(config: SimpleAuditLoggerConfig): void {
  simpleConfig = config;
  auditLoggerInstance = new AuditLogger({
    store: config.store,
    onError: config.onError,
  });
}

/**
 * Get the audit logger instance
 */
export function getAuditLogger(): AuditLogger {
  if (!auditLoggerInstance) {
    throw new Error('Audit logger not initialized. Call initAuditLogger first.');
  }
  return auditLoggerInstance;
}

/**
 * Log an audit event with a simple function call
 * 
 * @param user - The user performing the action
 * @param action - The action being performed (e.g., 'CREATE', 'UPDATE', 'DELETE', 'VIEW')
 * @param resource - The resource being acted upon
 * @param details - Optional additional details
 * @returns The created audit event
 * 
 * @example
 * ```typescript
 * await logAuditEvent(
 *   { id: 'user-123', name: '<user>', email: '<user@example.com>' },
 *   'UPDATE',
 *   { type: 'Property', id: 'prop-456', name: '<Property Name>' },
 *   {
 *     category: 'PROPERTY',
 *     outcome: 'SUCCESS',
 *     description: 'Updated property details',
 *     changes: [{ field: 'name', previousValue: '<Old Name>', newValue: '<New Name>' }],
 *   }
 * );
 * ```
 */
export async function logAuditEvent(
  user: AuditUser,
  action: string,
  resource: AuditResource,
  details?: AuditDetails
): Promise<AuditEvent> {
  const logger = getAuditLogger();

  const category = details?.category || inferCategory(resource.type);
  const description = details?.description || `${action} ${resource.type} ${resource.name || resource.id}`;
  const outcome = details?.outcome || 'SUCCESS';
  const severity = details?.severity || AuditSeverityEnum.INFO;

  const builder = logger
    .event(category, action)
    .describe(description)
    .outcome(outcome)
    .severity(severity)
    .byUser(user.id, user.name, user.email, user.roles)
    .on(resource.type, resource.id, resource.name);

  // Add IP and user agent if available
  if (user.ipAddress) {
    builder.fromIP(user.ipAddress);
  }
  if (user.userAgent) {
    builder.withUserAgent(user.userAgent);
  }

  // Add tenant context
  if (details?.tenant) {
    builder.tenant(details.tenant);
  } else if (simpleConfig?.defaultTenant) {
    builder.tenant(simpleConfig.defaultTenant);
  }

  // Add request context
  if (details?.request) {
    builder.request(details.request);
  }

  // Add changes
  if (details?.changes) {
    builder.changes(details.changes);
  }

  // Add reason
  if (details?.reason) {
    builder.because(details.reason);
  }

  // Add metadata
  if (details?.metadata) {
    builder.metadata(details.metadata);
  }

  return builder.record();
}

/**
 * Log a successful audit event
 */
export async function logAuditSuccess(
  user: AuditUser,
  action: string,
  resource: AuditResource,
  details?: Omit<AuditDetails, 'outcome'>
): Promise<AuditEvent> {
  return logAuditEvent(user, action, resource, { ...details, outcome: 'SUCCESS' });
}

/**
 * Log a failed audit event
 */
export async function logAuditFailure(
  user: AuditUser,
  action: string,
  resource: AuditResource,
  reason: string,
  details?: Omit<AuditDetails, 'outcome' | 'reason'>
): Promise<AuditEvent> {
  return logAuditEvent(user, action, resource, {
    ...details,
    outcome: 'FAILURE',
    reason,
    severity: AuditSeverityEnum.WARNING,
  });
}

/**
 * Log an access denied audit event
 */
export async function logAuditDenied(
  user: AuditUser,
  action: string,
  resource: AuditResource,
  reason: string,
  details?: Omit<AuditDetails, 'outcome' | 'reason'>
): Promise<AuditEvent> {
  return logAuditEvent(user, action, resource, {
    ...details,
    outcome: 'DENIED',
    reason,
    severity: AuditSeverityEnum.WARNING,
  });
}

/**
 * Log a system audit event (no user actor)
 */
export async function logSystemAuditEvent(
  action: string,
  resource: AuditResource,
  details?: AuditDetails
): Promise<AuditEvent> {
  const logger = getAuditLogger();

  const category = details?.category || inferCategory(resource.type);
  const description = details?.description || `System ${action} ${resource.type} ${resource.name || resource.id}`;
  const outcome = details?.outcome || 'SUCCESS';
  const severity = details?.severity || AuditSeverityEnum.INFO;

  const builder = logger
    .event(category, action)
    .describe(description)
    .outcome(outcome)
    .severity(severity)
    .bySystem()
    .on(resource.type, resource.id, resource.name);

  if (details?.tenant) {
    builder.tenant(details.tenant);
  } else if (simpleConfig?.defaultTenant) {
    builder.tenant(simpleConfig.defaultTenant);
  }

  if (details?.request) {
    builder.request(details.request);
  }

  if (details?.changes) {
    builder.changes(details.changes);
  }

  if (details?.reason) {
    builder.because(details.reason);
  }

  if (details?.metadata) {
    builder.metadata(details.metadata);
  }

  return builder.record();
}

/**
 * Log a service-to-service audit event
 */
export async function logServiceAuditEvent(
  serviceName: string,
  action: string,
  resource: AuditResource,
  details?: AuditDetails
): Promise<AuditEvent> {
  const logger = getAuditLogger();

  const category = details?.category || inferCategory(resource.type);
  const description = details?.description || `Service ${serviceName} ${action} ${resource.type}`;
  const outcome = details?.outcome || 'SUCCESS';
  const severity = details?.severity || AuditSeverityEnum.INFO;

  const builder = logger
    .event(category, action)
    .describe(description)
    .outcome(outcome)
    .severity(severity)
    .byService(serviceName)
    .on(resource.type, resource.id, resource.name);

  if (details?.tenant) {
    builder.tenant(details.tenant);
  } else if (simpleConfig?.defaultTenant) {
    builder.tenant(simpleConfig.defaultTenant);
  }

  if (details?.request) {
    builder.request(details.request);
  }

  if (details?.metadata) {
    builder.metadata(details.metadata);
  }

  return builder.record();
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Infer audit category from resource type
 */
function inferCategory(resourceType: string): AuditCategory {
  const categoryMap: Record<string, AuditCategory> = {
    User: 'USER',
    Property: 'PROPERTY',
    Unit: 'PROPERTY',
    Lease: 'LEASE',
    Payment: 'PAYMENT',
    Invoice: 'PAYMENT',
    Transaction: 'PAYMENT',
    MaintenanceRequest: 'MAINTENANCE',
    WorkOrder: 'MAINTENANCE',
    Document: 'DOCUMENT',
    Message: 'COMMUNICATION',
    Notification: 'COMMUNICATION',
    Tenant: 'TENANT',
    Organization: 'TENANT',
    Session: 'AUTH',
    Token: 'AUTH',
    Role: 'AUTHZ',
    Permission: 'AUTHZ',
  };

  return categoryMap[resourceType] || 'SYSTEM';
}

// ============================================================================
// Re-exports
// ============================================================================

export { AuditLogger, AuditEventBuilder };
export type { AuditLoggerConfig } from './audit/audit-logger.js';
