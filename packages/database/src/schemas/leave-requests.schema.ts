/**
 * leave_requests — worker leave (time-off) requests + manager approval.
 *
 * Companion to migration 0174 (WS-3 workforce wires). Mirrors the existing
 * community/worker grievance table (safety-csr.schema.ts → grievances): a
 * worker submits a request, a manager approves or rejects it (single approval,
 * NO four-eye), and every decision hash-chains into ai_audit_chain at the
 * route layer.
 *
 * State machine
 * -------------
 *   pending  -> approved   (manager approved; decided_* stamped)
 *   pending  -> rejected   (manager rejected; decided_* stamped)
 * approved / rejected are terminal.
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0174 on the canonical
 * `app.current_tenant_id` GUC (bound by databaseMiddleware). The route layer
 * additionally scopes worker reads/writes to their own `worker_user_id` and
 * gates the approve/reject transition to manager roles. NO money columns —
 * nothing here ever touches the LedgerService money path.
 */

import {
  pgTable,
  text,
  timestamp,
  date,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /**
     * Worker who submitted the request (= auth.userId at submit time — the
     * same identity payroll_line_items.worker_user_id + clock-in events key on).
     */
    workerUserId: text('worker_user_id').notNull(),
    siteId: text('site_id'),
    /** annual | sick | unpaid | bereavement | maternity | paternity | other. */
    category: text('category').notNull().default('annual'),
    /** Inclusive calendar start of the leave. */
    startOn: date('start_on').notNull(),
    /** Inclusive calendar end of the leave (DB CHECK: end_on >= start_on). */
    endOn: date('end_on').notNull(),
    reason: text('reason'),
    /** pending | approved | rejected. */
    status: text('status').notNull().default('pending'),
    /** Manager who decided — non-null only after approve/reject. */
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantWorkerIdx: index('idx_leave_requests_tenant_worker').on(
      t.tenantId,
      t.workerUserId,
      t.submittedAt,
    ),
    tenantStatusIdx: index('idx_leave_requests_tenant_status').on(
      t.tenantId,
      t.status,
      t.submittedAt,
    ),
  }),
);

export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;
