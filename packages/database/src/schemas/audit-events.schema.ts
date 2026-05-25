/**
 * Audit Events Schema - BORJIE Platform
 * 
 * Immutable audit log storage for compliance, security, and operational visibility.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

// Enums
export const auditCategoryEnum = pgEnum('audit_category', [
  'AUTH',
  'AUTHZ',
  'TENANT',
  'USER',
  'PROPERTY',
  'LEASE',
  'PAYMENT',
  'MAINTENANCE',
  'DOCUMENT',
  'COMMUNICATION',
  'SYSTEM',
  'DATA_ACCESS',
]);

export const auditOutcomeEnum = pgEnum('audit_outcome', [
  'SUCCESS',
  'FAILURE',
  'DENIED',
  'ERROR',
]);

export const auditSeverityEnum = pgEnum('audit_severity', [
  'INFO',
  'WARNING',
  'CRITICAL',
]);

export const auditActorTypeEnum = pgEnum('audit_actor_type', [
  'user',
  'service',
  'system',
]);

// Audit Events Table
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    timestampMs: integer('timestamp_ms').notNull(),
    
    category: auditCategoryEnum('category').notNull(),
    action: text('action').notNull(),
    description: text('description').notNull(),
    outcome: auditOutcomeEnum('outcome').notNull(),
    severity: auditSeverityEnum('severity').notNull().default('INFO'),
    
    actorType: auditActorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    actorName: text('actor_name'),
    actorEmail: text('actor_email'),
    actorRoles: jsonb('actor_roles').default([]),
    actorIpAddress: text('actor_ip_address'),
    actorUserAgent: text('actor_user_agent'),
    
    targets: jsonb('targets').default([]),
    
    traceId: text('trace_id'),
    spanId: text('span_id'),
    requestId: text('request_id'),
    sessionId: text('session_id'),
    sourceService: text('source_service'),
    httpMethod: text('http_method'),
    httpPath: text('http_path'),
    
    changes: jsonb('changes'),
    
    reason: text('reason'),
    metadata: jsonb('metadata').default({}),
    schemaVersion: text('schema_version').notNull().default('1.0.0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('audit_events_tenant_idx').on(table.tenantId),
    tenantTimestampIdx: index('audit_events_tenant_timestamp_idx').on(table.tenantId, table.timestampMs),
    timestampIdx: index('audit_events_timestamp_idx').on(table.timestampMs),
    actorIdx: index('audit_events_actor_idx').on(table.actorId),
    tenantActorIdx: index('audit_events_tenant_actor_idx').on(table.tenantId, table.actorId),
    categoryIdx: index('audit_events_category_idx').on(table.category),
    actionIdx: index('audit_events_action_idx').on(table.action),
    outcomeIdx: index('audit_events_outcome_idx').on(table.outcome),
    severityIdx: index('audit_events_severity_idx').on(table.severity),
    traceIdx: index('audit_events_trace_idx').on(table.traceId),
    requestIdx: index('audit_events_request_idx').on(table.requestId),
  })
);

// Relations
export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [auditEvents.tenantId],
    references: [tenants.id],
  }),
}));

// Type exports
export type AuditEventRecord = typeof auditEvents.$inferSelect;
export type NewAuditEventRecord = typeof auditEvents.$inferInsert;
