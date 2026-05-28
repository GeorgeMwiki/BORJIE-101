/**
 * Drizzle column factory for the universal `provenance` jsonb column.
 *
 * Implements principle 4 of the Chat-as-OS Bidirectional Parity
 * Manifesto (Docs/RESEARCH/CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md):
 *
 *   Every state-mutable entity carries a `provenance` jsonb column —
 *   `{via: 'chat' | 'form' | 'agent_apply' | 'api' | 'legacy' |
 *    'unknown', actorId, sessionId, turnId?, requestedAt}`.
 *
 * Schema files import `provenanceColumn()` and add the result to the
 * column object inside `pgTable(...)`. Migration `0101_universal_
 * provenance.sql` is the canonical source of truth for the column's
 * shape on disk; this factory mirrors that shape for new drizzle
 * inserts and reads.
 *
 * Default is `{"via":"unknown"}` so any code path that forgets to
 * forward provenance lands a row that the audit dashboard can flag
 * for the on-call to fix.
 */

import { jsonb } from 'drizzle-orm/pg-core';

/** Shape of the JSONB column, matching the api-gateway provenance helper. */
export interface ProvenanceJson {
  readonly via: 'chat' | 'form' | 'agent_apply' | 'api' | 'legacy' | 'unknown';
  readonly actorId: string | null;
  readonly sessionId?: string | null;
  readonly turnId?: string | null;
  readonly requestedAt: string;
}

/**
 * Build the `provenance` column for a drizzle pgTable schema.
 *
 * Usage:
 *
 *   import { provenanceColumn } from '@borjie/database/helpers';
 *   ...
 *   export const reminders = pgTable('reminders', {
 *     ...
 *     provenance: provenanceColumn(),
 *   });
 */
export function provenanceColumn() {
  return jsonb('provenance')
    .$type<ProvenanceJson>()
    .notNull()
    .default({ via: 'unknown', actorId: null, requestedAt: '1970-01-01T00:00:00Z' });
}
