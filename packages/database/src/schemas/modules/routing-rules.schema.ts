/**
 * routing_rules (migration 0219) — Piece B routing matrix.
 *
 * The dispatcher reads (entity_type, intent) → (module_template_id, action).
 * Platform defaults are tenant_id NULL (seeded by 0221); tenants override
 * with non-NULL rows. Resolution rule: tenant override beats platform
 * default; within same tenant scope, higher `priority` wins.
 *
 * RLS:
 *   - SELECT: tenant_id IS NULL OR tenant_id = current_app_tenant_id()
 *   - INSERT/UPDATE/DELETE: tenant_id = current_app_tenant_id()
 */

import {
  pgTable,
  text,
  smallint,
  boolean,
  numeric,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from '../tenant.schema.js';
import { moduleTemplates } from './module-templates.schema.js';

export const routingRules = pgTable(
  'routing_rules',
  {
    id: text('id').primaryKey(),
    /** NULL = platform default. */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    entityType: text('entity_type').notNull(),
    intent: text('intent').notNull(),
    moduleTemplateId: text('module_template_id')
      .notNull()
      .references(() => moduleTemplates.slug, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    payloadTemplate: jsonb('payload_template').$type<Record<string, unknown>>(),
    minConfidence: numeric('min_confidence', { precision: 3, scale: 2 })
      .notNull()
      .default('0.78'),
    hitlRequired: boolean('hitl_required').notNull().default(true),
    priority: smallint('priority').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    matchIdx: index('routing_rules_match_idx').on(
      t.entityType,
      t.intent,
      t.priority,
    ),
    tenantIdx: index('routing_rules_tenant_idx').on(t.tenantId),
    templateIdx: index('routing_rules_template_idx').on(t.moduleTemplateId),
    tenantMatchUnique: uniqueIndex('uq_routing_rules_tenant_match')
      .on(t.tenantId, t.entityType, t.intent, t.priority)
      .where(sql`tenant_id IS NOT NULL`),
    platformMatchUnique: uniqueIndex('uq_routing_rules_platform_match')
      .on(t.entityType, t.intent, t.priority)
      .where(sql`tenant_id IS NULL`),
    confidenceCheck: check(
      'routing_rules_min_confidence_check',
      sql`min_confidence >= 0.00 AND min_confidence <= 1.00`,
    ),
  }),
);

export type RoutingRuleRow = typeof routingRules.$inferSelect;
export type RoutingRuleInsert = typeof routingRules.$inferInsert;
