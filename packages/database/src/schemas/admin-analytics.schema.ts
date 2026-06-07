/**
 * ab_experiments + activation_events + audit_packs (migration 0300) —
 * the admin-analytics feeding store for the three internal-console screens
 * (apps/admin-web/src/app/internal/{ab-tests, analytics, audit-pack}).
 *
 * Scope (CLAUDE.md hard rule):
 *   - ab_experiments     — PLATFORM/HQ infrastructure. An experiment spans many
 *     tenants, so `tenantId` is NULLABLE and the table carries NO RLS tenant
 *     policy; access is gated at the route layer (SUPER_ADMIN / ADMIN).
 *   - activation_events  — TENANT-SCOPED append-only funnel event log. tenantId
 *     TEXT NOT NULL, FK→tenants; FORCE RLS on `app.current_tenant_id`.
 *   - audit_packs        — TENANT-SCOPED regulator audit-pack issuer. tenantId
 *     TEXT NOT NULL, FK→tenants; FORCE RLS on `app.current_tenant_id`.
 *
 * Currency neutrality (CLAUDE.md hard rule): there are NO money columns here.
 * Any monetary fact a funnel event references lives inside the free-form
 * `props` jsonb as minor-units + ISO-4217 currency code — never a typed column.
 *
 * Companion to:
 *   - packages/database/src/migrations/0300_admin_analytics.sql
 *   - services/api-gateway/src/services/activation-events/record-activation-event.ts
 *   - services/api-gateway/src/routes/mining/internal/{analytics,ab-tests,audit-pack}.hono.ts
 */

import {
  pgTable,
  text,
  uuid,
  doublePrecision,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

/**
 * ab_experiments — HQ A/B harness. One row per prompt/model variant trialled
 * for a junior against the golden set + canary tenants. Platform-scoped:
 * `tenantId` is nullable (NULL = fleet-wide); no FK so tenant lifecycle never
 * blocks a platform experiment.
 */
export const abExperiments = pgTable(
  'ab_experiments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL = fleet-wide; non-NULL pins the experiment to one tenant. */
    tenantId: text('tenant_id'),
    /** Human-readable contrast, e.g. "geology v18-rc vs v17". */
    variant: text('variant').notNull(),
    /** Which junior the variant targets (geology|sales|compliance|fx|...). */
    junior: text('junior').notNull(),
    /** Golden-set score in [0,1] (NULL until scored). */
    goldenScore: doublePrecision('golden_score'),
    /** Canary tenant ids the variant is live for. */
    canaryTenants: text('canary_tenants').array().notNull().default([]),
    /** running|won|lost|promoted|archived. */
    status: text('status').notNull().default('running'),
    notes: text('notes'),
    createdBy: text('created_by'),
    /** Set when a winner is promoted via POST /:id/promote-winner. */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index('ab_experiments_status_idx').on(t.status),
    juniorIdx: index('ab_experiments_junior_idx').on(t.junior),
    createdIdx: index('ab_experiments_created_idx').on(t.createdAt),
  }),
);

/**
 * activation_events — product activation/onboarding FUNNEL event log.
 * Append-only; tenant-scoped. The funnel + cohort aggregates replay this.
 */
export const activationEvents = pgTable(
  'activation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * Milestone slug, e.g. signup_completed | licence_created |
     * first_sale_recorded | first_royalty_paid | onboarding_completed.
     */
    eventType: text('event_type').notNull(),
    /** User/actor who triggered the milestone (NULL for system-emitted). */
    actorId: text('actor_id'),
    /**
     * Free-form milestone payload. Any monetary fact lives here as
     * minor-units + ISO-4217 currency code — never a typed money column.
     */
    props: jsonb('props').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('activation_events_tenant_idx').on(t.tenantId),
    tenantTypeIdx: index('activation_events_tenant_type_idx').on(
      t.tenantId,
      t.eventType,
    ),
    typeOccurredIdx: index('activation_events_type_occurred_idx').on(
      t.eventType,
      t.occurredAt,
    ),
    tenantOccurredIdx: index('activation_events_tenant_occurred_idx').on(
      t.tenantId,
      t.occurredAt,
    ),
  }),
);

/**
 * audit_packs — regulator audit-pack issuer. One row per minted pack.
 * Tenant-scoped. `signedUrl` is NULL while `status='pending'` — never
 * fabricated; it lands only after a real storage presign succeeds.
 */
export const auditPacks = pgTable(
  'audit_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Regulator / purpose, e.g. "TMAA Q2 audit" | "NEMC site inspection". */
    regulator: text('regulator').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Wall-clock expiry of the signed URL (NULL until a URL is minted). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Presigned download URL. NULL while status='pending'. */
    signedUrl: text('signed_url'),
    /** pending|ready|expired|revoked. */
    status: text('status').notNull().default('pending'),
    /** Free-form bundle metadata (object key, byte count, evidence counts). */
    metadata: jsonb('metadata').notNull().default({}),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('audit_packs_tenant_idx').on(t.tenantId),
    tenantIssuedIdx: index('audit_packs_tenant_issued_idx').on(
      t.tenantId,
      t.issuedAt,
    ),
    statusIdx: index('audit_packs_status_idx').on(t.status),
  }),
);

export type AbExperimentRow = typeof abExperiments.$inferSelect;
export type ActivationEventRow = typeof activationEvents.$inferSelect;
export type AuditPackRow = typeof auditPacks.$inferSelect;
