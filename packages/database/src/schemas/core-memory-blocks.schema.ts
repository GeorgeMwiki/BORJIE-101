/**
 * Core memory blocks — Letta-style persistent self-summary.
 *
 * Migration 0151. One row per active (tenant, user, persona, kind);
 * historical rows kept with `archived_at` set so an operator can
 * audit the agent's self-model over time.
 */
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const coreMemoryBlocks = pgTable(
  'core_memory_blocks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id'),
    userId: text('user_id'),
    personaId: text('persona_id').notNull(),
    /** 'persona' | 'human' | 'preferences' | 'project' */
    blockKind: text('block_kind').notNull(),
    blockText: text('block_text').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    tenantUserPersonaIdx: index(
      'idx_core_memory_blocks_tenant_user_persona',
    ).on(t.tenantId, t.userId, t.personaId, t.updatedAt.desc()),
    personaKindIdx: index('idx_core_memory_blocks_persona_kind').on(
      t.personaId,
      t.blockKind,
      t.updatedAt.desc(),
    ),
  }),
);
