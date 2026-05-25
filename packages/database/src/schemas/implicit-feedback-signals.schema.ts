/**
 * Implicit feedback signals — the >99% of feedback that's NOT a thumbs.
 *
 * Sensorium events (C4) emit raw user interactions (copy, re-prompt,
 * edit-resubmit, override, abandonment, time-to-resolution). The
 * consolidation worker's stage 01-ingest joins those events back to
 * the originating kernel turn via `(trace_id, agent_action_id,
 * tenant_id, user_id, surface, role)` and persists one row per signal.
 *
 * Strength is a normalised [0, 1] weight set by the producer based on
 * the research-validated table in `2025-progressive-intelligence.md`:
 *   - copy:               0.7   (high implicit positive)
 *   - re-prompt < 30s:    0.85  (high implicit negative)
 *   - edit-resubmit:      0.95  (granular correction signal)
 *   - override:           1.0   (RLHF on rails — critical)
 *   - time-to-resolution: 0.5   (medium outcome proxy)
 *   - abandonment:        0.6   (medium frustration)
 *
 * The kernel consumes these signals as input to the consolidation
 * worker's stage 03-reflect — successes vs. failures get clustered
 * separately and fed into different downstream actions.
 */

import {
  pgTable,
  text,
  real,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const implicitFeedbackSignals = pgTable(
  'implicit_feedback_signals',
  {
    id: text('id').primaryKey(),
    /** Originating kernel turn — joins back to the sovereign trace. */
    traceId: text('trace_id').notNull(),
    /**
     * Optional agency-action id — for signals attributed to a specific
     * agent-suggested action (override, edit-resubmit of a draft, ...).
     */
    agentActionId: text('agent_action_id'),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    /** 'tenant-app' | 'owner-portal' | 'admin-portal' | 'platform-hq' | ... */
    surface: text('surface').notNull(),
    /**
     * 'copy' | 're-prompt' | 'edit-resubmit' | 'override' |
     * 'abandonment' | 'time-to-resolution'
     */
    signalType: text('signal_type').notNull(),
    /** Producer-assigned [0, 1] strength weight. */
    strength: real('strength').notNull(),
    /** Optional opaque payload (durations, diff bytes, etc.). */
    payloadJson: jsonb('payload_json').notNull().default({}),
    emittedAt: timestamp('emitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    traceIdx: index('idx_implicit_feedback_trace').on(t.traceId),
    userTimeIdx: index('idx_implicit_feedback_user_time').on(
      t.tenantId,
      t.userId,
      t.emittedAt,
    ),
    typeIdx: index('idx_implicit_feedback_type').on(
      t.tenantId,
      t.signalType,
      t.emittedAt,
    ),
  }),
);
