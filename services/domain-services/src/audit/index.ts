/**
 * Audit Logging Service
 * Records and queries audit trail for compliance and security.
 * Includes @Audited decorator, retention policies, and domain events.
 */

export type {
  AuditAction,
  AuditEntry,
  AuditChange,
  AuditQuery,
  PaginatedAuditResult,
  AuditStats,
  AuditSearchFilters,
  DateRange,
  RetentionPolicy,
  AuditContext,
} from './types.js';

export { AuditService } from './audit-service.js';
export type { AuditServiceOptions } from './audit-service.js';

export type { AuditRepository } from './audit-repository.interface.js';
export { MemoryAuditRepository } from './audit-repository.memory.js';

export {
  getAuditContext,
  setAuditContext,
  clearAuditContext,
  withAuditContext,
} from './audit-context.js';

export { Audited } from './audited.decorator.js';
export type { AuditedOptions } from './audited.decorator.js';

export type {
  SensitiveDataAccessedEvent,
  BulkExportPerformedEvent,
  SuspiciousActivityDetectedEvent,
  AuditEvent,
} from './events.js';
