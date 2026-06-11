/**
 * Owner governance preferences persistence — the per-tenant governance
 * set-points the LIVING-MD organ reads FRESH on every tick (never cached).
 *
 * Companion to migration 0340_owner_governance_preferences.sql and the
 * `createGovernanceStore` port
 * (services/api-gateway/src/composition/living-md/governance-store.ts).
 *
 * One row per tenant. Upsert-only at the app layer. The owner-tunable knobs
 * MUST take effect immediately — lowering `autonomyCap` mid-session clamps the
 * very next reconcile tick (the owner pulling back the MD's leash is felt at
 * once). The store therefore reads this row FRESH each tick with zero cache.
 *
 *   - `autonomyCap` — the graded-corrective ceiling (observe | nudge | draft |
 *     delegate). Clamped in code, never raised above 'delegate' (the
 *     owner-direct safe-halt, itself a HITL park). The MD never auto-actuates a
 *     sovereign action regardless of this cap.
 *   - `somedayReviewCadenceDays` — how often the someday-review supervisor
 *     resurfaces deferred long-horizon items for owner re-review (default 7).
 *   - `evidenceRequirementEnforced` — the Auditor's empty-evidence-chain reject
 *     (default true — the CLAUDE.md evidence-required hard rule; the app layer
 *     never relaxes it below the platform floor).
 *   - `confirmationProbeMappings` — commitment kind → the positive-proof
 *     confirmationKind the MD probes for on closure (closure-by-confirmation).
 *
 * Tenant-scoped, RLS FORCE (canonical `app.current_tenant_id` GUC +
 * service-role bypass for the out-of-band supervisor), migration 0340. An
 * absent row resolves to safe defaults in code — the store never assumes a row.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

/** The graded-corrective ceiling (clamped ≤ delegate in code). */
export type OwnerAutonomyCap = 'observe' | 'nudge' | 'draft' | 'delegate';

// ============================================================================
// owner_governance_preferences — one row per tenant; upsert-only.
// ============================================================================

export const ownerGovernancePreferences = pgTable(
  'owner_governance_preferences',
  {
    tenantId: text('tenant_id').primaryKey(),
    /** Graded-corrective ceiling — clamped ≤ 'delegate'. */
    autonomyCap: text('autonomy_cap')
      .$type<OwnerAutonomyCap>()
      .notNull()
      .default('delegate'),
    /** Someday-review resurfacing cadence (days). Clamped 1..365. */
    somedayReviewCadenceDays: integer('someday_review_cadence_days')
      .notNull()
      .default(7),
    /** The evidence-required hard rule toggle (never relaxed below floor in app). */
    evidenceRequirementEnforced: boolean('evidence_requirement_enforced')
      .notNull()
      .default(true),
    /** Commitment kind → positive-proof confirmationKind probe map. */
    confirmationProbeMappings: jsonb('confirmation_probe_mappings')
      .$type<Readonly<Record<string, string>>>()
      .notNull()
      .default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type OwnerGovernancePreferencesRow =
  typeof ownerGovernancePreferences.$inferSelect;
export type OwnerGovernancePreferencesInsert =
  typeof ownerGovernancePreferences.$inferInsert;
