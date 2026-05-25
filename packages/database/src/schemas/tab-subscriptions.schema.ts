/**
 * tab_subscriptions (migration 0231) — Piece L brain-tab loop.
 *
 * Binds a (persona × module_template) pair to a Supabase Realtime
 * channel so the frontend tab can subscribe to proposal events. The
 * chat-ui's `<PendingProposalCard>` reads this to know which channel
 * name to subscribe to.
 *
 * Channel naming convention:
 *   tenant:{tenant_id}:module:{module_template_id}:proposals
 *
 * Tenant-scoped via RLS. Uniqueness on (tenant, persona, module).
 */

import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const tabSubscriptions = pgTable(
  'tab_subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Persona id (matches persona_registry.id). */
    personaId: text('persona_id').notNull(),
    /** Soft FK to modules table (Piece B). */
    moduleTemplateId: text('module_template_id').notNull(),
    /** Realtime channel name — convention above. */
    channelName: text('channel_name').notNull(),
    /** Subscription active flag (paused tabs flip to FALSE). */
    active: boolean('active').notNull().default(true),
    /** UI hints, filter predicates, etc. */
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPersonaIdx: index('tab_subscriptions_tenant_persona_idx').on(
      t.tenantId,
      t.personaId,
    ),
    channelIdx: index('tab_subscriptions_channel_idx').on(t.channelName),
    /** One (tenant, persona, module) triple = one channel. */
    tenantPersonaModuleUq: uniqueIndex(
      'tab_subscriptions_tenant_persona_module_uq',
    ).on(t.tenantId, t.personaId, t.moduleTemplateId),
  }),
);

export type TabSubscriptionRow = typeof tabSubscriptions.$inferSelect;
export type TabSubscriptionInsert = typeof tabSubscriptions.$inferInsert;
