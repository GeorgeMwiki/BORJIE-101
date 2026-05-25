/**
 * Sensor call log — control-plane telemetry for every multi-LLM sensor call.
 *
 * One row per (task, sensor) attempt. Mirrors LITFIN's
 * `sensor_call_log` table — closes the routing-control gap identified
 * in `.planning/parity-litfin/04-sensors-routing.md` section 7:
 *
 *   - `outcome` ∈ {ok | timeout | error | budget_exceeded | refused}
 *     so failure-mode analytics distinguish "providers throttled" from
 *     "tenant ran out of budget" from "model refused"
 *   - tokens_in / tokens_out / cost_usd_micro keep the dollar trail per
 *     call so the periodic budget envelope can be debited atomically
 *   - latency_ms + thinking_active so the dashboards can split p95 by
 *     "extended thinking on" and tune the cognition-mode hints
 *
 * Append-only; admins read the table for routing/cost/availability
 * dashboards and feed the rows back into `task_sensor_routing` priorities.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Permitted outcome values. Kept here as a typed constant so the service
 * layer can validate without importing the DDL.
 */
export const SENSOR_CALL_OUTCOMES = [
  'ok',
  'timeout',
  'error',
  'budget_exceeded',
  'refused',
] as const;

export type SensorCallOutcome = (typeof SENSOR_CALL_OUTCOMES)[number];

export const sensorCallLog = pgTable(
  'sensor_call_log',
  {
    id: text('id').primaryKey(),
    /** NULL when the task is platform-scoped (no tenant in play). */
    tenantId: text('tenant_id'),
    /** Free-form task name, e.g. 'greeting' | 'voice_turn' | 'memo'. */
    task: text('task').notNull(),
    /** Stable sensor id (e.g. 'claude.opus-4-7', 'openai.gpt-5'). */
    sensor: text('sensor').notNull(),
    /** Resolved model id. May equal sensor on simple bindings. */
    model: text('model'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** 'ok' | 'timeout' | 'error' | 'budget_exceeded' | 'refused'. */
    outcome: text('outcome').notNull(),
    /** Optional classifier for errors (e.g. 'rate_limit', '5xx', 'parse'). */
    errorClass: text('error_class'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    /** Microdollars (1 USD = 1_000_000 micro). BIGINT avoids float drift. */
    costUsdMicro: bigint('cost_usd_micro', { mode: 'number' })
      .notNull()
      .default(0),
    latencyMs: integer('latency_ms'),
    thinkingActive: boolean('thinking_active').notNull().default(false),
    /** Optional join key to `provenance.thoughtId` of the kernel turn. */
    decisionTraceId: text('decision_trace_id'),
  },
  (t) => ({
    tenantTimeIdx: index('idx_sensor_call_log_tenant_time').on(
      t.tenantId,
      t.startedAt.desc(),
    ),
    taskSensorIdx: index('idx_sensor_call_log_task_sensor').on(
      t.task,
      t.sensor,
      t.startedAt.desc(),
    ),
    outcomeIdx: index('idx_sensor_call_log_outcome').on(
      t.outcome,
      t.startedAt.desc(),
    ),
  }),
);
