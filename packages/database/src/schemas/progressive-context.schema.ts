/**
 * Progressive context snapshots — migration 0042.
 *
 * Append-only log of AccumulatedEstateContext versions per session.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const progressiveContextSnapshots = pgTable(
  'progressive_context_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    version: integer('version').notNull(),
    context: jsonb('context').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantSessionIdx: index('idx_context_snap_tenant_session').on(
      table.tenantId,
      table.sessionId,
      table.version,
    ),
    createdIdx: index('idx_context_snap_created').on(
      table.tenantId,
      table.createdAt,
    ),
    uqVersion: unique('uq_context_version').on(
      table.tenantId,
      table.sessionId,
      table.version,
    ),
  }),
);
