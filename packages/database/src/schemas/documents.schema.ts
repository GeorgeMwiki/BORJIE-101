/**
 * Document Intelligence Schemas
 * Document uploads, OCR extraction, identity verification
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  decimal,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';
// NOTE: legacy BossNyumba `customers` table removed. customerId stays as a
// plain text column (no FK) — Borjie resolves it at the application layer.

// ============================================================================
// Enums
// ============================================================================

export const documentTypeEnum = pgEnum('document_type', [
  'national_id',
  'passport',
  'driving_license',
  'work_permit',
  'residence_permit',
  'utility_bill',
  'bank_statement',
  'employment_letter',
  'lease_agreement',
  'move_in_report',
  'move_out_report',
  'maintenance_photo',
  'receipt',
  'notice',
  'other',
]);

export const documentStatusEnum = pgEnum('document_status', [
  'pending_upload',
  'uploaded',
  'processing',
  'ocr_complete',
  'validated',
  'rejected',
  'expired',
  'archived',
]);

export const documentSourceEnum = pgEnum('document_source', [
  'whatsapp',
  'app_upload',
  'email',
  'scan',
  'api',
  'manual',
]);

export const verificationStatusEnum = pgEnum('verification_status', [
  'pending',
  'in_review',
  'verified',
  'partially_verified',
  'rejected',
  'expired',
  'manual_override',
]);

export const badgeTypeEnum = pgEnum('badge_type', [
  'identity_verified',
  'address_verified',
  'income_verified',
  'employer_verified',
  'references_verified',
  'kyc_complete',
  'premium_tenant',
]);

export const fraudRiskLevelEnum = pgEnum('fraud_risk_level', [
  'low',
  'medium',
  'high',
  'critical',
]);

// ============================================================================
// Document Uploads Table
// ============================================================================

export const documentUploads = pgTable(
  'document_uploads',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: text('customer_id'),

    documentType: documentTypeEnum('document_type').notNull(),
    status: documentStatusEnum('status').notNull().default('uploaded'),
    source: documentSourceEnum('source').notNull().default('app_upload'),
    
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type').notNull(),
    fileUrl: text('file_url').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    
    qualityScore: decimal('quality_score', { precision: 5, scale: 2 }),
    qualityIssues: jsonb('quality_issues').default([]),
    qualityAssessedAt: timestamp('quality_assessed_at', { withTimezone: true }),
    
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    
    metadata: jsonb('metadata').default({}),
    tags: jsonb('tags').default([]),
    
    ocrExtractionId: text('ocr_extraction_id'),
    
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedBy: text('rejected_by'),
    rejectionReason: text('rejection_reason'),
    
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    expiryReminderSent: boolean('expiry_reminder_sent').notNull().default(false),
    expiryReminderSentAt: timestamp('expiry_reminder_sent_at', { withTimezone: true }),
    
    version: integer('version').notNull().default(1),
    previousVersionId: text('previous_version_id'),
    accessLevel: text('access_level').default('private'),
    
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => ({
    tenantIdx: index('document_uploads_tenant_idx').on(table.tenantId),
    customerIdx: index('document_uploads_customer_idx').on(table.customerId),
    typeIdx: index('document_uploads_type_idx').on(table.documentType),
    statusIdx: index('document_uploads_status_idx').on(table.status),
    entityIdx: index('document_uploads_entity_idx').on(table.entityType, table.entityId),
    expiresAtIdx: index('document_uploads_expires_at_idx').on(table.expiresAt),
  })
);

// ============================================================================
// OCR Extractions Table
// ============================================================================

export const ocrExtractions = pgTable(
  'ocr_extractions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    documentUploadId: text('document_upload_id').notNull().references(() => documentUploads.id, { onDelete: 'cascade' }),
    
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processingCompletedAt: timestamp('processing_completed_at', { withTimezone: true }),
    processingDurationMs: integer('processing_duration_ms'),
    
    ocrProvider: text('ocr_provider').notNull(),
    providerResponse: jsonb('provider_response').default({}),
    
    extractedFields: jsonb('extracted_fields').notNull().default({}),
    confidenceScores: jsonb('confidence_scores').default({}),
    overallConfidence: decimal('overall_confidence', { precision: 5, scale: 4 }),
    rawText: text('raw_text'),
    
    validationStatus: text('validation_status').default('pending'),
    validationErrors: jsonb('validation_errors').default([]),
    
    manualCorrections: jsonb('manual_corrections').default({}),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    correctedBy: text('corrected_by'),
    
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('ocr_extractions_tenant_idx').on(table.tenantId),
    documentUploadIdx: index('ocr_extractions_document_upload_idx').on(table.documentUploadId),
    providerIdx: index('ocr_extractions_provider_idx').on(table.ocrProvider),
    validationStatusIdx: index('ocr_extractions_validation_status_idx').on(table.validationStatus),
  })
);

// ============================================================================
// Identity Profiles Table
// ============================================================================

export const identityProfiles = pgTable(
  'identity_profiles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: text('customer_id').notNull(),

    fullName: text('full_name'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    middleName: text('middle_name'),
    dateOfBirth: timestamp('date_of_birth', { withTimezone: true }),
    nationality: text('nationality'),
    gender: text('gender'),
    
    primaryIdType: text('primary_id_type'),
    primaryIdNumber: text('primary_id_number'),
    primaryIdExpiresAt: timestamp('primary_id_expires_at', { withTimezone: true }),
    secondaryIds: jsonb('secondary_ids').default([]),
    
    verifiedAddress: jsonb('verified_address').default({}),
    verifiedEmployer: text('verified_employer'),
    verifiedPosition: text('verified_position'),
    verifiedIncome: integer('verified_income'),
    
    verificationStatus: verificationStatusEnum('verification_status').notNull().default('pending'),
    verificationLevel: integer('verification_level').notNull().default(0),
    
    consistencyScore: decimal('consistency_score', { precision: 5, scale: 4 }),
    consistencyIssues: jsonb('consistency_issues').default([]),
    
    fraudRiskLevel: fraudRiskLevelEnum('fraud_risk_level').notNull().default('low'),
    fraudRiskScore: decimal('fraud_risk_score', { precision: 5, scale: 4 }).default('0'),
    fraudIndicators: jsonb('fraud_indicators').default([]),
    
    potentialDuplicates: jsonb('potential_duplicates').default([]),
    
    watchlistCheckedAt: timestamp('watchlist_checked_at', { withTimezone: true }),
    watchlistStatus: text('watchlist_status').default('not_checked'),
    watchlistMatches: jsonb('watchlist_matches').default([]),
    
    sourceDocuments: jsonb('source_documents').default([]),
    
    lastReviewAt: timestamp('last_review_at', { withTimezone: true }),
    lastReviewBy: text('last_review_by'),
    reviewNotes: text('review_notes'),
    
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
  },
  (table) => ({
    tenantIdx: index('identity_profiles_tenant_idx').on(table.tenantId),
    customerIdx: uniqueIndex('identity_profiles_customer_idx').on(table.tenantId, table.customerId),
    verificationStatusIdx: index('identity_profiles_verification_status_idx').on(table.verificationStatus),
    fraudRiskLevelIdx: index('identity_profiles_fraud_risk_level_idx').on(table.fraudRiskLevel),
    primaryIdNumberIdx: index('identity_profiles_primary_id_number_idx').on(table.tenantId, table.primaryIdNumber),
  })
);

// ============================================================================
// Verification Badges Table
// ============================================================================

export const verificationBadges = pgTable(
  'verification_badges',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: text('customer_id').notNull(),
    identityProfileId: text('identity_profile_id').references(() => identityProfiles.id, { onDelete: 'set null' }),
    
    badgeType: badgeTypeEnum('badge_type').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull(),
    awardedBy: text('awarded_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    revocationReason: text('revocation_reason'),
    
    evidenceDocuments: jsonb('evidence_documents').default([]),
    verificationMethod: text('verification_method'),
    metadata: jsonb('metadata').default({}),
    
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('verification_badges_tenant_idx').on(table.tenantId),
    customerIdx: index('verification_badges_customer_idx').on(table.customerId),
    badgeTypeIdx: index('verification_badges_badge_type_idx').on(table.badgeType),
    activeIdx: index('verification_badges_active_idx').on(table.isActive),
  })
);

// ============================================================================
// Document Access Logs (Audit)
// ============================================================================

export const documentAccessLogs = pgTable(
  'document_access_logs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    documentUploadId: text('document_upload_id').notNull(),
    
    accessedBy: text('accessed_by').notNull(),
    accessedByType: text('accessed_by_type').notNull(),
    action: text('action').notNull(),
    
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    purpose: text('purpose'),
    
    accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('document_access_logs_tenant_idx').on(table.tenantId),
    documentUploadIdx: index('document_access_logs_document_upload_idx').on(table.documentUploadId),
    accessedByIdx: index('document_access_logs_accessed_by_idx').on(table.accessedBy),
    accessedAtIdx: index('document_access_logs_accessed_at_idx').on(table.accessedAt),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const documentUploadsRelations = relations(documentUploads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [documentUploads.tenantId],
    references: [tenants.id],
  }),
  ocrExtraction: one(ocrExtractions, {
    fields: [documentUploads.id],
    references: [ocrExtractions.documentUploadId],
  }),
  previousVersion: one(documentUploads, {
    fields: [documentUploads.previousVersionId],
    references: [documentUploads.id],
    relationName: 'documentVersions',
  }),
}));

export const ocrExtractionsRelations = relations(ocrExtractions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [ocrExtractions.tenantId],
    references: [tenants.id],
  }),
  documentUpload: one(documentUploads, {
    fields: [ocrExtractions.documentUploadId],
    references: [documentUploads.id],
  }),
}));

export const identityProfilesRelations = relations(identityProfiles, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [identityProfiles.tenantId],
    references: [tenants.id],
  }),
  badges: many(verificationBadges),
}));

export const verificationBadgesRelations = relations(verificationBadges, ({ one }) => ({
  tenant: one(tenants, {
    fields: [verificationBadges.tenantId],
    references: [tenants.id],
  }),
  identityProfile: one(identityProfiles, {
    fields: [verificationBadges.identityProfileId],
    references: [identityProfiles.id],
  }),
}));
