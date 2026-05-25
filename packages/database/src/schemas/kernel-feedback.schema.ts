/**
 * Kernel feedback — the brain's online-learning signal store.
 *
 * Mirrors LITFIN's feedback loop. Stock LLMs are STATIC: without an
 * explicit feedback channel the same hallucination repeats forever.
 * This table captures every thumbs / explicit-correction signal the
 * user provides on a kernel turn, so the next turn can read it back at
 * step 4 (memory recall) and adjust:
 *
 *   - thumbs-up   : user signalled the answer was good
 *   - thumbs-down : user signalled the answer was bad
 *   - correction  : the user told us why we were wrong (verbatim
 *                   `correction_text` column carries the explanation)
 *   - flagged     : moderation-style flag for review
 *
 * Per-(tenant, user) signal stream — every row references the upstream
 * `provenance.thoughtId` so signals can be joined back to the originating
 * decision (model, persona, latency, judge score). The kernel itself
 * reads its own roll-up at step 4 to bias the next turn toward
 * conservative, citation-heavy output when the recent negative-rate is
 * elevated.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const kernelFeedback = pgTable(
  'kernel_feedback',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** References provenance.thoughtId of the kernel turn being rated. */
    thoughtId: text('thought_id').notNull(),
    threadId: text('thread_id').notNull(),
    /** 'thumbs-up' | 'thumbs-down' | 'correction' | 'flagged' */
    signal: text('signal').notNull(),
    /** Optional 1..5 numeric rating (UI affordance). */
    rating: integer('rating'),
    /** User's "this is wrong because…" verbatim text. */
    correctionText: text('correction_text'),
    /** 'hallucinated' | 'incomplete' | 'wrong-tone' | 'unhelpful' | 'great' | 'other' */
    category: text('category'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUserIdx: index('idx_kernel_feedback_tenant_user').on(
      t.tenantId,
      t.userId,
      t.capturedAt.desc(),
    ),
    thoughtIdx: index('idx_kernel_feedback_thought').on(t.thoughtId),
    signalIdx: index('idx_kernel_feedback_signal').on(t.tenantId, t.signal),
  }),
);
