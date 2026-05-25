/**
 * Expiry Tracking Service (Workflow G.6)
 * 
 * Monitors ID/lease/permit expiry dates.
 * Triggers reminders via Module D integration.
 * Manages missing document chasers.
 */

import type {
  TenantId,
  UserId,
  CustomerId,
  DocumentId,
  ExpiryTrackerId,
  ExpiryTracker,
  ExpiryType,
  ExpiryStatus,
  DocumentUpload,
  ServiceResult,
} from '../types/index.js';
import { ok, err } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { generateExpiryTrackerId } from '../utils/id-generator.js';
import type { IDocumentRepository } from './document-collection.service.js';

// ============================================================================
// Repository Interface
// ============================================================================

export interface IExpiryTrackerRepository {
  create(tracker: ExpiryTracker): Promise<ExpiryTracker>;
  findById(id: ExpiryTrackerId, tenantId: TenantId): Promise<ExpiryTracker | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<readonly ExpiryTracker[]>;
  findByDocument(documentId: DocumentId, tenantId: TenantId): Promise<ExpiryTracker | null>;
  findExpiringSoon(tenantId: TenantId, daysThreshold: number): Promise<readonly ExpiryTracker[]>;
  findExpired(tenantId: TenantId): Promise<readonly ExpiryTracker[]>;
  update(tracker: ExpiryTracker): Promise<ExpiryTracker>;
  delete(id: ExpiryTrackerId, tenantId: TenantId): Promise<void>;
}

// ============================================================================
// Notification Service Interface
// ============================================================================

export interface IExpiryNotificationService {
  sendExpiryReminder(params: {
    customerId: CustomerId;
    tenantId: TenantId;
    itemName: string;
    expiryType: ExpiryType;
    expiresAt: string;
    daysUntilExpiry: number;
    isUrgent: boolean;
  }): Promise<void>;

  sendMissingDocumentChaser(params: {
    customerId: CustomerId;
    tenantId: TenantId;
    missingDocuments: readonly {
      documentType: string;
      description: string;
    }[];
    reminderCount: number;
  }): Promise<void>;

  sendExpiryAlert(params: {
    tenantId: TenantId;
    customerId: CustomerId;
    itemName: string;
    expiryType: ExpiryType;
    expiredAt: string;
    daysSinceExpiry: number;
  }): Promise<void>;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface ExpiryTrackingConfig {
  readonly reminderDays: readonly number[]; // Days before expiry to send reminders
  readonly urgentThresholdDays: number;
  readonly maxReminders: number;
  readonly autoCreateTrackers: boolean;
}

const DEFAULT_CONFIG: ExpiryTrackingConfig = {
  reminderDays: [90, 60, 30, 14, 7, 3, 1],
  urgentThresholdDays: 14,
  maxReminders: 7,
  autoCreateTrackers: true,
};

// ============================================================================
// Document Type to Expiry Type Mapping
// ============================================================================

const EXPIRY_TYPE_MAPPING: Record<string, ExpiryType> = {
  national_id: 'id_document',
  passport: 'id_document',
  drivers_license: 'id_document',
  lease_agreement: 'lease',
  signed_lease: 'lease',
  work_permit: 'work_permit',
  residence_permit: 'residence_permit',
};

// ============================================================================
// Expiry Tracking Service
// ============================================================================

export interface ExpiryTrackingServiceOptions {
  readonly documentRepository: IDocumentRepository;
  readonly expiryTrackerRepository: IExpiryTrackerRepository;
  readonly notificationService?: IExpiryNotificationService;
  readonly config?: Partial<ExpiryTrackingConfig>;
}

export class ExpiryTrackingService {
  private readonly documentRepository: IDocumentRepository;
  private readonly expiryRepository: IExpiryTrackerRepository;
  private readonly notificationService?: IExpiryNotificationService;
  private readonly config: ExpiryTrackingConfig;

  constructor(options: ExpiryTrackingServiceOptions) {
    this.documentRepository = options.documentRepository;
    this.expiryRepository = options.expiryTrackerRepository;
    this.notificationService = options.notificationService;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  // ============================================================================
  // Create/Update Expiry Tracker
  // ============================================================================

  async createTracker(params: {
    tenantId: TenantId;
    customerId: CustomerId;
    documentId?: DocumentId;
    expiryType: ExpiryType;
    itemName: string;
    itemDescription?: string;
    expiresAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<ServiceResult<ExpiryTracker>> {
    const {
      tenantId,
      customerId,
      documentId,
      expiryType,
      itemName,
      itemDescription,
      expiresAt,
      metadata,
    } = params;

    // Validate expiry date
    const expiryDate = new Date(expiresAt);
    if (isNaN(expiryDate.getTime())) {
      return err('INVALID_DATE', 'Invalid expiry date');
    }

    const now = new Date();
    const daysUntilExpiry = Math.ceil(
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Determine status
    let status: ExpiryStatus = 'active';
    if (daysUntilExpiry < 0) {
      status = 'expired';
    } else if (daysUntilExpiry <= this.config.urgentThresholdDays) {
      status = 'expiring_soon';
    }

    // Calculate next reminder date
    const nextReminderAt = this.calculateNextReminderDate(expiresAt, 0);

    const tracker: ExpiryTracker = {
      id: generateExpiryTrackerId(),
      tenantId,
      customerId,
      documentId: documentId ?? null,
      expiryType,
      itemName,
      itemDescription: itemDescription ?? null,
      expiresAt,
      status,
      daysUntilExpiry,
      remindersSent: 0,
      lastReminderAt: null,
      nextReminderAt,
      renewedAt: null,
      renewedDocumentId: null,
      isAcknowledged: false,
      acknowledgedAt: null,
      acknowledgedBy: null,
      metadata: metadata ?? {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const saved = await this.expiryRepository.create(tracker);

    logger.info('Expiry tracker created', {
      trackerId: saved.id,
      tenantId,
      customerId,
      expiryType,
      expiresAt,
      daysUntilExpiry,
    });

    return ok(saved);
  }

  async createTrackerFromDocument(
    documentId: DocumentId,
    tenantId: TenantId
  ): Promise<ServiceResult<ExpiryTracker | null>> {
    const document = await this.documentRepository.findById(documentId, tenantId);
    if (!document) {
      return err('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    // Check if document has expiry date
    const metadata = document.metadata as Record<string, string>;
    const expiresAt = metadata.expiresAt ?? document.expiresAt;

    if (!expiresAt) {
      return ok(null); // No expiry date, nothing to track
    }

    // Check if tracker already exists
    const existing = await this.expiryRepository.findByDocument(documentId, tenantId);
    if (existing) {
      // Update existing tracker if expiry date changed
      if (existing.expiresAt !== expiresAt) {
        return this.updateExpiry(existing.id, tenantId, expiresAt);
      }
      return ok(existing);
    }

    // Determine expiry type
    const expiryType = EXPIRY_TYPE_MAPPING[document.documentType] ?? 'id_document';

    return this.createTracker({
      tenantId,
      customerId: document.customerId,
      documentId,
      expiryType,
      itemName: `${document.documentType.replace('_', ' ')} - ${document.originalFileName}`,
      itemDescription: `Expiry tracking for ${document.documentType}`,
      expiresAt,
      metadata: {
        documentType: document.documentType,
        originalFileName: document.originalFileName,
      },
    });
  }

  // ============================================================================
  // Update Expiry
  // ============================================================================

  async updateExpiry(
    trackerId: ExpiryTrackerId,
    tenantId: TenantId,
    newExpiresAt: string
  ): Promise<ServiceResult<ExpiryTracker>> {
    const tracker = await this.expiryRepository.findById(trackerId, tenantId);
    if (!tracker) {
      return err('TRACKER_NOT_FOUND', 'Expiry tracker not found');
    }

    const expiryDate = new Date(newExpiresAt);
    const now = new Date();
    const daysUntilExpiry = Math.ceil(
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    let status: ExpiryStatus = 'active';
    if (daysUntilExpiry < 0) {
      status = 'expired';
    } else if (daysUntilExpiry <= this.config.urgentThresholdDays) {
      status = 'expiring_soon';
    }

    const updated: ExpiryTracker = {
      ...tracker,
      expiresAt: newExpiresAt,
      status,
      daysUntilExpiry,
      nextReminderAt: this.calculateNextReminderDate(newExpiresAt, tracker.remindersSent),
      updatedAt: now.toISOString(),
    };

    const saved = await this.expiryRepository.update(updated);
    return ok(saved);
  }

  // ============================================================================
  // Record Renewal
  // ============================================================================

  async recordRenewal(params: {
    trackerId: ExpiryTrackerId;
    tenantId: TenantId;
    newDocumentId?: DocumentId;
    newExpiresAt: string;
  }): Promise<ServiceResult<ExpiryTracker>> {
    const { trackerId, tenantId, newDocumentId, newExpiresAt } = params;

    const tracker = await this.expiryRepository.findById(trackerId, tenantId);
    if (!tracker) {
      return err('TRACKER_NOT_FOUND', 'Expiry tracker not found');
    }

    const now = new Date().toISOString();
    const expiryDate = new Date(newExpiresAt);
    const daysUntilExpiry = Math.ceil(
      (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    const updated: ExpiryTracker = {
      ...tracker,
      status: 'renewed',
      expiresAt: newExpiresAt,
      daysUntilExpiry,
      renewedAt: now,
      renewedDocumentId: newDocumentId ?? null,
      remindersSent: 0,
      lastReminderAt: null,
      nextReminderAt: this.calculateNextReminderDate(newExpiresAt, 0),
      updatedAt: now,
    };

    const saved = await this.expiryRepository.update(updated);

    logger.info('Renewal recorded', {
      trackerId,
      tenantId,
      newDocumentId,
      newExpiresAt,
    });

    return ok(saved);
  }

  // ============================================================================
  // Acknowledge Expiry
  // ============================================================================

  async acknowledgeExpiry(
    trackerId: ExpiryTrackerId,
    tenantId: TenantId,
    acknowledgedBy: UserId
  ): Promise<ServiceResult<ExpiryTracker>> {
    const tracker = await this.expiryRepository.findById(trackerId, tenantId);
    if (!tracker) {
      return err('TRACKER_NOT_FOUND', 'Expiry tracker not found');
    }

    const now = new Date().toISOString();

    const updated: ExpiryTracker = {
      ...tracker,
      isAcknowledged: true,
      acknowledgedAt: now,
      acknowledgedBy,
      updatedAt: now,
    };

    const saved = await this.expiryRepository.update(updated);
    return ok(saved);
  }

  // ============================================================================
  // Process Reminders (called by scheduler/cron)
  // ============================================================================

  async processReminders(tenantId: TenantId): Promise<ServiceResult<{
    processed: number;
    remindersSent: number;
    alertsSent: number;
  }>> {
    logger.info('Processing expiry reminders', { tenantId });

    let remindersSent = 0;
    let alertsSent = 0;

    // Get all expiring soon items
    const expiringSoon = await this.expiryRepository.findExpiringSoon(
      tenantId,
      Math.max(...this.config.reminderDays)
    );

    // Get all expired items
    const expired = await this.expiryRepository.findExpired(tenantId);

    const now = new Date();

    // Process expiring soon reminders
    for (const tracker of expiringSoon) {
      if (tracker.isAcknowledged || tracker.status === 'renewed') {
        continue;
      }

      if (tracker.remindersSent >= this.config.maxReminders) {
        continue;
      }

      // Check if it's time for next reminder
      if (tracker.nextReminderAt) {
        const nextReminder = new Date(tracker.nextReminderAt);
        if (nextReminder > now) {
          continue;
        }
      }

      // Check if current day is a reminder day
      const daysUntilExpiry = tracker.daysUntilExpiry;
      const shouldRemind = this.config.reminderDays.some(
        d => daysUntilExpiry <= d && daysUntilExpiry > (d === 1 ? 0 : d - 7)
      );

      if (shouldRemind && this.notificationService) {
        try {
          await this.notificationService.sendExpiryReminder({
            customerId: tracker.customerId,
            tenantId,
            itemName: tracker.itemName,
            expiryType: tracker.expiryType,
            expiresAt: tracker.expiresAt,
            daysUntilExpiry,
            isUrgent: daysUntilExpiry <= this.config.urgentThresholdDays,
          });

          // Update tracker
          const updated: ExpiryTracker = {
            ...tracker,
            remindersSent: tracker.remindersSent + 1,
            lastReminderAt: now.toISOString(),
            nextReminderAt: this.calculateNextReminderDate(
              tracker.expiresAt,
              tracker.remindersSent + 1
            ),
            updatedAt: now.toISOString(),
          };

          await this.expiryRepository.update(updated);
          remindersSent++;
        } catch (error) {
          logger.error('Failed to send expiry reminder', {
            trackerId: tracker.id,
            error,
          });
        }
      }
    }

    // Process expired alerts
    for (const tracker of expired) {
      if (tracker.isAcknowledged || tracker.status === 'renewed') {
        continue;
      }

      const expiryDate = new Date(tracker.expiresAt);
      const daysSinceExpiry = Math.ceil(
        (now.getTime() - expiryDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Send alert for items expired within last 30 days
      if (daysSinceExpiry <= 30 && this.notificationService) {
        try {
          await this.notificationService.sendExpiryAlert({
            tenantId,
            customerId: tracker.customerId,
            itemName: tracker.itemName,
            expiryType: tracker.expiryType,
            expiredAt: tracker.expiresAt,
            daysSinceExpiry,
          });

          alertsSent++;
        } catch (error) {
          logger.error('Failed to send expiry alert', {
            trackerId: tracker.id,
            error,
          });
        }
      }
    }

    const totalProcessed = expiringSoon.length + expired.length;

    logger.info('Expiry reminder processing completed', {
      tenantId,
      processed: totalProcessed,
      remindersSent,
      alertsSent,
    });

    return ok({
      processed: totalProcessed,
      remindersSent,
      alertsSent,
    });
  }

  // ============================================================================
  // Missing Document Chasers
  // ============================================================================

  async sendMissingDocumentChaser(params: {
    customerId: CustomerId;
    tenantId: TenantId;
    missingDocumentTypes: readonly string[];
  }): Promise<ServiceResult<void>> {
    if (!this.notificationService) {
      return err('NOTIFICATIONS_NOT_CONFIGURED', 'Notification service not configured');
    }

    const missingDocuments = params.missingDocumentTypes.map(type => ({
      documentType: type,
      description: `Please upload your ${type.replace('_', ' ')}`,
    }));

    try {
      await this.notificationService.sendMissingDocumentChaser({
        customerId: params.customerId,
        tenantId: params.tenantId,
        missingDocuments,
        reminderCount: 1, // Track this in actual implementation
      });

      logger.info('Missing document chaser sent', {
        customerId: params.customerId,
        tenantId: params.tenantId,
        missingCount: missingDocuments.length,
      });

      return ok(undefined);
    } catch (error) {
      logger.error('Failed to send missing document chaser', { error });
      return err('NOTIFICATION_FAILED', 'Failed to send notification');
    }
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  async getTracker(
    trackerId: ExpiryTrackerId,
    tenantId: TenantId
  ): Promise<ServiceResult<ExpiryTracker | null>> {
    const tracker = await this.expiryRepository.findById(trackerId, tenantId);
    return ok(tracker);
  }

  async getCustomerTrackers(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<readonly ExpiryTracker[]>> {
    const trackers = await this.expiryRepository.findByCustomer(customerId, tenantId);
    return ok(trackers);
  }

  async getExpiringSoon(
    tenantId: TenantId,
    daysThreshold?: number
  ): Promise<ServiceResult<readonly ExpiryTracker[]>> {
    const threshold = daysThreshold ?? this.config.urgentThresholdDays;
    const trackers = await this.expiryRepository.findExpiringSoon(tenantId, threshold);
    return ok(trackers);
  }

  async getExpired(
    tenantId: TenantId
  ): Promise<ServiceResult<readonly ExpiryTracker[]>> {
    const trackers = await this.expiryRepository.findExpired(tenantId);
    return ok(trackers);
  }

  async getExpiryStatistics(
    tenantId: TenantId
  ): Promise<ServiceResult<{
    total: number;
    active: number;
    expiringSoon: number;
    expired: number;
    renewed: number;
    byType: Record<ExpiryType, number>;
  }>> {
    // This would typically be a single optimized query
    const all = await this.expiryRepository.findExpiringSoon(tenantId, 365);
    const expired = await this.expiryRepository.findExpired(tenantId);

    const combined = [...all, ...expired];

    const byStatus = {
      active: combined.filter(t => t.status === 'active').length,
      expiringSoon: combined.filter(t => t.status === 'expiring_soon').length,
      expired: combined.filter(t => t.status === 'expired').length,
      renewed: combined.filter(t => t.status === 'renewed').length,
    };

    const byType: Record<string, number> = {};
    for (const tracker of combined) {
      byType[tracker.expiryType] = (byType[tracker.expiryType] ?? 0) + 1;
    }

    return ok({
      total: combined.length,
      ...byStatus,
      byType: byType as Record<ExpiryType, number>,
    });
  }

  // ============================================================================
  // Sync Trackers from Documents
  // ============================================================================

  async syncTrackersForCustomer(
    customerId: CustomerId,
    tenantId: TenantId
  ): Promise<ServiceResult<{
    created: number;
    updated: number;
    unchanged: number;
  }>> {
    const documents = await this.documentRepository.findByCustomer(customerId, tenantId);

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const doc of documents) {
      const result = await this.createTrackerFromDocument(doc.id, tenantId);

      if (result.success && result.data) {
        // Check if it was newly created or already existed
        const existing = await this.expiryRepository.findByDocument(doc.id, tenantId);
        if (existing && existing.id === result.data.id) {
          if (existing.expiresAt !== result.data.expiresAt) {
            updated++;
          } else {
            unchanged++;
          }
        } else {
          created++;
        }
      }
    }

    logger.info('Tracker sync completed', {
      customerId,
      tenantId,
      created,
      updated,
      unchanged,
    });

    return ok({ created, updated, unchanged });
  }

  // ============================================================================
  // Delete Tracker
  // ============================================================================

  async deleteTracker(
    trackerId: ExpiryTrackerId,
    tenantId: TenantId
  ): Promise<ServiceResult<void>> {
    const tracker = await this.expiryRepository.findById(trackerId, tenantId);
    if (!tracker) {
      return err('TRACKER_NOT_FOUND', 'Expiry tracker not found');
    }

    await this.expiryRepository.delete(trackerId, tenantId);
    return ok(undefined);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private calculateNextReminderDate(
    expiresAt: string,
    remindersSent: number
  ): string | null {
    const expiryDate = new Date(expiresAt);
    const sortedDays = [...this.config.reminderDays].sort((a, b) => b - a);

    // Find the next reminder day that hasn't been sent yet
    const nextReminderDay = sortedDays[remindersSent];

    if (!nextReminderDay) {
      return null; // All reminders sent
    }

    const nextDate = new Date(expiryDate);
    nextDate.setDate(nextDate.getDate() - nextReminderDay);

    // If next reminder is in the past, return tomorrow
    const now = new Date();
    if (nextDate < now) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0); // 9 AM
      return tomorrow.toISOString();
    }

    nextDate.setHours(9, 0, 0, 0); // 9 AM
    return nextDate.toISOString();
  }
}
