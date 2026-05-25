import { randomHex } from '../common/id-generator.js';
/**
 * Vendor domain service.
 *
 * Handles vendor management, performance tracking, and scorecards
 * for the BORJIE platform.
 */

import type { TenantId, UserId, PaginationParams, PaginatedResult, Result, ISOTimestamp, Money } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Types
// ============================================================================

export type VendorId = string & { readonly __brand: 'VendorId' };
export const asVendorId = (s: string): VendorId => s as VendorId;

export type VendorStatus = 'active' | 'inactive' | 'probation' | 'suspended' | 'blacklisted';
export type VendorCategory = 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'general' | 'cleaning' | 'landscaping' | 'pest_control' | 'security' | 'painting' | 'roofing' | 'other';

export interface VendorContact {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly isEmergencyContact: boolean;
  readonly isPrimary: boolean;
}

export interface VendorRateCard {
  readonly category: VendorCategory;
  readonly hourlyRate: Money;
  readonly minimumCharge: Money;
  readonly emergencyMultiplier: number;
  readonly afterHoursMultiplier: number;
}

export interface VendorPerformanceMetrics {
  readonly totalJobs: number;
  readonly completedJobs: number;
  readonly cancelledJobs: number;
  readonly averageResponseTimeMinutes: number;
  readonly averageResolutionTimeMinutes: number;
  readonly reopenRate: number;
  readonly averageRating: number;
  readonly ratingCount: number;
  readonly slaComplianceRate: number;
  readonly onTimeCompletionRate: number;
}

export interface VendorScorecard {
  readonly overallScore: number;
  readonly qualityScore: number;
  readonly reliabilityScore: number;
  readonly communicationScore: number;
  readonly valueScore: number;
  readonly lastUpdated: ISOTimestamp;
}

export interface VendorCertification {
  readonly name: string;
  readonly issuedBy: string;
  readonly issuedDate: ISOTimestamp;
  readonly expiryDate?: ISOTimestamp;
  readonly documentUrl?: string;
}

export interface Vendor {
  readonly id: VendorId;
  readonly tenantId: TenantId;
  readonly vendorCode: string;
  readonly companyName: string;
  readonly tradeName?: string;
  readonly status: VendorStatus;
  readonly categories: readonly VendorCategory[];
  readonly serviceAreas: readonly string[];
  readonly contacts: readonly VendorContact[];
  readonly rateCards: readonly VendorRateCard[];
  readonly performanceMetrics: VendorPerformanceMetrics;
  readonly scorecard: VendorScorecard;
  readonly certifications: readonly VendorCertification[];
  readonly isPreferred: boolean;
  readonly emergencyAvailable: boolean;
  readonly afterHoursAvailable: boolean;
  readonly licenseNumber?: string;
  readonly taxId?: string;
  readonly insuranceProvider?: string;
  readonly insurancePolicyNumber?: string;
  readonly insuranceExpiryDate?: ISOTimestamp;
  readonly bankAccountDetails?: { bankName: string; accountNumber: string; accountName: string };
  readonly notes?: string;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Error Types
// ============================================================================

export const VendorServiceError = {
  VENDOR_NOT_FOUND: 'VENDOR_NOT_FOUND',
  VENDOR_CODE_EXISTS: 'VENDOR_CODE_EXISTS',
  INVALID_VENDOR_DATA: 'INVALID_VENDOR_DATA',
  VENDOR_SUSPENDED: 'VENDOR_SUSPENDED',
  VENDOR_BLACKLISTED: 'VENDOR_BLACKLISTED',
  NO_AVAILABLE_VENDOR: 'NO_AVAILABLE_VENDOR',
  CANNOT_DELETE_ACTIVE_VENDOR: 'CANNOT_DELETE_ACTIVE_VENDOR',
} as const;

export type VendorServiceErrorCode = (typeof VendorServiceError)[keyof typeof VendorServiceError];

export interface VendorServiceErrorResult {
  code: VendorServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface VendorRepository {
  findById(id: VendorId, tenantId: TenantId): Promise<Vendor | null>;
  findByVendorCode(vendorCode: string, tenantId: TenantId): Promise<Vendor | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Vendor>>;
  findByCategory(category: VendorCategory, tenantId: TenantId): Promise<Vendor[]>;
  findByStatus(status: VendorStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Vendor>>;
  findAvailable(category: VendorCategory, emergency: boolean, tenantId: TenantId): Promise<Vendor[]>;
  findPreferred(tenantId: TenantId): Promise<Vendor[]>;
  findTopRated(tenantId: TenantId, limit: number): Promise<Vendor[]>;
  search(query: string, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Vendor>>;
  create(vendor: Vendor): Promise<Vendor>;
  update(vendor: Vendor): Promise<Vendor>;
  delete(id: VendorId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
  countByStatus(tenantId: TenantId): Promise<Record<VendorStatus, number>>;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateVendorInput {
  companyName: string;
  tradeName?: string;
  categories: VendorCategory[];
  serviceAreas: string[];
  contacts: VendorContact[];
  rateCards?: VendorRateCard[];
  emergencyAvailable?: boolean;
  afterHoursAvailable?: boolean;
  licenseNumber?: string;
  taxId?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceExpiryDate?: ISOTimestamp;
  bankAccountDetails?: { bankName: string; accountNumber: string; accountName: string };
  notes?: string;
}

export interface UpdateVendorInput {
  companyName?: string;
  tradeName?: string;
  status?: VendorStatus;
  categories?: VendorCategory[];
  serviceAreas?: string[];
  contacts?: VendorContact[];
  rateCards?: VendorRateCard[];
  emergencyAvailable?: boolean;
  afterHoursAvailable?: boolean;
  isPreferred?: boolean;
  licenseNumber?: string;
  taxId?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceExpiryDate?: ISOTimestamp;
  bankAccountDetails?: { bankName: string; accountNumber: string; accountName: string };
  notes?: string;
}

export interface AddCertificationInput {
  name: string;
  issuedBy: string;
  issuedDate: ISOTimestamp;
  expiryDate?: ISOTimestamp;
  documentUrl?: string;
}

export interface UpdateMetricsInput {
  jobCompleted?: boolean;
  jobCancelled?: boolean;
  responseTimeMinutes?: number;
  resolutionTimeMinutes?: number;
  rating?: number;
  slaCompliant?: boolean;
  onTimeCompletion?: boolean;
}

// ============================================================================
// Domain Events
// ============================================================================

export interface VendorCreatedEvent {
  eventId: string;
  eventType: 'VendorCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { vendorId: VendorId; vendorCode: string; companyName: string; categories: VendorCategory[] };
}

export interface VendorStatusChangedEvent {
  eventId: string;
  eventType: 'VendorStatusChanged';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { vendorId: VendorId; vendorCode: string; previousStatus: VendorStatus; newStatus: VendorStatus; reason?: string };
}

export interface VendorScorecardUpdatedEvent {
  eventId: string;
  eventType: 'VendorScorecardUpdated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { vendorId: VendorId; vendorCode: string; overallScore: number; previousScore: number };
}

// ============================================================================
// Vendor Service Implementation
// ============================================================================

const DEFAULT_METRICS: VendorPerformanceMetrics = {
  totalJobs: 0, completedJobs: 0, cancelledJobs: 0, averageResponseTimeMinutes: 0, averageResolutionTimeMinutes: 0,
  reopenRate: 0, averageRating: 0, ratingCount: 0, slaComplianceRate: 100, onTimeCompletionRate: 100,
};

const DEFAULT_SCORECARD: VendorScorecard = {
  overallScore: 0, qualityScore: 0, reliabilityScore: 0, communicationScore: 0, valueScore: 0,
  lastUpdated: new Date().toISOString() as ISOTimestamp,
};

export class VendorService {
  constructor(private readonly vendorRepo: VendorRepository, private readonly eventBus: EventBus) {}

  async createVendor(tenantId: TenantId, input: CreateVendorInput, createdBy: UserId, correlationId: string): Promise<Result<Vendor, VendorServiceErrorResult>> {
    if (!input.companyName || input.categories.length === 0) {
      return err({ code: VendorServiceError.INVALID_VENDOR_DATA, message: 'Company name and at least one category are required' });
    }
    if (input.contacts.length === 0) {
      return err({ code: VendorServiceError.INVALID_VENDOR_DATA, message: 'At least one contact is required' });
    }

    const vendorCode = await this.generateVendorCode(tenantId);
    const vendorId = asVendorId(`vendor_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString() as ISOTimestamp;

    const vendor: Vendor = {
      id: vendorId, tenantId, vendorCode, companyName: input.companyName, tradeName: input.tradeName, status: 'active',
      categories: input.categories, serviceAreas: input.serviceAreas, contacts: input.contacts, rateCards: input.rateCards || [],
      performanceMetrics: DEFAULT_METRICS, scorecard: { ...DEFAULT_SCORECARD, lastUpdated: now }, certifications: [],
      isPreferred: false, emergencyAvailable: input.emergencyAvailable || false, afterHoursAvailable: input.afterHoursAvailable || false,
      licenseNumber: input.licenseNumber, taxId: input.taxId, insuranceProvider: input.insuranceProvider,
      insurancePolicyNumber: input.insurancePolicyNumber, insuranceExpiryDate: input.insuranceExpiryDate,
      bankAccountDetails: input.bankAccountDetails, notes: input.notes,
      createdAt: now, updatedAt: now, createdBy, updatedBy: createdBy,
    };

    const savedVendor = await this.vendorRepo.create(vendor);

    const event: VendorCreatedEvent = {
      eventId: generateEventId(), eventType: 'VendorCreated', timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
      payload: { vendorId: savedVendor.id, vendorCode: savedVendor.vendorCode, companyName: savedVendor.companyName, categories: [...savedVendor.categories] },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedVendor.id, 'Vendor'));

    return ok(savedVendor);
  }

  async getVendor(vendorId: VendorId, tenantId: TenantId): Promise<Vendor | null> {
    return this.vendorRepo.findById(vendorId, tenantId);
  }

  async getVendorByCode(vendorCode: string, tenantId: TenantId): Promise<Vendor | null> {
    return this.vendorRepo.findByVendorCode(vendorCode, tenantId);
  }

  async listVendors(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Vendor>> {
    return this.vendorRepo.findMany(tenantId, pagination);
  }

  async listVendorsByCategory(category: VendorCategory, tenantId: TenantId): Promise<Vendor[]> {
    return this.vendorRepo.findByCategory(category, tenantId);
  }

  async listAvailableVendors(category: VendorCategory, emergency: boolean, tenantId: TenantId): Promise<Vendor[]> {
    return this.vendorRepo.findAvailable(category, emergency, tenantId);
  }

  async listPreferredVendors(tenantId: TenantId): Promise<Vendor[]> {
    return this.vendorRepo.findPreferred(tenantId);
  }

  async listTopRatedVendors(tenantId: TenantId, limit = 10): Promise<Vendor[]> {
    return this.vendorRepo.findTopRated(tenantId, limit);
  }

  async searchVendors(query: string, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Vendor>> {
    return this.vendorRepo.search(query, tenantId, pagination);
  }

  async getVendorStats(tenantId: TenantId): Promise<Record<VendorStatus, number>> {
    return this.vendorRepo.countByStatus(tenantId);
  }

  async updateVendor(vendorId: VendorId, tenantId: TenantId, input: UpdateVendorInput, updatedBy: UserId, correlationId: string): Promise<Result<Vendor, VendorServiceErrorResult>> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) return err({ code: VendorServiceError.VENDOR_NOT_FOUND, message: 'Vendor not found' });

    const now = new Date().toISOString() as ISOTimestamp;
    const previousStatus = vendor.status;

    const updatedVendor: Vendor = {
      ...vendor,
      companyName: input.companyName ?? vendor.companyName,
      tradeName: input.tradeName ?? vendor.tradeName,
      status: input.status ?? vendor.status,
      categories: input.categories ?? vendor.categories,
      serviceAreas: input.serviceAreas ?? vendor.serviceAreas,
      contacts: input.contacts ?? vendor.contacts,
      rateCards: input.rateCards ?? vendor.rateCards,
      emergencyAvailable: input.emergencyAvailable ?? vendor.emergencyAvailable,
      afterHoursAvailable: input.afterHoursAvailable ?? vendor.afterHoursAvailable,
      isPreferred: input.isPreferred ?? vendor.isPreferred,
      licenseNumber: input.licenseNumber ?? vendor.licenseNumber,
      taxId: input.taxId ?? vendor.taxId,
      insuranceProvider: input.insuranceProvider ?? vendor.insuranceProvider,
      insurancePolicyNumber: input.insurancePolicyNumber ?? vendor.insurancePolicyNumber,
      insuranceExpiryDate: input.insuranceExpiryDate ?? vendor.insuranceExpiryDate,
      bankAccountDetails: input.bankAccountDetails ?? vendor.bankAccountDetails,
      notes: input.notes ?? vendor.notes,
      updatedAt: now, updatedBy,
    };

    const savedVendor = await this.vendorRepo.update(updatedVendor);

    if (input.status && input.status !== previousStatus) {
      const event: VendorStatusChangedEvent = {
        eventId: generateEventId(), eventType: 'VendorStatusChanged', timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
        payload: { vendorId, vendorCode: savedVendor.vendorCode, previousStatus, newStatus: input.status },
      };
      await this.eventBus.publish(createEventEnvelope(event, vendorId, 'Vendor'));
    }

    return ok(savedVendor);
  }

  async addCertification(vendorId: VendorId, tenantId: TenantId, input: AddCertificationInput, addedBy: UserId): Promise<Result<Vendor, VendorServiceErrorResult>> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) return err({ code: VendorServiceError.VENDOR_NOT_FOUND, message: 'Vendor not found' });

    const now = new Date().toISOString() as ISOTimestamp;
    const certification: VendorCertification = { name: input.name, issuedBy: input.issuedBy, issuedDate: input.issuedDate, expiryDate: input.expiryDate, documentUrl: input.documentUrl };
    const updatedVendor: Vendor = { ...vendor, certifications: [...vendor.certifications, certification], updatedAt: now, updatedBy: addedBy };
    const savedVendor = await this.vendorRepo.update(updatedVendor);
    return ok(savedVendor);
  }

  async updateMetrics(vendorId: VendorId, tenantId: TenantId, input: UpdateMetricsInput, updatedBy: UserId): Promise<Result<Vendor, VendorServiceErrorResult>> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) return err({ code: VendorServiceError.VENDOR_NOT_FOUND, message: 'Vendor not found' });

    const metrics = { ...vendor.performanceMetrics };

    if (input.jobCompleted) {
      metrics.totalJobs++;
      metrics.completedJobs++;
    }
    if (input.jobCancelled) {
      metrics.totalJobs++;
      metrics.cancelledJobs++;
    }
    if (input.responseTimeMinutes !== undefined) {
      const total = metrics.averageResponseTimeMinutes * (metrics.completedJobs - 1) + input.responseTimeMinutes;
      metrics.averageResponseTimeMinutes = Math.round(total / metrics.completedJobs);
    }
    if (input.resolutionTimeMinutes !== undefined) {
      const total = metrics.averageResolutionTimeMinutes * (metrics.completedJobs - 1) + input.resolutionTimeMinutes;
      metrics.averageResolutionTimeMinutes = Math.round(total / metrics.completedJobs);
    }
    if (input.rating !== undefined) {
      const total = metrics.averageRating * metrics.ratingCount + input.rating;
      metrics.ratingCount++;
      metrics.averageRating = Math.round((total / metrics.ratingCount) * 10) / 10;
    }
    if (input.slaCompliant !== undefined && metrics.completedJobs > 0) {
      const compliant = Math.round(metrics.slaComplianceRate * (metrics.completedJobs - 1) / 100) + (input.slaCompliant ? 1 : 0);
      metrics.slaComplianceRate = Math.round((compliant / metrics.completedJobs) * 100);
    }
    if (input.onTimeCompletion !== undefined && metrics.completedJobs > 0) {
      const onTime = Math.round(metrics.onTimeCompletionRate * (metrics.completedJobs - 1) / 100) + (input.onTimeCompletion ? 1 : 0);
      metrics.onTimeCompletionRate = Math.round((onTime / metrics.completedJobs) * 100);
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const updatedVendor: Vendor = { ...vendor, performanceMetrics: metrics as VendorPerformanceMetrics, updatedAt: now, updatedBy };
    const savedVendor = await this.vendorRepo.update(updatedVendor);
    return ok(savedVendor);
  }

  async recalculateScorecard(vendorId: VendorId, tenantId: TenantId, updatedBy: UserId, correlationId: string): Promise<Result<Vendor, VendorServiceErrorResult>> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) return err({ code: VendorServiceError.VENDOR_NOT_FOUND, message: 'Vendor not found' });

    const metrics = vendor.performanceMetrics;
    const previousScore = vendor.scorecard.overallScore;

    // Quality: based on average rating and reopen rate
    const qualityScore = Math.min(100, Math.max(0, (metrics.averageRating / 5) * 100 - metrics.reopenRate * 20));
    // Reliability: based on SLA compliance and on-time completion
    const reliabilityScore = Math.min(100, Math.max(0, (metrics.slaComplianceRate + metrics.onTimeCompletionRate) / 2));
    // Value: based on completion rate
    const completionRate = metrics.totalJobs > 0 ? (metrics.completedJobs / metrics.totalJobs) * 100 : 0;
    const valueScore = Math.min(100, Math.max(0, completionRate));
    // Communication: placeholder - could be based on response time
    const responseScore = Math.min(100, Math.max(0, 100 - (metrics.averageResponseTimeMinutes / 60) * 10));
    const communicationScore = responseScore;

    const overallScore = Math.round((qualityScore * 0.3 + reliabilityScore * 0.3 + valueScore * 0.2 + communicationScore * 0.2) * 10) / 10;

    const now = new Date().toISOString() as ISOTimestamp;
    const scorecard: VendorScorecard = { overallScore, qualityScore: Math.round(qualityScore), reliabilityScore: Math.round(reliabilityScore), communicationScore: Math.round(communicationScore), valueScore: Math.round(valueScore), lastUpdated: now };
    const updatedVendor: Vendor = { ...vendor, scorecard, updatedAt: now, updatedBy };
    const savedVendor = await this.vendorRepo.update(updatedVendor);

    if (Math.abs(overallScore - previousScore) > 5) {
      const event: VendorScorecardUpdatedEvent = {
        eventId: generateEventId(), eventType: 'VendorScorecardUpdated', timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
        payload: { vendorId, vendorCode: savedVendor.vendorCode, overallScore, previousScore },
      };
      await this.eventBus.publish(createEventEnvelope(event, vendorId, 'Vendor'));
    }

    return ok(savedVendor);
  }

  async suspendVendor(vendorId: VendorId, tenantId: TenantId, reason: string, suspendedBy: UserId, correlationId: string): Promise<Result<Vendor, VendorServiceErrorResult>> {
    return this.updateVendor(vendorId, tenantId, { status: 'suspended', notes: reason }, suspendedBy, correlationId);
  }

  async blacklistVendor(vendorId: VendorId, tenantId: TenantId, reason: string, blacklistedBy: UserId, correlationId: string): Promise<Result<Vendor, VendorServiceErrorResult>> {
    return this.updateVendor(vendorId, tenantId, { status: 'blacklisted', notes: reason }, blacklistedBy, correlationId);
  }

  async reactivateVendor(vendorId: VendorId, tenantId: TenantId, reactivatedBy: UserId, correlationId: string): Promise<Result<Vendor, VendorServiceErrorResult>> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) return err({ code: VendorServiceError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
    if (vendor.status === 'blacklisted') return err({ code: VendorServiceError.VENDOR_BLACKLISTED, message: 'Cannot reactivate blacklisted vendor' });
    return this.updateVendor(vendorId, tenantId, { status: 'active' }, reactivatedBy, correlationId);
  }

  async deleteVendor(vendorId: VendorId, tenantId: TenantId, deletedBy: UserId): Promise<Result<void, VendorServiceErrorResult>> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) return err({ code: VendorServiceError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
    if (vendor.status === 'active' && vendor.performanceMetrics.totalJobs > 0) {
      return err({ code: VendorServiceError.CANNOT_DELETE_ACTIVE_VENDOR, message: 'Cannot delete active vendor with job history. Suspend or blacklist instead.' });
    }
    await this.vendorRepo.delete(vendorId, tenantId, deletedBy);
    return ok(undefined);
  }

  private async generateVendorCode(tenantId: TenantId): Promise<string> {
    const sequence = await this.vendorRepo.getNextSequence(tenantId);
    return `VND-${String(sequence).padStart(4, '0')}`;
  }
}
