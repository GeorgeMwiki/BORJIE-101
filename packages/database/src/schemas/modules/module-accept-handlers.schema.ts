/**
 * module_accept_handlers (migration 0220) — registry of accept_proposal
 * handlers per module template.
 *
 * The executor looks up handlers in this table to dispatch a
 * `module_update_proposals` row to the right code path inside a
 * module template. payload_zod_jsonb is a serialised Zod-schema tree
 * the executor reconstructs to a runtime z.object before validating
 * the payload.
 *
 * RLS: platform-wide. SELECT allowed for authenticated; INSERT/UPDATE/
 * DELETE forbidden from authenticated (service-role only).
 */

import {
  pgTable,
  text,
  smallint,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { moduleTemplates } from './module-templates.schema.js';

export const MODULE_ACCEPT_HANDLER_RISK_TIERS = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'SOVEREIGN',
] as const;

export type ModuleAcceptHandlerRiskTier =
  (typeof MODULE_ACCEPT_HANDLER_RISK_TIERS)[number];

export const moduleAcceptHandlers = pgTable(
  'module_accept_handlers',
  {
    id: text('id').primaryKey(),
    moduleTemplateId: text('module_template_id')
      .notNull()
      .references(() => moduleTemplates.slug, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    payloadZodJsonb: jsonb('payload_zod_jsonb')
      .$type<Record<string, unknown>>()
      .notNull(),
    handlerModule: text('handler_module').notNull(),
    allowedPersonaTiers: smallint('allowed_persona_tiers')
      .array()
      .notNull(),
    riskTier: text('risk_tier')
      .$type<ModuleAcceptHandlerRiskTier>()
      .notNull()
      .default('MEDIUM'),
    emitsMoneyMutation: boolean('emits_money_mutation')
      .notNull()
      .default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    actionUnique: uniqueIndex('uq_module_accept_handlers_action').on(
      t.moduleTemplateId,
      t.action,
    ),
    templateIdx: index('module_accept_handlers_template_idx').on(
      t.moduleTemplateId,
    ),
    riskCheck: check(
      'module_accept_handlers_risk_check',
      sql`risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN')`,
    ),
  }),
);

export type ModuleAcceptHandlerRow =
  typeof moduleAcceptHandlers.$inferSelect;
export type ModuleAcceptHandlerInsert =
  typeof moduleAcceptHandlers.$inferInsert;
