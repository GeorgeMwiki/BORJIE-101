/**
 * Audit Event Domain Model
 * 
 * Immutable audit log entries for compliance, security, and debugging.
 * All significant actions in the system generate audit events.
 */

import type {
  TenantId,
  OrganizationId,
  UserId,
  SessionId,
  AuditEventId,
  TenantScoped,
  ISOTimestamp,
} from '../common/types.js';

/** Audit event category */
export const AuditCategory = {
  /** Authentication events */
  AUTHENTICATION: 'AUTHENTICATION',
  /** Authorization/access control events */
  AUTHORIZATION: 'AUTHORIZATION',
  /** User management events */
  USER_MANAGEMENT: 'USER_MANAGEMENT',
  /** Role/permission changes */
  ROLE_MANAGEMENT: 'ROLE_MANAGEMENT',
  /** Policy changes */
  POLICY_MANAGEMENT: 'POLICY_MANAGEMENT',
  /** Tenant/org administration */
  TENANT_ADMINISTRATION: 'TENANT_ADMINISTRATION',
  /** Data access events */
  DATA_ACCESS: 'DATA_ACCESS',
  /** Data modification events */
  DATA_MODIFICATION: 'DATA_MODIFICATION',
  /** System configuration changes */
  SYSTEM_CONFIGURATION: 'SYSTEM_CONFIGURATION',
  /** Security events */
  SECURITY: 'SECURITY',
} as const;

export type AuditCategory = (typeof AuditCategory)[keyof typeof AuditCategory];

/** Audit event severity */
export const AuditSeverity = {
  /** Informational */
  INFO: 'INFO',
  /** Warning - potential issue */
  WARNING: 'WARNING',
  /** Error - something went wrong */
  ERROR: 'ERROR',
  /** Critical - security incident */
  CRITICAL: 'CRITICAL',
} as const;

export type AuditSeverity = (typeof AuditSeverity)[keyof typeof AuditSeverity];

/** Audit event outcome */
export const AuditOutcome = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  DENIED: 'DENIED',
  ERROR: 'ERROR',
} as const;

export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome];

/** Specific audit event types */
export const AuditEventType = {
  // Authentication events
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  MFA_CHALLENGE_SENT: 'MFA_CHALLENGE_SENT',
  MFA_VERIFIED: 'MFA_VERIFIED',
  MFA_FAILED: 'MFA_FAILED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  IMPERSONATION_STARTED: 'IMPERSONATION_STARTED',
  IMPERSONATION_ENDED: 'IMPERSONATION_ENDED',
  
  // Authorization events
  ACCESS_GRANTED: 'ACCESS_GRANTED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  PERMISSION_CHECK: 'PERMISSION_CHECK',
  
  // User management
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_INVITED: 'USER_INVITED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_LOCKED: 'USER_LOCKED',
  USER_UNLOCKED: 'USER_UNLOCKED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_DISABLED: 'MFA_DISABLED',
  
  // Role management
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_DELETED: 'ROLE_DELETED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  ROLE_UNASSIGNED: 'ROLE_UNASSIGNED',
  
  // Policy management
  POLICY_CREATED: 'POLICY_CREATED',
  POLICY_UPDATED: 'POLICY_UPDATED',
  POLICY_DELETED: 'POLICY_DELETED',
  POLICY_ENABLED: 'POLICY_ENABLED',
  POLICY_DISABLED: 'POLICY_DISABLED',
  
  // Tenant administration
  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_UPDATED: 'TENANT_UPDATED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_ACTIVATED: 'TENANT_ACTIVATED',
  ORGANIZATION_CREATED: 'ORGANIZATION_CREATED',
  ORGANIZATION_UPDATED: 'ORGANIZATION_UPDATED',
  ORGANIZATION_DELETED: 'ORGANIZATION_DELETED',
  
  // Security events
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  BRUTE_FORCE_DETECTED: 'BRUTE_FORCE_DETECTED',
  ACCOUNT_LOCKOUT: 'ACCOUNT_LOCKOUT',
  API_KEY_CREATED: 'API_KEY_CREATED',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  SECURITY_SETTING_CHANGED: 'SECURITY_SETTING_CHANGED',
} as const;

export type AuditEventType = (typeof AuditEventType)[keyof typeof AuditEventType];

/** Actor information - who performed the action */
export interface AuditActor {
  readonly userId: UserId | null;
  readonly userEmail: string | null;
  readonly userType: string | null;
  readonly sessionId: SessionId | null;
  readonly ipAddress: string;
  readonly userAgent: string;
  /** If action was performed via impersonation */
  readonly impersonatorId: UserId | null;
  /** Service account or API key identifier */
  readonly serviceAccountId: string | null;
}

/** Target information - what was affected */
export interface AuditTarget {
  /** Type of the target resource */
  readonly type: string;
  /** ID of the target resource */
  readonly id: string;
  /** Display name for the target */
  readonly name: string | null;
  /** Organization context */
  readonly organizationId: OrganizationId | null;
  /** Additional target metadata */
  readonly metadata: Record<string, unknown>;
}

/** Change information for modification events */
export interface AuditChange {
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

/** Core Audit Event entity (immutable) */
export interface AuditEvent extends TenantScoped {
  readonly id: AuditEventId;
  /** Event timestamp */
  readonly timestamp: ISOTimestamp;
  /** Event category */
  readonly category: AuditCategory;
  /** Specific event type */
  readonly eventType: AuditEventType;
  /** Event severity */
  readonly severity: AuditSeverity;
  /** Event outcome */
  readonly outcome: AuditOutcome;
  /** Actor who performed the action */
  readonly actor: AuditActor;
  /** Target of the action (if applicable) */
  readonly target: AuditTarget | null;
  /** List of changes (for modification events) */
  readonly changes: readonly AuditChange[];
  /** Human-readable description */
  readonly description: string;
  /** Request correlation ID */
  readonly correlationId: string;
  /** Parent event ID (for related events) */
  readonly parentEventId: AuditEventId | null;
  /** Additional context data */
  readonly metadata: Record<string, unknown>;
  /** Error details (if outcome is error) */
  readonly error: AuditError | null;
}

/** Error details for failed events */
export interface AuditError {
  readonly code: string;
  readonly message: string;
  readonly stack: string | null;
}

/** Input for creating an audit event */
export interface CreateAuditEventInput {
  readonly tenantId: TenantId;
  readonly category: AuditCategory;
  readonly eventType: AuditEventType;
  readonly severity?: AuditSeverity;
  readonly outcome: AuditOutcome;
  readonly actor: AuditActor;
  readonly target?: AuditTarget;
  readonly changes?: readonly AuditChange[];
  readonly description: string;
  readonly correlationId: string;
  readonly parentEventId?: AuditEventId;
  readonly metadata?: Record<string, unknown>;
  readonly error?: AuditError;
}

/** Audit event query filters */
export interface AuditEventFilters {
  readonly tenantId?: TenantId;
  readonly startTime?: ISOTimestamp;
  readonly endTime?: ISOTimestamp;
  readonly categories?: readonly AuditCategory[];
  readonly eventTypes?: readonly AuditEventType[];
  readonly severities?: readonly AuditSeverity[];
  readonly outcomes?: readonly AuditOutcome[];
  readonly actorUserId?: UserId;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly organizationId?: OrganizationId;
  readonly correlationId?: string;
  readonly search?: string;
}

/** Get the category for an event type */
export function getCategoryForEventType(eventType: AuditEventType): AuditCategory {
  const categoryMap: Record<string, AuditCategory> = {
    // Authentication
    LOGIN_SUCCESS: AuditCategory.AUTHENTICATION,
    LOGIN_FAILURE: AuditCategory.AUTHENTICATION,
    LOGOUT: AuditCategory.AUTHENTICATION,
    MFA_CHALLENGE_SENT: AuditCategory.AUTHENTICATION,
    MFA_VERIFIED: AuditCategory.AUTHENTICATION,
    MFA_FAILED: AuditCategory.AUTHENTICATION,
    PASSWORD_RESET_REQUESTED: AuditCategory.AUTHENTICATION,
    PASSWORD_RESET_COMPLETED: AuditCategory.AUTHENTICATION,
    PASSWORD_CHANGED: AuditCategory.AUTHENTICATION,
    SESSION_CREATED: AuditCategory.AUTHENTICATION,
    SESSION_REVOKED: AuditCategory.AUTHENTICATION,
    SESSION_EXPIRED: AuditCategory.AUTHENTICATION,
    TOKEN_REFRESHED: AuditCategory.AUTHENTICATION,
    IMPERSONATION_STARTED: AuditCategory.AUTHENTICATION,
    IMPERSONATION_ENDED: AuditCategory.AUTHENTICATION,
    
    // Authorization
    ACCESS_GRANTED: AuditCategory.AUTHORIZATION,
    ACCESS_DENIED: AuditCategory.AUTHORIZATION,
    PERMISSION_CHECK: AuditCategory.AUTHORIZATION,
    
    // User management
    USER_CREATED: AuditCategory.USER_MANAGEMENT,
    USER_UPDATED: AuditCategory.USER_MANAGEMENT,
    USER_DELETED: AuditCategory.USER_MANAGEMENT,
    USER_INVITED: AuditCategory.USER_MANAGEMENT,
    USER_ACTIVATED: AuditCategory.USER_MANAGEMENT,
    USER_SUSPENDED: AuditCategory.USER_MANAGEMENT,
    USER_LOCKED: AuditCategory.USER_MANAGEMENT,
    USER_UNLOCKED: AuditCategory.USER_MANAGEMENT,
    MFA_ENABLED: AuditCategory.USER_MANAGEMENT,
    MFA_DISABLED: AuditCategory.USER_MANAGEMENT,
    
    // Role management
    ROLE_CREATED: AuditCategory.ROLE_MANAGEMENT,
    ROLE_UPDATED: AuditCategory.ROLE_MANAGEMENT,
    ROLE_DELETED: AuditCategory.ROLE_MANAGEMENT,
    ROLE_ASSIGNED: AuditCategory.ROLE_MANAGEMENT,
    ROLE_UNASSIGNED: AuditCategory.ROLE_MANAGEMENT,
    
    // Policy management
    POLICY_CREATED: AuditCategory.POLICY_MANAGEMENT,
    POLICY_UPDATED: AuditCategory.POLICY_MANAGEMENT,
    POLICY_DELETED: AuditCategory.POLICY_MANAGEMENT,
    POLICY_ENABLED: AuditCategory.POLICY_MANAGEMENT,
    POLICY_DISABLED: AuditCategory.POLICY_MANAGEMENT,
    
    // Tenant administration
    TENANT_CREATED: AuditCategory.TENANT_ADMINISTRATION,
    TENANT_UPDATED: AuditCategory.TENANT_ADMINISTRATION,
    TENANT_SUSPENDED: AuditCategory.TENANT_ADMINISTRATION,
    TENANT_ACTIVATED: AuditCategory.TENANT_ADMINISTRATION,
    ORGANIZATION_CREATED: AuditCategory.TENANT_ADMINISTRATION,
    ORGANIZATION_UPDATED: AuditCategory.TENANT_ADMINISTRATION,
    ORGANIZATION_DELETED: AuditCategory.TENANT_ADMINISTRATION,
    
    // Security
    SUSPICIOUS_ACTIVITY: AuditCategory.SECURITY,
    BRUTE_FORCE_DETECTED: AuditCategory.SECURITY,
    ACCOUNT_LOCKOUT: AuditCategory.SECURITY,
    API_KEY_CREATED: AuditCategory.SECURITY,
    API_KEY_REVOKED: AuditCategory.SECURITY,
    SECURITY_SETTING_CHANGED: AuditCategory.SECURITY,
  };
  
  return categoryMap[eventType] ?? AuditCategory.DATA_ACCESS;
}

/** Get default severity for an event type */
export function getDefaultSeverityForEventType(
  eventType: AuditEventType,
  outcome: AuditOutcome
): AuditSeverity {
  // Security events are always elevated
  if (
    eventType === AuditEventType.SUSPICIOUS_ACTIVITY ||
    eventType === AuditEventType.BRUTE_FORCE_DETECTED
  ) {
    return AuditSeverity.CRITICAL;
  }
  
  if (eventType === AuditEventType.ACCOUNT_LOCKOUT) {
    return AuditSeverity.WARNING;
  }
  
  // Failed authentication is a warning
  if (
    outcome === AuditOutcome.FAILURE &&
    (eventType === AuditEventType.LOGIN_FAILURE || eventType === AuditEventType.MFA_FAILED)
  ) {
    return AuditSeverity.WARNING;
  }
  
  // Access denied is informational (normal operation)
  if (outcome === AuditOutcome.DENIED) {
    return AuditSeverity.INFO;
  }
  
  // Errors are warnings
  if (outcome === AuditOutcome.ERROR) {
    return AuditSeverity.ERROR;
  }
  
  return AuditSeverity.INFO;
}

/** Build audit event description */
export function buildAuditDescription(
  eventType: AuditEventType,
  actor: AuditActor,
  target: AuditTarget | null,
  outcome: AuditOutcome
): string {
  const actorName = actor.userEmail ?? actor.serviceAccountId ?? 'Unknown';
  const targetDesc = target ? `${target.type} "${target.name ?? target.id}"` : '';
  const outcomeText = outcome === AuditOutcome.SUCCESS ? '' : ` (${outcome.toLowerCase()})`;
  
  const descriptions: Record<string, string> = {
    LOGIN_SUCCESS: `${actorName} logged in successfully`,
    LOGIN_FAILURE: `Login attempt failed for ${actorName}`,
    LOGOUT: `${actorName} logged out`,
    USER_CREATED: `${actorName} created user ${targetDesc}`,
    USER_UPDATED: `${actorName} updated user ${targetDesc}`,
    USER_DELETED: `${actorName} deleted user ${targetDesc}`,
    ROLE_ASSIGNED: `${actorName} assigned role to ${targetDesc}`,
    ACCESS_DENIED: `Access denied for ${actorName} to ${targetDesc}`,
  };
  
  return (descriptions[eventType] ?? `${actorName} performed ${eventType} on ${targetDesc}`) + outcomeText;
}

/** Audit log retention policy */
export const AUDIT_RETENTION = {
  /** Default retention period in days */
  DEFAULT_RETENTION_DAYS: 365,
  /** Minimum retention for compliance */
  MIN_RETENTION_DAYS: 90,
  /** Maximum retention (7 years for financial compliance) */
  MAX_RETENTION_DAYS: 2555,
  /** Critical security events retention */
  SECURITY_RETENTION_DAYS: 2555,
} as const;
