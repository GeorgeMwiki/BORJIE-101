/**
 * Junior Architecture persistence (Wave 18V).
 *
 * Companion to docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md. Drizzle types
 * for the 2 tables created by migration 0025_junior_architecture.sql:
 *
 *   - juniorPersonas — global registry of JuniorPersona values
 *   - agentTurns     — tenant-scoped per-turn ledger linked to
 *                      cognitive_turns (Wave 18T)
 *
 * juniorPersonas is global product config — no tenant_id, RLS off in
 * the migration. agentTurns is tenant-scoped; RLS uses the canonical
 * `app.tenant_id` GUC pattern.
 *
 * Identity discipline — singular `Mr. Mwikila` display name:
 *
 *   Every junior renders as "Mr. Mwikila" to the user (see
 *   `MR_MWIKILA_DISPLAY_NAME` in `@borjie/agent-platform`). The
 *   `display_name` column is therefore effectively a constant — kept
 *   for backward-compat with rows already written to existing
 *   environments. New / live rendering MUST use the singular constant
 *   from the agent-platform package and read `specialisation` for the
 *   chip + `title` for the subtitle.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// junior_personas — platform-level registry (GLOBAL)
// ============================================================================

export const juniorPersonas = pgTable(
  'junior_personas',
  {
    /** Stable junior id — e.g. 'mining-shift-planner'. English-named. */
    id: text('id').primaryKey(),
    /**
     * Deprecated — historically held a per-junior character name. After
     * the founder directive, every junior renders as the singular
     * `MR_MWIKILA_DISPLAY_NAME` constant from `@borjie/agent-platform`.
     * Kept here for backward compatibility with rows already written
     * to existing environments; new code MUST NOT read this column for
     * the user-facing display name.
     */
    // always 'Mr. Mwikila' — see CAPABILITIES_UNIFICATION
    displayName: text('display_name').notNull(),
    /**
     * Short specialisation label — e.g. `'Mining Safety'`,
     * `'Geology'`, `'FX Treasury'`. Rendered as the chip next to the
     * singular `Mr. Mwikila` display name. Defaults to empty string
     * for legacy rows; new persona registrations populate this.
     */
    specialisation: text('specialisation').notNull().default(''),
    /** Title — e.g. "Borjie's AI Mining Shift Specialist". */
    title: text('title').notNull(),
    /** First-person mandate string. */
    mandate: text('mandate').notNull(),
    /** sw | en | fr. */
    defaultLanguage: text('default_language').notNull().default('en'),
    /** Subset of Audience — { owner | admin | manager | employee | customer | regulator }. */
    targetAudiences: text('target_audiences').array().notNull(),
    /** JuniorScope shape — see junior-contract.ts. */
    scope: jsonb('scope').notNull(),
    /** EscalationPolicy shape — see junior-contract.ts. */
    escalationPolicy: jsonb('escalation_policy').notNull(),
    brand: text('brand').notNull().default('borjie'),
    version: integer('version').notNull().default(1),
    registeredAt: timestamp('registered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    brandIdx: index('junior_personas_brand_idx').on(t.brand),
  }),
);

// ============================================================================
// agent_turns — tenant-scoped per-turn ledger
// ============================================================================

export const agentTurns = pgTable(
  'agent_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    /** 'mr-mwikila' OR a junior persona id. */
    agentId: text('agent_id').notNull(),
    /** owner | admin | manager | employee | customer | regulator | public. */
    audience: text('audience').notNull(),
    wasEscalationToMd: boolean('was_escalation_to_md').notNull().default(false),
    /**
     * Wave 18T cognitive-engine linkage. Nullable because the cognitive
     * engine ships after the junior architecture is wired; legacy turns
     * may pre-date the engine.
     */
    cognitiveTurnId: uuid('cognitive_turn_id'),
    /** Recipe ref / mutation proposal ref / doc ref / media ref. */
    artifactRef: jsonb('artifact_ref'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionIdx: index('agent_turns_session_idx').on(t.sessionId, t.occurredAt),
    mdVisibilityIdx: index('agent_turns_md_visibility_idx').on(
      t.tenantId,
      t.agentId,
      t.occurredAt,
    ),
    cognitiveTurnIdx: index('agent_turns_cognitive_turn_idx').on(
      t.cognitiveTurnId,
    ),
    escalationIdx: index('agent_turns_escalation_idx').on(
      t.tenantId,
      t.wasEscalationToMd,
      t.occurredAt,
    ),
  }),
);
