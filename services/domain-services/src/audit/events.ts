/**
 * Audit Domain Events
 * Published when significant audit-related events occur
 */

/** Base structure for audit events */
interface AuditEventBase {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly metadata: Record<string, unknown>;
}

/** Triggered when sensitive data is accessed */
export interface SensitiveDataAccessedEvent extends AuditEventBase {
  readonly eventType: 'SensitiveDataAccessed';
  readonly payload: {
    readonly userId: string;
    readonly userEmail: string;
    readonly dataType: string;
    readonly entityId: string | null;
    readonly ipAddress: string;
    readonly userAgent: string;
    readonly accessReason?: string;
  };
}

/** Triggered when a bulk export is performed */
export interface BulkExportPerformedEvent extends AuditEventBase {
  readonly eventType: 'BulkExportPerformed';
  readonly payload: {
    readonly userId: string;
    readonly userEmail: string;
    readonly exportType: string;
    readonly recordCount: number;
    readonly format: 'csv' | 'json';
    readonly dateRange?: { from: string; to: string };
    readonly ipAddress: string;
    readonly userAgent: string;
  };
}

/** Triggered when suspicious activity is detected */
export interface SuspiciousActivityDetectedEvent extends AuditEventBase {
  readonly eventType: 'SuspiciousActivityDetected';
  readonly payload: {
    readonly userId: string | null;
    readonly userEmail: string | null;
    readonly activityType: string;
    readonly severity: 'low' | 'medium' | 'high' | 'critical';
    readonly description: string;
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
    readonly details: Record<string, unknown>;
  };
}

export type AuditEvent =
  | SensitiveDataAccessedEvent
  | BulkExportPerformedEvent
  | SuspiciousActivityDetectedEvent;
