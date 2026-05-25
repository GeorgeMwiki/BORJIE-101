/**
 * Cross-tenant denial audit table — Drizzle schema.
 *
 * Phase D agent D9 — G4 closure.
 *
 * Append-only audit log fed by `assertTenantScope()` / `validateTenantScope()`
 * in `packages/ai-copilot/src/security/tenant-isolation.ts`. Every detected
 * cross-tenant breach inside an AI call produces one row per violation, with
 * verdict='blocked' (when the call was refused) or 'detected' (soft scan).
 *
 * Backing migration: 0153_cross_tenant_denials.sql.
 */

import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';

export const crossTenantDenials = pgTable(
  'cross_tenant_denials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    callerTenantId: text('caller_tenant_id').notNull(),
    foreignTenantId: text('foreign_tenant_id'),
    actorId: text('actor_id'),
    personaId: text('persona_id'),
    sessionId: text('session_id'),
    violationPath: text('violation_path').notNull(),
    violationType: text('violation_type').notNull(),
    severity: text('severity').notNull(),
    detail: text('detail').notNull(),
    verdict: text('verdict').notNull(),
    surface: text('surface'),
    traceId: text('trace_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    callerIdx: index('idx_cross_tenant_denials_caller').on(
      table.callerTenantId,
      table.occurredAt,
    ),
    severityIdx: index('idx_cross_tenant_denials_severity').on(
      table.severity,
      table.occurredAt,
    ),
    verdictIdx: index('idx_cross_tenant_denials_verdict').on(
      table.verdict,
      table.occurredAt,
    ),
    traceIdx: index('idx_cross_tenant_denials_trace').on(table.traceId),
  }),
);

export type CrossTenantDenialRow = typeof crossTenantDenials.$inferSelect;
export type NewCrossTenantDenialRow = typeof crossTenantDenials.$inferInsert;
