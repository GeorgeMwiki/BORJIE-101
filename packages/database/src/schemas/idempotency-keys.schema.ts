/**
 * Idempotency Keys — server-side hard uniqueness for mutation requests.
 *
 * Closes H2 deferral: the previous Redis-backed
 * `services/api-gateway/src/middleware/idempotency.ts` cached responses
 * but could not stop two simultaneous duplicate requests from both
 * passing through to the handler under a Redis split-brain or before
 * the first replica SETEXed. This table enforces the dedup invariant
 * in the database itself via a partial unique index.
 *
 * Migration: packages/database/src/migrations/0154_idempotency_keys.sql
 *
 * Lifecycle:
 *   1. Middleware INSERTs `(tenant_id, key, resource_kind, request_hash)`
 *      with `state = 'in_flight'` before running the handler.
 *   2. Duplicate INSERT collides → middleware reads the existing row.
 *      If `state = 'completed'`, replay the cached response. If still
 *      `in_flight`, return 409 with a `Retry-After` hint.
 *   3. After the handler runs, the middleware UPDATEs the row with
 *      the response status/body/headers and sets `state = 'completed'`.
 *   4. A cron sweeper (idempotency-sweeper.ts) deletes expired rows
 *      every hour.
 *
 * Scope:
 *   - Authenticated calls: UNIQUE on (tenant_id, key, resource_kind).
 *   - Anonymous webhooks: UNIQUE on (key, resource_kind) when
 *     tenant_id IS NULL. The partial index per nullability variant
 *     keeps PostgreSQL's NULL-distinct semantics from defeating the
 *     uniqueness guarantee.
 *
 * RLS is FORCE-enabled per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Hard cap on retention so an unsupervised store cannot grow forever. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const IDEMPOTENCY_STATES = ['in_flight', 'completed', 'failed'] as const;
export type IdempotencyState = (typeof IDEMPOTENCY_STATES)[number];

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL for anonymous (webhook) calls. */
    tenantId: text('tenant_id'),
    /** The literal Idempotency-Key header value the client sent. */
    key: text('key').notNull(),
    /** Namespace for the key. e.g. 'owner.bulk-action' / 'webhook.mpesa'. */
    resourceKind: text('resource_kind').notNull(),
    /** sha256(method + path + sorted-body) for soft-collision detection. */
    requestHash: text('request_hash').notNull(),
    /** Populated when the handler completes. */
    responseStatus: integer('response_status'),
    /** Populated when the handler completes. */
    responseBody: jsonb('response_body'),
    /** Populated when the handler completes. */
    responseHeaders: jsonb('response_headers'),
    /** State machine: in_flight | completed | failed. */
    state: text('state').notNull().default('in_flight'),
    /** Best-effort attribution for ops support tickets. */
    actorId: text('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    tenantUnique: uniqueIndex('idempotency_keys_tenant_unique').on(
      table.tenantId,
      table.key,
      table.resourceKind,
    ),
    anonUnique: uniqueIndex('idempotency_keys_anon_unique').on(
      table.key,
      table.resourceKind,
    ),
    expiresIdx: index('idempotency_keys_expires_idx').on(table.expiresAt),
    stateIdx: index('idempotency_keys_state_idx').on(
      table.state,
      table.createdAt,
    ),
  }),
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyRow = typeof idempotencyKeys.$inferInsert;
