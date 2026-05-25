/**
 * Task sensor routing — DB-stored per-(tenant, task) sensor chain override.
 *
 * Phase D D7 — completes the control plane started in migration 0126
 * (`sensor_call_log` + `tenant_budget_envelopes`). Lets an admin change
 * the LLM that handles a specific task for a specific tenant WITHOUT a
 * deploy. The brain's router reads this table first; on miss it falls
 * back to the in-code builtin chain in `sensor-routing.service.ts`.
 *
 * One row per (tenant_id, task). `tenant_id` NULL means "platform-wide
 * default override" — higher priority than the builtin, lower than a
 * tenant-specific row.
 *
 * The chain is stored as JSONB to keep schema simple:
 *
 *   [
 *     { "sensor": "claude.opus-4-7",   "maxTokens": 4000, "maxBudgetUsdMicroPerCall": 200000 },
 *     { "sensor": "claude.sonnet-4-6", "maxTokens": 2000, "maxBudgetUsdMicroPerCall":  50000 }
 *   ]
 *
 * `cognition_mode` mirrors the `'fast' | 'default' | 'deep'` triad the
 * router emits. `reasoning` is admin-authored prose used to explain
 * the override in dashboards + ai-audit replays.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const TASK_SENSOR_ROUTING_COGNITION_MODES = [
  'fast',
  'default',
  'deep',
] as const;

export type TaskSensorRoutingCognitionMode =
  (typeof TASK_SENSOR_ROUTING_COGNITION_MODES)[number];

export interface TaskSensorChainEntry {
  readonly sensor: string;
  readonly maxTokens: number;
  /** Microdollars (1 USD = 1_000_000). Per-call ceiling. */
  readonly maxBudgetUsdMicroPerCall: number;
}

export const taskSensorRouting = pgTable(
  'task_sensor_routing',
  {
    id: text('id').primaryKey(),
    /** NULL means platform-wide override; non-NULL is tenant-scoped. */
    tenantId: text('tenant_id'),
    /** Free-form task name, must match the kernel's task vocabulary. */
    task: text('task').notNull(),
    /** Ordered primary + fallback chain (length ≥ 1). */
    chain: jsonb('chain').notNull(),
    cognitionMode: text('cognition_mode').notNull().default('default'),
    /** Admin-authored reason used by dashboards + replay tooling. */
    reasoning: text('reasoning'),
    /** Optional ISO-8601 expiry. Reads ignore rows past their TTL. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One active override per (tenant, task). `tenant_id` NULL collisions
    // are handled by Postgres' default index behaviour (NULL ≠ NULL),
    // which is fine — platform-wide override is a single sentinel row
    // managed by HQ only.
    tenantTaskIdx: uniqueIndex('uq_task_sensor_routing_tenant_task').on(
      t.tenantId,
      t.task,
    ),
    taskIdx: index('idx_task_sensor_routing_task').on(t.task),
  }),
);
