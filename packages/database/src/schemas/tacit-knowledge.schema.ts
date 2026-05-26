/**
 * Tacit Knowledge Harvest persistence (Wave HARVEST).
 *
 * Companion to Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md. Drizzle
 * types for the 3 tables created by migration 0044_tacit_knowledge.sql:
 *
 *   - tacitInterviews   → one row per harvest session (one of five
 *                          modes). transcript is jsonb; location_geog
 *                          is the session anchor (Point, 4326).
 *                          Tenant-scoped, RLS.
 *   - tacitExtractions  → one row per extracted know-how artifact.
 *                          Links to tacitInterviews.id. Carries
 *                          entity_kind, jsonb entity, confidence,
 *                          novel, redundant_with_cell_id,
 *                          persisted_cell_id. Tenant-scoped, RLS.
 *   - tacitConsents     → one row per (subject_user_id, tenant_id).
 *                          PK on both columns. Default 'granted'.
 *                          Tenant-scoped, RLS.
 *
 * RLS uses the canonical `app.tenant_id` GUC. Migration is idempotent.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  real,
  boolean,
  customType,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

/**
 * Custom Drizzle column wrapping pgvector PostGIS `geography(POINT, 4326)`.
 * Stored as `geography(POINT, 4326)` in Postgres; serialised on the wire
 * as the canonical EWKT `POINT(lng lat)` form (mirrors the pattern used
 * by mining-domain location columns in migration 0003).
 */
const geographyPoint = customType<{
  data: { lat: number; lng: number };
  driverData: string;
}>({
  dataType() {
    return 'geography(POINT, 4326)';
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value) {
    // Pg returns hex-WKB for geography by default; for the Drizzle path we
    // rely on PostGIS ST_AsText() projection at the query layer. The
    // fromDriver is left as a passthrough; callers normalise upstream.
    const match = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(value);
    if (!match || match[1] === undefined || match[2] === undefined) {
      return { lat: 0, lng: 0 };
    }
    return { lng: Number(match[1]), lat: Number(match[2]) };
  },
});

// ============================================================================
// tacit_interviews — one row per harvest session
// ============================================================================

export const tacitInterviews = pgTable(
  'tacit_interviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** The person whose tacit knowledge is being harvested. Role-agnostic. */
    subjectUserId: uuid('subject_user_id').notNull(),
    /** Always 'mr-mwikila' by default; left mutable for co-interviewers. */
    interviewer: text('interviewer').notNull().default('mr-mwikila'),
    /**
     * One of the five mode shapes:
     * 'walk-the-floor' | 'post-incident' | 'ride-along' | 'deal-replay' |
     * 'cross-role'.
     */
    mode: text('mode').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /**
     * 'running' | 'ended_ok' | 'ended_revoked' | 'ended_error'.
     */
    status: text('status').notNull().default('running'),
    /**
     * Ordered turns:
     * [{ speaker, text, at, gps?: { lat, lng } }, ...].
     */
    transcript: jsonb('transcript').notNull().default([]),
    /** Session anchor — null when no canonical location. */
    locationGeog: geographyPoint('location_geog'),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (t) => ({
    tenantSubjectIdx: index('idx_ti_tenant_subject').on(
      t.tenantId,
      t.subjectUserId,
      t.startedAt,
    ),
    tenantModeIdx: index('idx_ti_tenant_mode').on(
      t.tenantId,
      t.mode,
      t.startedAt,
    ),
    statusIdx: index('idx_ti_status').on(
      t.tenantId,
      t.status,
      t.startedAt,
    ),
  }),
);

export type TacitInterviewRow = typeof tacitInterviews.$inferSelect;
export type TacitInterviewInsert = typeof tacitInterviews.$inferInsert;

// ============================================================================
// tacit_extractions — one row per extracted know-how artifact
// ============================================================================

export const tacitExtractions = pgTable(
  'tacit_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    interviewId: uuid('interview_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /**
     * Maps to one of the eight cognitive-memory MemoryKinds:
     * 'pattern' | 'fact' | 'rule' | 'preference' | 'template' |
     * 'citation' | 'failure' | 'terminology'.
     */
    entityKind: text('entity_kind').notNull(),
    /** Extracted payload — text, structured fields, citations. */
    entity: jsonb('entity').notNull(),
    confidence: real('confidence').notNull(),
    /** Extractor's own novelty claim; redundancy-checker may flip it. */
    novel: boolean('novel').notNull().default(true),
    /** Set by redundancy checker when matched against existing cell. */
    redundantWithCellId: uuid('redundant_with_cell_id'),
    /** Set by cell-writer once persisted into cognitive-memory. */
    persistedCellId: uuid('persisted_cell_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    interviewIdx: index('idx_te_interview').on(t.interviewId, t.createdAt),
    tenantKindIdx: index('idx_te_tenant_kind').on(
      t.tenantId,
      t.entityKind,
      t.createdAt,
    ),
  }),
);

export type TacitExtractionRow = typeof tacitExtractions.$inferSelect;
export type TacitExtractionInsert = typeof tacitExtractions.$inferInsert;

// ============================================================================
// tacit_consents — one row per (subject, tenant)
// ============================================================================

export const tacitConsents = pgTable(
  'tacit_consents',
  {
    subjectUserId: uuid('subject_user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** 'granted' (default) | 'revoked'. */
    status: text('status').notNull().default('granted'),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subjectUserId, t.tenantId] }),
    tenantStatusIdx: index('idx_tc_tenant_status').on(t.tenantId, t.status),
  }),
);

export type TacitConsentRow = typeof tacitConsents.$inferSelect;
export type TacitConsentInsert = typeof tacitConsents.$inferInsert;
