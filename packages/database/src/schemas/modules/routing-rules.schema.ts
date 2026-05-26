/**
 * routing_rules — Piece B junior-chain routing (issue #39, migration 0013).
 *
 * Maps `(tenant_id, source_kind)` to a `target_kind` (the next junior
 * to dispatch OR a human role to escalate to) under an in-process
 * JSONB condition predicate. Higher priority wins; inactive rows are
 * skipped at lookup time.
 *
 * Lookup pattern (see `JuniorRoutingRulesPort` in
 * `@borjie/dispatch-router`):
 *
 *   SELECT * FROM routing_rules
 *    WHERE tenant_id = $1
 *      AND source_kind = $2
 *      AND active = true
 *    ORDER BY priority DESC, created_at ASC
 *
 * NOTE: this schema replaces the earlier
 * `(entity_type, intent, module_template_id, action, payload_template,
 *   min_confidence, hitl_required)` shape that was drafted but never
 * landed in the mining-domain Drizzle migration set. The Piece B
 * matrix-route concept now lives on the in-memory
 * `RoutingMatrixRow` + `RoutingRulesLoader` in
 * `@borjie/dispatch-router/dispatcher.ts`.
 *
 * RLS-FORCED in migration 0013 under the platform-standard
 * `tenant_id = current_setting('app.tenant_id', true)` policy.
 */

import {
  pgTable,
  text,
  smallint,
  boolean,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from '../tenant.schema.js';

export const routingRules = pgTable(
  'routing_rules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Source junior name (e.g. `lease-renewal-watcher`). */
    sourceKind: text('source_kind').notNull(),
    /** 'junior' | 'human' — discriminator for the target. */
    targetRole: text('target_role').notNull(),
    /** Target junior name OR human role slug. */
    targetKind: text('target_kind').notNull(),
    /**
     * Predicate evaluated against the source junior's output:
     *   { all?: Cond[]; any?: Cond[]; not?: Predicate }
     * Empty `{}` matches everything (catch-all).
     */
    conditionJsonb: jsonb('condition_jsonb').notNull().default(sql`'{}'::jsonb`),
    priority: smallint('priority').notNull().default(100),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantSourceIdx: index('idx_routing_rules_tenant_source').on(
      t.tenantId,
      t.sourceKind,
      t.active,
    ),
    priorityIdx: index('idx_routing_rules_priority').on(
      t.tenantId,
      t.sourceKind,
      t.priority,
    ),
    targetRoleCheck: check(
      'routing_rules_target_role_chk',
      sql`${t.targetRole} IN ('junior','human')`,
    ),
    priorityCheck: check(
      'routing_rules_priority_chk',
      sql`${t.priority} >= 0 AND ${t.priority} <= 1000`,
    ),
  }),
);

export type RoutingRuleRow = typeof routingRules.$inferSelect;
export type RoutingRuleInsert = typeof routingRules.$inferInsert;
