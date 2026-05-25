/**
 * Persona registry — DB-persisted runtime persona definitions.
 *
 * Phase D D7 — durable backing for the kernel's
 * `PersonaRegistry` so platform-admins can hot-swap a persona's
 * voice / taboos / opening statement without a deploy. The kernel
 * hydrates its in-memory map from this table on boot and refreshes
 * after every write.
 *
 * One row per persona id (e.g. 'tenant-resident'). `tenant_id` NULL
 * means "platform-wide default"; non-NULL is a tenant-scoped
 * override that the brain falls back to on miss in the platform map.
 *
 * `taboos` + `violation_signals` are JSONB arrays of strings.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const personaRegistry = pgTable(
  'persona_registry',
  {
    id: text('id').primaryKey(),
    /** NULL means platform-wide default persona. */
    tenantId: text('tenant_id'),
    /** Display name (e.g. 'Borjie Resident Concierge'). */
    displayName: text('display_name').notNull(),
    openingStatement: text('opening_statement').notNull(),
    toneGuidance: text('tone_guidance').notNull(),
    taboos: jsonb('taboos').notNull(),
    violationSignals: jsonb('violation_signals').notNull(),
    firstPersonNoun: text('first_person_noun').notNull(),
    /** Optional metadata blob (UI hints, surface bindings, …). */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_persona_registry_tenant').on(t.tenantId),
    tenantNameUq: uniqueIndex('uq_persona_registry_tenant_name').on(
      t.tenantId,
      t.displayName,
    ),
  }),
);
