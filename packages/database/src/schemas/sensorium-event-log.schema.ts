/**
 * Sensorium event log — Central Command Phase A (C4 Sensorium / Brain Skin).
 *
 * Drizzle schema for `sensorium_event_log` (migration 0132). One row per
 * filtered sensory event from the 14-event taxonomy defined in
 * `.planning/central-command/00-architecture.md` §"Sensory event
 * taxonomy".
 *
 * IMPORTANT: this table never stores:
 *   - mouse.move events (session-replay only, 4 Hz, separate cold store)
 *   - raw input.change values (PII-redacted at the client; we keep only
 *     `valueLength` + `hasPii` + `fieldName`)
 *   - keystroke-level events (debounced/filtered at the client)
 *
 * payload_json is JSONB so the aggregator (BehaviorObserver server-side)
 * can read event-type-specific fields without per-event sub-tables.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * The canonical 14-event taxonomy. Kept here as a typed const so the
 * router + service + tests can validate without importing the DDL.
 *
 * Mirror exactly with the client-side `event-handlers/` files.
 */
export const SENSORIUM_EVENT_TYPES = [
  'page.view',
  'page.leave',
  'element.click',
  'input.change',
  'form.submit',
  'scroll.depth',
  'dwell.time',
  'focus.change',
  'keyboard.shortcut',
  'copy.paste',
  'viewport.resize',
  'network.request',
  'error.boundary',
  'a11y.tree.diff',
] as const;

export type SensoriumEventType = (typeof SENSORIUM_EVENT_TYPES)[number];

export const sensoriumEventLog = pgTable(
  'sensorium_event_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id').notNull(),
    surface: text('surface').notNull(),
    route: text('route').notNull(),
    /** One of {@link SENSORIUM_EVENT_TYPES}. */
    eventType: text('event_type').notNull(),
    /** Event-type-specific payload. PII-redacted at emit time. */
    payloadJson: jsonb('payload_json').notNull().default({}),
    /** Client-side timestamp (when the event was observed in the DOM). */
    emittedAt: timestamp('emitted_at', { withTimezone: true }).notNull(),
    /** Server-side timestamp (when the gateway accepted the batch). */
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUserSessionIdx: index('idx_sensorium_tenant_user_session').on(
      t.tenantId,
      t.userId,
      t.sessionId,
      t.emittedAt.desc(),
    ),
    eventTypeIdx: index('idx_sensorium_event_type').on(t.eventType),
  }),
);

export type SensoriumEventLogRow = typeof sensoriumEventLog.$inferSelect;
export type NewSensoriumEventLogRow = typeof sensoriumEventLog.$inferInsert;
