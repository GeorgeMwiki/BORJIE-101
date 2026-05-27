/**
 * Safety + CSR — incidents, PPE issues, CSR plans, grievances, village meetings.
 *
 * Per DATA_MODEL.md §3 — safety and community-relations substrate.
 * Mining ops in TZ require demonstrable Local Content + community
 * benefit; these tables are the auditable record.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  smallint,
  jsonb,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { sites } from './sites.schema.js';

export const incidents = pgTable(
  'incidents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    /** safety|environmental|community|near_miss|equipment_failure|fatality. */
    kind: text('kind').notNull(),
    /** low|medium|high|critical. */
    severity: text('severity').notNull().default('low'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    description: text('description'),
    /** Affected user IDs (workers, visitors, community members). */
    affectedUserIds: text('affected_user_ids').array().notNull().default([]),
    fatalities: smallint('fatalities').notNull().default(0),
    injuries: smallint('injuries').notNull().default(0),
    /** PostGIS POINT — exact incident location. GeoJSON string. */
    location: text('location'),
    /** open|under_investigation|closed|escalated_to_OSHA. */
    status: text('status').notNull().default('open'),
    rootCause: text('root_cause'),
    correctiveActions: jsonb('corrective_actions').notNull().default([]),
    reportedByUserId: text('reported_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    photos: text('photos').array().notNull().default([]),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    /** Terminal closure timestamp — non-null iff status = 'closed' (migration 0082). */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** User who closed the incident — non-null iff status = 'closed' (migration 0082). */
    closedByUserId: text('closed_by_user_id'),
    /** Free-text closure justification (migration 0082). */
    closureReason: text('closure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('incidents_tenant_idx').on(t.tenantId),
    siteIdx: index('incidents_site_idx').on(t.siteId),
    kindIdx: index('incidents_kind_idx').on(t.tenantId, t.kind),
    statusIdx: index('incidents_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// ppe_issues — PPE distribution log
// ============================================================================

export const ppeIssues = pgTable(
  'ppe_issues',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    employeeId: text('employee_id'),
    /** boots|helmet|gloves|hi_vis|respirator|earplugs|safety_glasses|harness|... */
    ppeKind: text('ppe_kind').notNull(),
    quantity: smallint('quantity').notNull().default(1),
    unitCostTzs: numeric('unit_cost_tzs', { precision: 12, scale: 2 }),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    issuedByUserId: text('issued_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Replacement-due date (e.g. boots every 6 months). */
    nextDueOn: date('next_due_on'),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    notes: text('notes'),
  },
  (t) => ({
    tenantIdx: index('ppe_issues_tenant_idx').on(t.tenantId),
    employeeIdx: index('ppe_issues_employee_idx').on(t.employeeId),
    dueIdx: index('ppe_issues_due_idx').on(t.tenantId, t.nextDueOn),
  }),
);

// ============================================================================
// csr_plans — Corporate Social Responsibility commitments
// ============================================================================

export const csrPlans = pgTable(
  'csr_plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** education|water|health|roads|markets|land_rehab|youth|other. */
    category: text('category').notNull(),
    description: text('description'),
    budgetTzs: numeric('budget_tzs', { precision: 18, scale: 2 }),
    spentTzs: numeric('spent_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    plannedStart: date('planned_start'),
    plannedEnd: date('planned_end'),
    actualStart: date('actual_start'),
    actualEnd: date('actual_end'),
    /** draft|approved|in_progress|completed|cancelled. */
    status: text('status').notNull().default('draft'),
    villageId: text('village_id'),
    beneficiariesCount: smallint('beneficiaries_count'),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    /**
     * Derived delivery percentage (migration 0082).
     *
     * GENERATED ALWAYS AS (
     *   LEAST(100.00, GREATEST(0.00,
     *     ROUND((COALESCE(spent_tzs, 0) / NULLIF(budget_tzs, 0)) * 100, 2)
     *   ))
     * ) STORED.
     *
     * Read-only column; INSERT/UPDATE must NOT supply a value.
     */
    deliveredPct: numeric('delivered_pct', { precision: 5, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('csr_plans_tenant_idx').on(t.tenantId),
    siteIdx: index('csr_plans_site_idx').on(t.siteId),
    statusIdx: index('csr_plans_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// grievances — community / worker complaints
// ============================================================================

export const grievances = pgTable(
  'grievances',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    /** worker|villager|landowner|community_leader|local_govt|ngo. */
    raisedByKind: text('raised_by_kind').notNull(),
    raisedByName: text('raised_by_name'),
    raisedByContact: text('raised_by_contact'),
    /** noise|dust|water|land|wages|housing|access|other. */
    category: text('category').notNull(),
    summary: text('summary'),
    /** open|acknowledged|in_resolution|resolved|escalated|withdrawn. */
    status: text('status').notNull().default('open'),
    raisedAt: timestamp('raised_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
  },
  (t) => ({
    tenantIdx: index('grievances_tenant_idx').on(t.tenantId),
    siteIdx: index('grievances_site_idx').on(t.siteId),
    statusIdx: index('grievances_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// village_meetings — minuted community engagements
// ============================================================================

export const villageMeetings = pgTable(
  'village_meetings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    villageName: text('village_name').notNull(),
    /** PostGIS POINT. GeoJSON string. */
    location: text('location'),
    meetingDate: date('meeting_date').notNull(),
    /** scheduled|held|cancelled|deferred. */
    status: text('status').notNull().default('scheduled'),
    chairedByName: text('chaired_by_name'),
    attendees: smallint('attendees'),
    /** Agreed-actions checklist. */
    resolutions: jsonb('resolutions').notNull().default([]),
    minutesDocId: text('minutes_doc_id'),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('village_meetings_tenant_idx').on(t.tenantId),
    siteIdx: index('village_meetings_site_idx').on(t.siteId),
    dateIdx: index('village_meetings_date_idx').on(t.tenantId, t.meetingDate),
  }),
);

export type Incident = typeof incidents.$inferSelect;
export type PpeIssue = typeof ppeIssues.$inferSelect;
export type CsrPlan = typeof csrPlans.$inferSelect;
export type Grievance = typeof grievances.$inferSelect;
export type VillageMeeting = typeof villageMeetings.$inferSelect;
