/**
 * entity_ext_person (migration 0194) — thin extension for PERSON-type
 * core_entity rows.
 *
 * `supabaseUserId` is the link to auth.users(id) on the Supabase
 * platform — NULL when the PERSON is not a platform login (visitor
 * logs, dependants, rolodex contacts).
 *
 * Tanzania NIDA (National Identification Authority) number column is
 * a free-form TEXT that the compliance-plugins layer validates against
 * the per-jurisdiction format.
 */

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';
import { coreEntity } from './core-entity.schema.js';

export const entityExtPerson = pgTable(
  'entity_ext_person',
  {
    entityId: text('entity_id')
      .primaryKey()
      .references(() => coreEntity.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** NULL when the PERSON is not a Supabase login. */
    supabaseUserId: text('supabase_user_id'),
    email: text('email'),
    phone: text('phone'),
    /** Tanzania NIDA — validated by compliance-plugins per jurisdiction. */
    nidaNumber: text('nida_number'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    /** 'en' | 'sw' — others via i18n adapters. */
    preferredLanguage: text('preferred_language').notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('entity_ext_person_tenant_idx').on(t.tenantId),
    supabaseIdx: index('entity_ext_person_supabase_idx').on(t.supabaseUserId),
  }),
);

export type EntityExtPersonRow = typeof entityExtPerson.$inferSelect;
export type EntityExtPersonInsert = typeof entityExtPerson.$inferInsert;
