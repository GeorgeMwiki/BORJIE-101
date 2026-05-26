/**
 * Communications Schemas
 * Message templates, instances, and delivery tracking
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';
// NOTE: legacy pre-Borjie `customers` table removed. customerId remains as
// a plain text column (no FK) for Borjie mining-domain compatibility.

// ============================================================================
// Enums
// ============================================================================

export const messageChannelEnum = pgEnum('message_channel', [
  'whatsapp',
  'sms',
  'email',
  'app_push',
  'voice_call',
  'in_app',
]);

export const templateCategoryEnum = pgEnum('template_category', [
  'payment_reminder',
  'payment_confirmation',
  'maintenance_update',
  'lease_notification',
  'onboarding',
  'renewal',
  'legal_notice',
  'emergency',
  'announcement',
  'marketing',
  'feedback_request',
  'check_in',
  'welcome',
  'other',
]);

export const templateStatusEnum = pgEnum('template_status', [
  'draft',
  'pending_approval',
  'approved',
  'active',
  'deprecated',
  'archived',
]);

export const messageStatusEnum = pgEnum('message_status', [
  'queued',
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
  'bounced',
  'blocked',
  'expired',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
  'bounced',
  'blocked',
  'expired',
  'unknown',
]);

// ============================================================================
// Message Templates Table
// ============================================================================

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    
    // Identity
    templateCode: text('template_code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    
    // Classification
    category: templateCategoryEnum('category').notNull(),
    status: templateStatusEnum('status').notNull().default('draft'),
    
    // Channel support
    supportedChannels: jsonb('supported_channels').notNull().default([]),
    
    // Content variants by channel
    whatsappContent: jsonb('whatsapp_content').default({}),
    smsContent: text('sms_content'),
    emailSubject: text('email_subject'),
    emailHtmlContent: text('email_html_content'),
    emailTextContent: text('email_text_content'),
    pushTitle: text('push_title'),
    pushBody: text('push_body'),
    voiceScript: text('voice_script'),
    
    // Variables
    variables: jsonb('variables').default([]),
    requiredVariables: jsonb('required_variables').default([]),
    
    // Language support
    defaultLanguage: text('default_language').default('en'),
    translations: jsonb('translations').default({}),
    
    // Policy
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approvalLevel: text('approval_level'),
    
    // Timing constraints
    quietHoursExempt: boolean('quiet_hours_exempt').notNull().default(false),
    
    // Version
    version: integer('version').notNull().default(1),
    previousVersionId: text('previous_version_id'),
    
    // Approval
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    
    // Tags
    tags: jsonb('tags').default([]),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => ({
    tenantIdx: index('message_templates_tenant_idx').on(table.tenantId),
    codeTenantIdx: uniqueIndex('message_templates_code_tenant_idx').on(table.tenantId, table.templateCode),
    categoryIdx: index('message_templates_category_idx').on(table.category),
    statusIdx: index('message_templates_status_idx').on(table.status),
  })
);

// ============================================================================
// Message Instances Table
// ============================================================================

export const messageInstances = pgTable(
  'message_instances',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: text('customer_id'),
    templateId: text('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
    
    // Identity
    messageRef: text('message_ref').notNull(),
    
    // Channel
    channel: messageChannelEnum('channel').notNull(),
    
    // Recipient
    recipientName: text('recipient_name'),
    recipientAddress: text('recipient_address').notNull(),
    recipientType: text('recipient_type').default('customer'),
    
    // Content
    subject: text('subject'),
    content: text('content').notNull(),
    htmlContent: text('html_content'),
    
    // Personalization
    variables: jsonb('variables').default({}),
    
    // Language
    language: text('language').default('en'),
    
    // Status
    status: messageStatusEnum('status').notNull().default('queued'),
    
    // Trigger
    triggerType: text('trigger_type'),
    triggerEntityType: text('trigger_entity_type'),
    triggerEntityId: text('trigger_entity_id'),
    
    // Scheduling
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    
    // Sending
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentBy: text('sent_by'),
    
    // Provider
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    providerResponse: jsonb('provider_response').default({}),
    
    // Cost
    cost: integer('cost'),
    costCurrency: text('cost_currency'),
    
    // Retry
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').default(3),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    
    // Failure
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    failureCode: text('failure_code'),
    
    // Expiry
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    
    // Priority
    priority: integer('priority').default(5),
    
    // Metadata
    metadata: jsonb('metadata').default({}),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => ({
    tenantIdx: index('message_instances_tenant_idx').on(table.tenantId),
    messageRefTenantIdx: uniqueIndex('message_instances_message_ref_tenant_idx').on(table.tenantId, table.messageRef),
    customerIdx: index('message_instances_customer_idx').on(table.customerId),
    templateIdx: index('message_instances_template_idx').on(table.templateId),
    channelIdx: index('message_instances_channel_idx').on(table.channel),
    statusIdx: index('message_instances_status_idx').on(table.status),
    scheduledAtIdx: index('message_instances_scheduled_at_idx').on(table.scheduledAt),
    sentAtIdx: index('message_instances_sent_at_idx').on(table.sentAt),
    providerMessageIdx: index('message_instances_provider_message_idx').on(table.provider, table.providerMessageId),
    triggerEntityIdx: index('message_instances_trigger_entity_idx').on(table.triggerEntityType, table.triggerEntityId),
  })
);

// ============================================================================
// Delivery Receipts Table
// ============================================================================

export const deliveryReceipts = pgTable(
  'delivery_receipts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    messageInstanceId: text('message_instance_id').notNull().references(() => messageInstances.id, { onDelete: 'cascade' }),
    
    // Status
    status: deliveryStatusEnum('status').notNull(),
    previousStatus: deliveryStatusEnum('previous_status'),
    
    // Provider info
    provider: text('provider'),
    providerReceiptId: text('provider_receipt_id'),
    providerResponse: jsonb('provider_response').default({}),
    
    // Timing
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    
    // Details
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    
    // Device info (for push)
    deviceInfo: jsonb('device_info').default({}),
    
    // Read tracking
    readAt: timestamp('read_at', { withTimezone: true }),
    
    // Metadata
    metadata: jsonb('metadata').default({}),
    
    // Timestamp (immutable)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('delivery_receipts_tenant_idx').on(table.tenantId),
    messageInstanceIdx: index('delivery_receipts_message_instance_idx').on(table.messageInstanceId),
    statusIdx: index('delivery_receipts_status_idx').on(table.status),
    occurredAtIdx: index('delivery_receipts_occurred_at_idx').on(table.occurredAt),
    providerReceiptIdx: index('delivery_receipts_provider_receipt_idx').on(table.provider, table.providerReceiptId),
  })
);

// ============================================================================
// Communication Preferences Table (Consent Ledger)
// ============================================================================

export const communicationConsents = pgTable(
  'communication_consents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: text('customer_id').notNull(),
    
    // Channel
    channel: messageChannelEnum('channel').notNull(),
    
    // Category
    category: templateCategoryEnum('category').notNull(),
    
    // Consent
    isConsented: boolean('is_consented').notNull(),
    
    // Source
    consentSource: text('consent_source').notNull(),
    consentMethod: text('consent_method'),
    
    // Timing
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    
    // Evidence
    evidenceUrl: text('evidence_url'),
    ipAddress: text('ip_address'),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('communication_consents_tenant_idx').on(table.tenantId),
    customerIdx: index('communication_consents_customer_idx').on(table.customerId),
    channelIdx: index('communication_consents_channel_idx').on(table.channel),
    categoryIdx: index('communication_consents_category_idx').on(table.category),
    customerChannelCategoryIdx: uniqueIndex('communication_consents_customer_channel_category_idx')
      .on(table.customerId, table.channel, table.category),
  })
);

// ============================================================================
// Escalation Chains Table
// ============================================================================

export const escalationChains = pgTable(
  'escalation_chains',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    
    // Identity
    chainCode: text('chain_code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    
    // Category
    category: text('category').notNull(),
    
    // Steps
    steps: jsonb('steps').notNull().default([]),
    
    // Active
    isActive: boolean('is_active').notNull().default(true),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
  },
  (table) => ({
    tenantIdx: index('escalation_chains_tenant_idx').on(table.tenantId),
    chainCodeTenantIdx: uniqueIndex('escalation_chains_chain_code_tenant_idx').on(table.tenantId, table.chainCode),
    categoryIdx: index('escalation_chains_category_idx').on(table.category),
  })
);

// ============================================================================
// Escalation Chain Runs Table
// ============================================================================

export const escalationChainRuns = pgTable(
  'escalation_chain_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    chainId: text('chain_id').notNull().references(() => escalationChains.id, { onDelete: 'cascade' }),
    customerId: text('customer_id'),
    
    // Entity reference
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    
    // Status
    status: text('status').notNull().default('running'),
    currentStep: integer('current_step').notNull().default(0),
    
    // Progress
    stepsCompleted: jsonb('steps_completed').default([]),
    
    // Timing
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    
    // Outcome
    outcome: text('outcome'),
    outcomeReason: text('outcome_reason'),
    
    // Next step
    nextStepAt: timestamp('next_step_at', { withTimezone: true }),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('escalation_chain_runs_tenant_idx').on(table.tenantId),
    chainIdx: index('escalation_chain_runs_chain_idx').on(table.chainId),
    customerIdx: index('escalation_chain_runs_customer_idx').on(table.customerId),
    entityIdx: index('escalation_chain_runs_entity_idx').on(table.entityType, table.entityId),
    statusIdx: index('escalation_chain_runs_status_idx').on(table.status),
    nextStepAtIdx: index('escalation_chain_runs_next_step_at_idx').on(table.nextStepAt),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const messageTemplatesRelations = relations(messageTemplates, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [messageTemplates.tenantId],
    references: [tenants.id],
  }),
  previousVersion: one(messageTemplates, {
    fields: [messageTemplates.previousVersionId],
    references: [messageTemplates.id],
    relationName: 'templateVersions',
  }),
  instances: many(messageInstances),
}));

export const messageInstancesRelations = relations(messageInstances, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [messageInstances.tenantId],
    references: [tenants.id],
  }),
  template: one(messageTemplates, {
    fields: [messageInstances.templateId],
    references: [messageTemplates.id],
  }),
  deliveryReceipts: many(deliveryReceipts),
}));

export const deliveryReceiptsRelations = relations(deliveryReceipts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [deliveryReceipts.tenantId],
    references: [tenants.id],
  }),
  messageInstance: one(messageInstances, {
    fields: [deliveryReceipts.messageInstanceId],
    references: [messageInstances.id],
  }),
}));

export const communicationConsentsRelations = relations(communicationConsents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [communicationConsents.tenantId],
    references: [tenants.id],
  }),
}));

export const escalationChainsRelations = relations(escalationChains, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [escalationChains.tenantId],
    references: [tenants.id],
  }),
  runs: many(escalationChainRuns),
}));

export const escalationChainRunsRelations = relations(escalationChainRuns, ({ one }) => ({
  tenant: one(tenants, {
    fields: [escalationChainRuns.tenantId],
    references: [tenants.id],
  }),
  chain: one(escalationChains, {
    fields: [escalationChainRuns.chainId],
    references: [escalationChains.id],
  }),
}));
