/**
 * AI audit hash chain — Wave-11 AI security hardening.
 *
 * Tamper-evident append-only log of every AI turn. Each entry links to the
 * previous one via a SHA-256 hash, so a single mutation breaks the chain on
 * verify().
 */

import {
  pgTable,
  text,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const aiAuditChain = pgTable(
  'ai_audit_chain',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sequenceId: bigint('sequence_id', { mode: 'number' }).notNull(),
    turnId: text('turn_id').notNull(),
    sessionId: text('session_id'),
    action: text('action').notNull(),
    prevHash: text('prev_hash').notNull(),
    thisHash: text('this_hash').notNull(),
    payloadRef: text('payload_ref'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantSeqIdx: index('idx_ai_audit_chain_tenant_seq').on(
      table.tenantId,
      table.sequenceId,
    ),
    turnIdx: index('idx_ai_audit_chain_turn').on(table.turnId),
    createdIdx: index('idx_ai_audit_chain_created').on(table.createdAt),
    uniqTenantSeq: uniqueIndex('uq_ai_audit_chain_tenant_seq').on(
      table.tenantId,
      table.sequenceId,
    ),
  }),
);
