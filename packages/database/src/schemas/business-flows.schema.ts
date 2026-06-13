/**
 * Business-process compiler substrate (migration 0351).
 *
 *  - `business_flows` — the compiled FlowSpec (template): actors/steps/handoffs/
 *    SLAs as jsonb. The binder materializes complementary surface tabs from it.
 *  - `flow_runs` — a running instance: the durable cross-surface state machine
 *    (raised → task_assigned → awaiting_owner_approval → delivered). Carries the
 *    cross-tenant buyer `originating_party_id` for the membership-bounded buyer
 *    read endpoint.
 *
 * Both tenant-scoped (FORCE RLS on app.current_tenant_id). flow_runs additionally
 * carries a service-role bypass for the buyer ReBAC read (the route enforces the
 * buyer_connection bound). The rich `FlowSpec` shape lives in the gateway
 * composition (surface-completion/flow-binder.ts); here the jsonb columns are
 * typed loosely so this package stays domain-agnostic.
 *
 * Companion to:
 *   - packages/database/src/migrations/0351_business_flows.sql
 *   - services/api-gateway/src/composition/surface-completion/flow-binder.ts
 *   - services/api-gateway/src/routes/mining/flows/inquiry-flow.hono.ts
 */

import { pgTable, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const businessFlows = pgTable(
  'business_flows',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    flowKey: text('flow_key').notNull(),
    name: text('name').notNull(),
    spec: jsonb('spec').notNull().$type<Record<string, unknown>>().default({}),
    status: text('status').notNull().default('active'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantKey: uniqueIndex('business_flows_tenant_key').on(t.tenantId, t.flowKey),
  }),
);

export const flowRuns = pgTable(
  'flow_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    flowKey: text('flow_key').notNull(),
    /** The cross-tenant BUYER tenant_identity id (for the buyer ReBAC read). */
    originatingPartyId: text('originating_party_id'),
    /** The buyer's home tenant (context). */
    originatingTenantId: text('originating_tenant_id'),
    /** What the run is about (e.g. the marketplace_listings id). */
    subjectRef: text('subject_ref'),
    /** raised | task_assigned | awaiting_owner_approval | delivered | closed. */
    state: text('state').notNull().default('raised'),
    /** open | closed. */
    status: text('status').notNull().default('open'),
    /** The spawned mining_tasks.id (the worker forward-edge). */
    taskId: text('task_id'),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
    response: jsonb('response').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantState: index('flow_runs_tenant_state_idx').on(t.tenantId, t.state),
    party: index('flow_runs_party_idx').on(t.originatingPartyId),
  }),
);

export type BusinessFlowRow = typeof businessFlows.$inferSelect;
export type BusinessFlowInsert = typeof businessFlows.$inferInsert;
export type FlowRunRow = typeof flowRuns.$inferSelect;
export type FlowRunInsert = typeof flowRuns.$inferInsert;

/** flow_runs.state lifecycle. */
export const FLOW_RUN_STATES = [
  'raised',
  'task_assigned',
  'awaiting_owner_approval',
  'delivered',
  'closed',
] as const;
export type FlowRunState = (typeof FLOW_RUN_STATES)[number];
