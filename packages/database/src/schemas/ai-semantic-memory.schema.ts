/**
 * AI semantic memory — Wave-11 long-lived conversational memory.
 *
 * Per-tenant, per-persona vector store. Embeddings stored as TEXT (JSON) so
 * the schema works whether or not pgvector is installed. When pgvector is
 * present, callers can cast/rewrite as needed.
 */

import {
  pgTable,
  text,
  integer,
  doublePrecision,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const aiSemanticMemories = pgTable(
  'ai_semantic_memories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personaId: text('persona_id'),
    memoryType: text('memory_type').notNull().default('interaction'),
    content: text('content').notNull(),
    embedding: text('embedding'),
    metadata: jsonb('metadata').notNull().default({}),
    confidence: doublePrecision('confidence').notNull().default(0.8),
    decayScore: doublePrecision('decay_score').notNull().default(1.0),
    accessCount: integer('access_count').notNull().default(0),
    sessionId: text('session_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => ({
    tenantPersonaIdx: index('idx_ai_memory_tenant_persona').on(
      table.tenantId,
      table.personaId,
    ),
    tenantDecayIdx: index('idx_ai_memory_tenant_decay').on(
      table.tenantId,
      table.decayScore,
    ),
    lastAccessIdx: index('idx_ai_memory_last_access').on(table.lastAccessedAt),
  }),
);
