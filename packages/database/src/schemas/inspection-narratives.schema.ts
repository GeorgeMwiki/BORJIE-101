/**
 * inspection_narratives — AI-assisted inspection-report drafts.
 *
 * Companion to:
 *   - packages/database/src/migrations/0136_inspection_narratives.sql
 *   - services/api-gateway/src/services/inspection-narrative/generator.ts
 *   - services/api-gateway/src/routes/compliance/inspections.hono.ts
 *   - apps/workforce-mobile/app/(manager)/inspection/[id]/narrative.tsx
 *
 * One row per inspection that has had a narrative drafted. The
 * generator persists the LLM output here, the manager approves it,
 * the owner signs the canonical PDF, and the final artifact ships to
 * the regulator with C2PA-signed photo references stapled.
 *
 * Tenant scope: enforced via RLS (FORCE) on `tenant_id`.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  bigint,
  index,
} from 'drizzle-orm/pg-core';

// ----------------------------------------------------------------------------
// Enum-style string-literal unions
// ----------------------------------------------------------------------------

export const INSPECTION_NARRATIVE_KINDS = [
  'environmental',
  'safety',
  'financial',
  'other',
] as const;
export type InspectionNarrativeKind =
  (typeof INSPECTION_NARRATIVE_KINDS)[number];

export const INSPECTION_NARRATIVE_STATUSES = [
  'draft',
  'manager_ok',
  'owner_signed',
  'submitted',
  'delivered',
  'superseded',
] as const;
export type InspectionNarrativeStatus =
  (typeof INSPECTION_NARRATIVE_STATUSES)[number];

export const INSPECTION_NARRATIVE_REGULATORS = [
  'pccb',
  'nemc',
  'tmaa',
  'osha',
  'none',
] as const;
export type InspectionNarrativeRegulator =
  (typeof INSPECTION_NARRATIVE_REGULATORS)[number];

// ----------------------------------------------------------------------------
// Table
// ----------------------------------------------------------------------------

export const inspectionNarratives = pgTable(
  'inspection_narratives',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    /** environmental | safety | financial | other. */
    inspectionKind: text('inspection_kind').notNull().default('safety'),
    /** State machine — see migration 0136. */
    status: text('status').notNull().default('draft'),
    /** Swahili-first Markdown narrative — primary output. */
    draftMdSw: text('draft_md_sw').notNull(),
    /** English Markdown — generated alongside. */
    draftMdEn: text('draft_md_en').notNull(),
    llmProvider: text('llm_provider'),
    llmModel: text('llm_model'),
    promptVersion: text('prompt_version').notNull().default('v1'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    managerOkAt: timestamp('manager_ok_at', { withTimezone: true }),
    managerOkBy: text('manager_ok_by'),
    ownerSignedAt: timestamp('owner_signed_at', { withTimezone: true }),
    ownerSignedBy: text('owner_signed_by'),
    /** SHA-256 of the canonical PDF — owner sig anchor. */
    ownerSigSha256: text('owner_sig_sha256'),
    regulatorSentAt: timestamp('regulator_sent_at', { withTimezone: true }),
    regulator: text('regulator'),
    regulatorRef: text('regulator_ref'),
    auditChainSeq: bigint('audit_chain_seq', { mode: 'number' }),
    managerNotes: text('manager_notes'),
    supersededById: text('superseded_by_id'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('inspection_narratives_tenant_idx').on(
      t.tenantId,
      t.generatedAt,
    ),
    inspectionIdx: index('inspection_narratives_inspection_idx').on(
      t.tenantId,
      t.inspectionId,
    ),
    statusIdx: index('inspection_narratives_status_idx').on(
      t.tenantId,
      t.status,
    ),
  }),
);

// ----------------------------------------------------------------------------
// Type re-exports
// ----------------------------------------------------------------------------

export type InspectionNarrativeRow =
  typeof inspectionNarratives.$inferSelect;
export type NewInspectionNarrativeRow =
  typeof inspectionNarratives.$inferInsert;
