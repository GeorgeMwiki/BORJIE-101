/**
 * Audit module exports
 */

export type {
  AuditEvent,
  AuditActor,
  AuditTarget,
  AuditTenantContext,
  AuditRequestContext,
  AuditChangeRecord,
  CreateAuditEventOptions,
  AuditQueryOptions,
  AuditQueryResult,
} from '../types/audit.types.js';

export {
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
} from '../types/audit.types.js';

export type {
  IAuditStore,
  AuditStoreConfig,
} from './audit-store.interface.js';

export { DEFAULT_AUDIT_STORE_CONFIG } from './audit-store.interface.js';

export { MemoryAuditStore } from './memory-audit-store.js';

export type { AuditLoggerConfig } from './audit-logger.js';

export { AuditLogger, AuditEventBuilder } from './audit-logger.js';
