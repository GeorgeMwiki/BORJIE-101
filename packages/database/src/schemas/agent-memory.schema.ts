/**
 * agent_memory (migration 0302) — durable backend for the Anthropic memory
 * tool (`memory_20250818`) consumed by the central-intelligence kernel.
 *
 * The kernel's `MemoryTool` port (kernel/orchestrator/memory-tool.ts) is the
 * agent's per-scope working notebook: path-scoped files it reads + writes
 * between turns. This table persists that notebook so it survives restarts and
 * is shared across replicas — replacing the in-memory LRU adapter the kernel
 * falls back to today.
 *
 * Column mapping onto the path-scoped port (also matches the prescribed
 * agent-memory contract):
 *   - agentId  ← the port's scope key (threadId; '_platform' for platform scope)
 *   - memKey   ← the normalised, traversal-safe memory path
 *   - memValue ← jsonb { content, updatedAt } (the file body + last write)
 * UNIQUE(tenantId, agentId, memKey) gives last-write-wins upsert + the
 * canonical `create` 'already-exists' precondition one source of truth.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors migrations 0289 / 0295): every
 * `tenant_id` is TEXT and FK→tenants; the table FORCE-enables RLS on the
 * canonical `app.current_tenant_id` GUC. Platform-scope threads live under the
 * '_platform' sentinel tenant so they stay RLS-scoped (never NULL-tenant).
 *
 * Companion to:
 *   - packages/database/src/migrations/0302_agent_memory.sql
 *   - services/api-gateway/src/composition/memory/drizzle-memory-tool.ts
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/** The jsonb payload stored in `mem_value`. */
export interface AgentMemoryValue {
  readonly content: string;
  readonly updatedAt: string;
}

export const agentMemory = pgTable(
  'agent_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Memory scope key (threadId, or '_platform' for platform scope). */
    agentId: text('agent_id').notNull(),
    /** Normalised, traversal-safe memory path. */
    memKey: text('mem_key').notNull(),
    /** { content, updatedAt } — file body + last-write timestamp. */
    memValue: jsonb('mem_value')
      .$type<AgentMemoryValue>()
      .notNull()
      .default({ content: '', updatedAt: '' }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantAgentKeyUq: unique('agent_memory_tenant_agent_key_uq').on(
      t.tenantId,
      t.agentId,
      t.memKey,
    ),
    tenantAgentIdx: index('idx_agent_memory_tenant_agent').on(
      t.tenantId,
      t.agentId,
    ),
    tenantAgentKeyIdx: index('idx_agent_memory_tenant_agent_key').on(
      t.tenantId,
      t.agentId,
      t.memKey,
    ),
  }),
);

export type AgentMemoryRow = typeof agentMemory.$inferSelect;
export type AgentMemoryInsert = typeof agentMemory.$inferInsert;
