/**
 * Onboarding-session durable store (RSS-09).
 *
 * Companion to `services/api-gateway/src/routes/onboarding.ts`, whose
 * `OnboardingRepository` (the move-in / tenant onboarding state machine in
 * `@borjie/domain-services/onboarding`) was previously backed ONLY by a
 * process-level in-memory `Map` triple. That made every session WIPED on each
 * gateway restart and INVISIBLE across replicas (MASTER_GAP_REGISTER RSS-09:
 * "multi-step onboarding breaks across replicas/rollout").
 *
 * This single tenant-scoped table backs the durable Drizzle counterpart of the
 * repository, selected at request time when a live DB handle is present AND the
 * `ONBOARDING_SESSION_STORE=drizzle` flag is set — so the onboarding state
 * SURVIVES a process restart and is SHARED across replicas. With the flag at
 * its default (`memory`) the in-memory repo is retained verbatim, so merging
 * this code changes NOTHING at runtime until the flag is flipped.
 *
 * Storage model: the `OnboardingSession` aggregate (checklist, procedure log,
 * move-in report, utility records, …) is large and rarely queried by anything
 * other than its three lookup keys (id, customer, lease). So the queryable
 * keys are first-class columns and the rest of the aggregate is a single
 * `payload` jsonb document. The Drizzle repo rehydrates the full aggregate
 * from `payload` and uses the columns only for the three `findBy*` lookups.
 *
 * Security model (CLAUDE.md hard rule): tenant-scoped (`tenant_id` TEXT, no FK
 * — same shape as the cognitive_memory_* / memory_v2_* families, migrations
 * 0309 / 0312). Migration 0314 FORCE-enables RLS with a tenant-isolation
 * policy on the canonical `app.current_tenant_id` GUC (bare compare, no cast;
 * NEVER the legacy `app.tenant_id`) plus a service-role bypass mirroring 0309
 * so composition-root system reads (withServiceRoleContext) are permitted. The
 * `(tenant_id, id)` composite PK enforces per-tenant uniqueness the same way
 * the old in-memory `${tenantId}::${id}` composite key did.
 *
 * Companion files:
 *   - migration 0314_onboarding_session_store.sql
 *   - services/api-gateway/src/routes/onboarding-session-store.ts (Drizzle repo)
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ─── onboarding_sessions ──────────────────────────────────────────────────────

export const onboardingSessions = pgTable(
  'onboarding_sessions',
  {
    /** Tenant anchor — first half of the composite PK; drives RLS isolation. */
    tenantId: text('tenant_id').notNull(),
    /** OnboardingSessionId (`onb_…`). Second half of the composite PK. */
    id: text('id').notNull(),
    /** Lookup key — `findByCustomer`. */
    customerId: text('customer_id').notNull(),
    /** Lookup key — `findByLease`. */
    leaseId: text('lease_id').notNull(),
    /** Denormalised state-machine state (audit / ops visibility; not load-bearing). */
    state: text('state').notNull(),
    /**
     * The full `OnboardingSession` aggregate minus the columns above —
     * checklist, procedure log, move-in report, utility records, language,
     * channel, audit stamps, etc. Rehydrated verbatim by the Drizzle repo.
     */
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Composite PK — mirrors the old in-memory `${tenantId}::${id}` key. */
    pk: primaryKey({ columns: [t.tenantId, t.id] }),
    /** `findByCustomer` access path. */
    customerIdx: index('idx_onboarding_sessions_tenant_customer').on(
      t.tenantId,
      t.customerId,
    ),
    /** `findByLease` access path. */
    leaseIdx: index('idx_onboarding_sessions_tenant_lease').on(
      t.tenantId,
      t.leaseId,
    ),
  }),
);

export type OnboardingSessionStoreRow = typeof onboardingSessions.$inferSelect;
export type NewOnboardingSessionStoreRow =
  typeof onboardingSessions.$inferInsert;
