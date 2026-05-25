/**
 * Skill registry — Voyager-style procedural memory.
 *
 * The brain learns reusable workflows by clustering successful trace
 * sequences during the nightly consolidation pass (stage 04-promote).
 * Each row stores:
 *
 *   - `name`                NL handle used in audits + logs
 *   - `nl_description`      embedding-keyed retrieval document
 *   - `description_embedding` 1536-dim pgvector for cosine retrieval
 *   - `tool_call_template`  JSON template the kernel re-uses verbatim
 *   - `success_count` / `failure_count` running tallies maintained by
 *     the consolidation worker + the kernel's skill-retriever telemetry
 *   - `code_hash`           sha256 of the canonicalised template — the
 *     de-dupe key so the worker never inserts the same skill twice
 *   - `status`              'active' | 'retired' | 'shadow'
 *                           Retired skills stop appearing in retrieval
 *                           but the row stays for audit replay.
 *                           Shadow lets us A/B promote without
 *                           injecting into production prompts.
 *
 * `tenant_id IS NULL` ⇒ global skill (cross-tenant default). Per-tenant
 * skills are scoped via the foreign-key reference.
 *
 * Drizzle has no native pgvector type; the column is modeled here as
 * the same `customType` wrapper used by `kernel-memory-semantic.schema`.
 * The underlying Postgres column is `VECTOR(1536)` (migration 0133) and
 * the retrieval path issues `<=>` cosine distance via raw SQL.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    const dims = config?.dimensions ?? 1536;
    return `vector(${dims})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    if (!value || typeof value !== 'string') return [];
    const trimmed = value.replace(/^\[/, '').replace(/\]$/, '');
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
  },
});

export const skillRegistry = pgTable(
  'skill_registry',
  {
    id: text('id').primaryKey(),
    /** NULL => global skill (shared across tenants). */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    nlDescription: text('nl_description').notNull(),
    /**
     * Optional embedding (text-embedding-3-small, 1536 dims) of the
     * `nl_description`. Populated by the consolidation worker. The
     * retriever filters NULLs so missing embeddings degrade silently.
     */
    descriptionEmbedding: vector('description_embedding', { dimensions: 1536 }),
    /**
     * Canonical tool-call template. Replayed verbatim by the kernel
     * once the retriever picks this skill — `tool_name` plus the
     * canonicalised `input` shape.
     */
    toolCallTemplate: jsonb('tool_call_template').notNull(),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    promotedAt: timestamp('promoted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * sha256(toolName + canonical(input-shape)) — de-dupe key. The
     * unique index on (tenant_id, code_hash) means the promote stage
     * can `ON CONFLICT DO UPDATE` to bump counters without crashing on
     * recurring promotions of the same skill.
     */
    codeHash: text('code_hash').notNull(),
    /** 'active' | 'retired' | 'shadow' */
    status: text('status').notNull().default('active'),
  },
  (t) => ({
    tenantHashUniq: uniqueIndex('uniq_skill_registry_tenant_code_hash').on(
      t.tenantId,
      t.codeHash,
    ),
    tenantStatusIdx: index('idx_skill_registry_tenant_status').on(
      t.tenantId,
      t.status,
    ),
    lastUsedIdx: index('idx_skill_registry_last_used').on(t.lastUsedAt),
  }),
);
