/**
 * Audit Service
 * 
 * Service for recording and querying audit events.
 */

import type {
  TenantId,
  UserId,
  SessionId,
  AuditEventId,
  OrganizationId,
  PaginationParams,
  PaginatedResult,
} from '@borjie/domain-models';
import {
  type AuditEvent,
  type CreateAuditEventInput,
  type AuditEventFilters,
  type AuditActor,
  type AuditTarget,
  type AuditChange,
  type AuditError,
  AuditCategory,
  AuditSeverity,
  AuditOutcome,
  AuditEventType,
  getCategoryForEventType,
  getDefaultSeverityForEventType,
  buildAuditDescription,
  asAuditEventId,
} from '@borjie/domain-models';
import type { AuditEventRepository, UnitOfWork } from '../common/repository.js';

/** Audit service for recording and querying audit events */
export class AuditService {
  private readonly uow: UnitOfWork;
  
  constructor(uow: UnitOfWork) {
    this.uow = uow;
  }
  
  /**
   * Record an audit event.
   */
  async recordEvent(input: CreateAuditEventInput): Promise<AuditEvent> {
    return this.uow.auditEvents.create(input);
  }
  
  /**
   * Record an authentication event.
   */
  async recordAuthEvent(
    tenantId: TenantId,
    eventType: AuditEventType,
    outcome: AuditOutcome,
    actor: AuditActor,
    correlationId: string,
    metadata?: Record<string, unknown>,
    error?: AuditError
  ): Promise<AuditEvent> {
    const input: CreateAuditEventInput = {
      tenantId,
      category: getCategoryForEventType(eventType),
      eventType,
      severity: getDefaultSeverityForEventType(eventType, outcome),
      outcome,
      actor,
      description: buildAuditDescription(eventType, actor, null, outcome),
      correlationId,
      metadata: metadata ?? {},
      error,
    };
    
    return this.recordEvent(input);
  }
  
  /**
   * Record a user management event.
   */
  async recordUserEvent(
    tenantId: TenantId,
    eventType: AuditEventType,
    outcome: AuditOutcome,
    actor: AuditActor,
    target: AuditTarget,
    correlationId: string,
    changes?: readonly AuditChange[],
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent> {
    const input: CreateAuditEventInput = {
      tenantId,
      category: getCategoryForEventType(eventType),
      eventType,
      severity: getDefaultSeverityForEventType(eventType, outcome),
      outcome,
      actor,
      target,
      changes: changes ?? [],
      description: buildAuditDescription(eventType, actor, target, outcome),
      correlationId,
      metadata: metadata ?? {},
    };
    
    return this.recordEvent(input);
  }
  
  /**
   * Record an authorization event.
   */
  async recordAuthzEvent(
    tenantId: TenantId,
    outcome: AuditOutcome,
    actor: AuditActor,
    target: AuditTarget,
    action: string,
    correlationId: string,
    reason: string,
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent> {
    const eventType = outcome === AuditOutcome.SUCCESS
      ? AuditEventType.ACCESS_GRANTED
      : AuditEventType.ACCESS_DENIED;
    
    const input: CreateAuditEventInput = {
      tenantId,
      category: AuditCategory.AUTHORIZATION,
      eventType,
      severity: getDefaultSeverityForEventType(eventType, outcome),
      outcome,
      actor,
      target,
      description: `${actor.userEmail ?? 'Unknown'} ${outcome === AuditOutcome.SUCCESS ? 'granted' : 'denied'} ${action} access to ${target.type} ${target.id}: ${reason}`,
      correlationId,
      metadata: {
        ...metadata,
        action,
        reason,
      },
    };
    
    return this.recordEvent(input);
  }
  
  /**
   * Record a security event.
   */
  async recordSecurityEvent(
    tenantId: TenantId,
    eventType: AuditEventType,
    severity: AuditSeverity,
    actor: AuditActor,
    description: string,
    correlationId: string,
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent> {
    const input: CreateAuditEventInput = {
      tenantId,
      category: AuditCategory.SECURITY,
      eventType,
      severity,
      outcome: AuditOutcome.SUCCESS,
      actor,
      description,
      correlationId,
      metadata: metadata ?? {},
    };
    
    return this.recordEvent(input);
  }
  
  /**
   * Get an audit event by ID.
   */
  async getEvent(eventId: AuditEventId): Promise<AuditEvent | null> {
    // nosemgrep: missing-tenant-id-arg reason: audit events are looked up by globally-unique event ID; tenant-scoping happens in the repo via RLS GUC (app.current_tenant_id).
    return this.uow.auditEvents.findById(eventId);
  }
  
  /**
   * Query audit events with filters.
   */
  async queryEvents(
    filters: AuditEventFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<AuditEvent>> {
    return this.uow.auditEvents.findMany(filters, pagination);
  }
  
  /**
   * Count audit events matching filters.
   */
  async countEvents(filters: AuditEventFilters): Promise<number> {
    return this.uow.auditEvents.countByFilters(filters);
  }
  
  /**
   * Get recent events for a user.
   */
  async getRecentUserEvents(
    userId: UserId,
    tenantId: TenantId,
    limit = 50
  ): Promise<PaginatedResult<AuditEvent>> {
    return this.queryEvents(
      { tenantId, actorUserId: userId },
      { limit, offset: 0 }
    );
  }
  
  /**
   * Get authentication events for a user.
   */
  async getAuthenticationHistory(
    userId: UserId,
    tenantId: TenantId,
    limit = 20
  ): Promise<PaginatedResult<AuditEvent>> {
    return this.queryEvents(
      {
        tenantId,
        actorUserId: userId,
        categories: [AuditCategory.AUTHENTICATION],
      },
      { limit, offset: 0 }
    );
  }
  
  /**
   * Get security alerts.
   */
  async getSecurityAlerts(
    tenantId: TenantId,
    limit = 100
  ): Promise<PaginatedResult<AuditEvent>> {
    return this.queryEvents(
      {
        tenantId,
        categories: [AuditCategory.SECURITY],
        severities: [AuditSeverity.WARNING, AuditSeverity.ERROR, AuditSeverity.CRITICAL],
      },
      { limit, offset: 0 }
    );
  }
  
  /**
   * Delete old audit events (for retention policy).
   */
  async deleteOldEvents(olderThan: string): Promise<number> {
    return this.uow.auditEvents.deleteOlderThan(olderThan);
  }
}

/**
 * Create an audit actor from request context.
 */
export function createAuditActor(options: {
  userId?: UserId | null;
  userEmail?: string | null;
  userType?: string | null;
  sessionId?: SessionId | null;
  ipAddress: string;
  userAgent: string;
  impersonatorId?: UserId | null;
  serviceAccountId?: string | null;
}): AuditActor {
  return {
    userId: options.userId ?? null,
    userEmail: options.userEmail ?? null,
    userType: options.userType ?? null,
    sessionId: options.sessionId ?? null,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    impersonatorId: options.impersonatorId ?? null,
    serviceAccountId: options.serviceAccountId ?? null,
  };
}

/**
 * Create an audit target from entity.
 */
export function createAuditTarget(
  type: string,
  id: string,
  name?: string | null,
  organizationId?: string | null,
  metadata?: Record<string, unknown>
): AuditTarget {
  return {
    type,
    id,
    name: name ?? null,
    organizationId: (organizationId as OrganizationId | null | undefined) ?? null,
    metadata: metadata ?? {},
  };
}

/**
 * Create audit changes from before/after objects.
 */
export function createAuditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: readonly string[]
): AuditChange[] {
  const changes: AuditChange[] = [];
  const fieldsToCheck = fields ?? Object.keys(after);
  
  for (const field of fieldsToCheck) {
    const oldValue = before[field];
    const newValue = after[field];
    
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({
        field,
        oldValue,
        newValue,
      });
    }
  }
  
  return changes;
}
