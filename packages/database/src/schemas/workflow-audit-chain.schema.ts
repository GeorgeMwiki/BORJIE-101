/**
 * Workflow audit chain — hashed, per-tenant append-only ordering for
 * `@borjie/workflow-engine`.
 *
 * Companion to:
 *   - packages/database/src/migrations/0307_workflow_engine_durable_repos.sql
 *   - packages/workflow-engine/src/repositories/drizzle-audit-chain-repository.ts
 *   - packages/workflow-engine/src/types.ts (AuditChainEntry)
 *   - packages/workflow-engine/src/audit/hash-chain.ts
 *
 * current_hash = sha256(previous_hash || runId || kind ||
 * JSON.stringify(payload) || recordedAt.toISOString()). The per-tenant
 * head pointer (latest current_hash) seeds the next previous_hash;
 * the repository serializes appends per tenant so the chain is linear.
 * Tamper-evident: editing any past row invalidates every later hash.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy; FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const workflowAuditChain = pgTable(
  'workflow_audit_chain',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    previousHash: text('previous_hash').notNull(),
    currentHash: text('current_hash').notNull(),
    recordedKind: text('recorded_kind').notNull(),
    recordedPayload: jsonb('recorded_payload').notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runIdx: index('workflow_audit_chain_run_idx').on(
      table.runId,
      table.recordedAt,
    ),
    tenantHeadIdx: index('workflow_audit_chain_tenant_head_idx').on(
      table.tenantId,
      table.recordedAt,
    ),
    currentHashUniq: uniqueIndex('workflow_audit_chain_current_hash_uidx').on(
      table.tenantId,
      table.currentHash,
    ),
  }),
);

export type WorkflowAuditChainRow = typeof workflowAuditChain.$inferSelect;
export type NewWorkflowAuditChainRow = typeof workflowAuditChain.$inferInsert;
