import { randomHex } from '../common/id-generator.js';
/**
 * Customer domain service.
 * Handles customer onboarding, profile management, KYC verification,
 * and customer timeline tracking for the BORJIE platform.
 */

import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import {
  type Customer,
  type CustomerId,
  type CustomerProfile,
  type EmergencyContact,
  createCustomer,
  generateCustomerNumber,
  asCustomerId,
  ok,
  err,
} from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// Error Types
export const CustomerServiceError = {
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CUSTOMER_EMAIL_EXISTS: 'CUSTOMER_EMAIL_EXISTS',
  INVALID_CUSTOMER_DATA: 'INVALID_CUSTOMER_DATA',
  KYC_VERIFICATION_FAILED: 'KYC_VERIFICATION_FAILED',
  INVALID_DOCUMENT: 'INVALID_DOCUMENT',
} as const;

export type CustomerServiceErrorCode = (typeof CustomerServiceError)[keyof typeof CustomerServiceError];

export interface CustomerServiceErrorResult {
  code: CustomerServiceErrorCode;
  message: string;
}

// Repository Interface
export interface CustomerRepository {
  findById(id: CustomerId, tenantId: TenantId): Promise<Customer | null>;
  findByCustomerNumber(customerNumber: string, tenantId: TenantId): Promise<Customer | null>;
  findByEmail(email: string, tenantId: TenantId): Promise<Customer | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Customer>>;
  findByStatus(status: string, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Customer>>;
  search(query: string, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Customer>>;
  create(customer: Customer): Promise<Customer>;
  update(customer: Customer): Promise<Customer>;
  delete(id: CustomerId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

// Timeline Types
export type TimelineEventType = 
  | 'customer_created' | 'profile_updated' | 'kyc_verified'
  | 'lease_created' | 'payment_received' | 'maintenance_requested';

export interface TimelineEvent {
  readonly id: string;
  readonly customerId: CustomerId;
  readonly tenantId: TenantId;
  readonly eventType: TimelineEventType;
  readonly title: string;
  readonly description: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

export interface CustomerTimeline {
  readonly customerId: CustomerId;
  readonly events: readonly TimelineEvent[];
  readonly totalEvents: number;
}

// Input Types
export interface OnboardCustomerInput {
  profile: CustomerProfile;
  emergencyContacts?: EmergencyContact[];
  preferredLanguage?: string;
  notes?: string;
  source?: 'walk_in' | 'referral' | 'online' | 'agent' | 'other';
}

export interface UpdateProfileInput {
  profile?: Partial<CustomerProfile>;
  emergencyContacts?: EmergencyContact[];
  preferredLanguage?: string;
  notes?: string;
}

export interface KYCVerificationInput {
  documentType: 'national_id' | 'passport' | 'drivers_license' | 'other';
  documentNumber: string;
  documentExpiryDate?: ISOTimestamp;
  verificationMethod: 'manual' | 'automated' | 'third_party';
}

// Domain Events
export interface CustomerCreatedEvent {
  eventId: string;
  eventType: 'CustomerCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { customerId: CustomerId; customerNumber: string; email: string; fullName: string };
}

export interface CustomerKYCVerifiedEvent {
  eventId: string;
  eventType: 'CustomerKYCVerified';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { customerId: CustomerId; documentType: string; verificationMethod: string };
}

/**
 * Customer management service.
 */
export class CustomerService {
  constructor(
    private readonly customerRepo: CustomerRepository,
    private readonly eventBus: EventBus
  ) {}

  /** Onboard a new customer */
  async onboard(
    tenantId: TenantId,
    input: OnboardCustomerInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Customer, CustomerServiceErrorResult>> {
    if (!input.profile.email || !input.profile.firstName || !input.profile.lastName) {
      return err({ code: CustomerServiceError.INVALID_CUSTOMER_DATA, message: 'Email, first name, and last name are required' });
    }

    const existingByEmail = await this.customerRepo.findByEmail(input.profile.email, tenantId);
    if (existingByEmail) {
      return err({ code: CustomerServiceError.CUSTOMER_EMAIL_EXISTS, message: 'A customer with this email already exists' });
    }

    const customerNumber = await this.generateCustomerNumber(tenantId);
    const customerId = asCustomerId(`cust_${Date.now()}_${randomHex(4)}`);

    const customer = createCustomer(customerId, {
      tenantId,
      customerNumber,
      profile: input.profile,
      ...(input.emergencyContacts !== undefined ? { emergencyContacts: input.emergencyContacts } : {}),
      ...(input.preferredLanguage !== undefined ? { preferredLanguage: input.preferredLanguage } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    }, createdBy);

    const savedCustomer = await this.customerRepo.create(customer);

    const event: CustomerCreatedEvent = {
      eventId: generateEventId(), eventType: 'CustomerCreated',
      timestamp: new Date().toISOString(), tenantId, correlationId,
      causationId: null, metadata: {},
      payload: {
        customerId: savedCustomer.id, customerNumber: savedCustomer.customerNumber,
        email: savedCustomer.profile.email,
        fullName: `${savedCustomer.profile.firstName} ${savedCustomer.profile.lastName}`,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedCustomer.id, 'Customer'));
    return ok(savedCustomer);
  }

  async getCustomer(customerId: CustomerId, tenantId: TenantId): Promise<Customer | null> {
    return this.customerRepo.findById(customerId, tenantId);
  }

  async getCustomerByEmail(email: string, tenantId: TenantId): Promise<Customer | null> {
    return this.customerRepo.findByEmail(email, tenantId);
  }

  async listCustomers(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Customer>> {
    return this.customerRepo.findMany(tenantId, pagination);
  }

  async searchCustomers(query: string, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Customer>> {
    return this.customerRepo.search(query, tenantId, pagination);
  }

  /** Update customer profile */
  async updateProfile(
    customerId: CustomerId, tenantId: TenantId, input: UpdateProfileInput,
    updatedBy: UserId, correlationId: string
  ): Promise<Result<Customer, CustomerServiceErrorResult>> {
    const customer = await this.customerRepo.findById(customerId, tenantId);
    if (!customer) return err({ code: CustomerServiceError.CUSTOMER_NOT_FOUND, message: 'Customer not found' });

    if (input.profile?.email && input.profile.email !== customer.profile.email) {
      const existingByEmail = await this.customerRepo.findByEmail(input.profile.email, tenantId);
      if (existingByEmail) return err({ code: CustomerServiceError.CUSTOMER_EMAIL_EXISTS, message: 'Email already exists' });
    }

    const updatedCustomer: Customer = {
      ...customer,
      profile: input.profile ? { ...customer.profile, ...input.profile } : customer.profile,
      emergencyContacts: input.emergencyContacts ?? customer.emergencyContacts,
      preferredLanguage: input.preferredLanguage ?? customer.preferredLanguage,
      notes: input.notes ?? customer.notes,
      updatedAt: new Date().toISOString(), updatedBy,
    };
    return ok(await this.customerRepo.update(updatedCustomer));
  }

  /** Verify customer KYC */
  async verifyKYC(
    customerId: CustomerId, tenantId: TenantId, input: KYCVerificationInput,
    verifiedBy: UserId, correlationId: string
  ): Promise<Result<Customer, CustomerServiceErrorResult>> {
    const customer = await this.customerRepo.findById(customerId, tenantId);
    if (!customer) return err({ code: CustomerServiceError.CUSTOMER_NOT_FOUND, message: 'Customer not found' });

    const now = new Date().toISOString();
    // `metadata` was dropped from the Customer aggregate in the mining
    // hard-fork; we attach the KYC bag via a cast so the consumer surface
    // (api-gateway PATCH /customers/:id/kyc) still receives it.
    const verifiedCustomer: Customer = {
      ...customer, status: 'active', kycVerified: true, kycVerifiedAt: now,
      ...({ metadata: { ...(customer as { metadata?: Record<string, unknown> }).metadata, kycDocumentType: input.documentType, kycDocumentNumber: input.documentNumber } } as object),
      updatedAt: now, updatedBy: verifiedBy,
    } as Customer;
    const saved = await this.customerRepo.update(verifiedCustomer);

    const event: CustomerKYCVerifiedEvent = {
      eventId: generateEventId(), eventType: 'CustomerKYCVerified',
      timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
      payload: { customerId, documentType: input.documentType, verificationMethod: input.verificationMethod },
    };
    await this.eventBus.publish(createEventEnvelope(event, customerId, 'Customer'));
    return ok(saved);
  }

  /** Get customer timeline */
  async getTimeline(
    customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams
  ): Promise<Result<CustomerTimeline, CustomerServiceErrorResult>> {
    const customer = await this.customerRepo.findById(customerId, tenantId);
    if (!customer) return err({ code: CustomerServiceError.CUSTOMER_NOT_FOUND, message: 'Customer not found' });

    const events: TimelineEvent[] = [{
      id: `evt_${customer.id}_created`, customerId, tenantId, eventType: 'customer_created',
      title: 'Customer Onboarded',
      description: `Account created for ${customer.profile.firstName} ${customer.profile.lastName}`,
      metadata: { customerNumber: customer.customerNumber },
      createdAt: customer.createdAt, createdBy: customer.createdBy,
    }];

    if (customer.kycVerified && customer.kycVerifiedAt) {
      events.push({
        id: `evt_${customer.id}_kyc`, customerId, tenantId, eventType: 'kyc_verified',
        title: 'KYC Verified', description: 'Identity verification completed',
        metadata: {}, createdAt: customer.kycVerifiedAt, createdBy: customer.updatedBy ?? customer.createdBy,
      });
    }

    events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const offset = pagination?.offset ?? 0;
    const limit = pagination?.limit ?? 50;
    return ok({ customerId, events: events.slice(offset, offset + limit), totalEvents: events.length });
  }

  private async generateCustomerNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.customerRepo.getNextSequence(tenantId);
    return generateCustomerNumber(new Date().getFullYear(), sequence);
  }
}

export type { Customer, CustomerId, CustomerProfile, EmergencyContact };

// ---------------------------------------------------------------------------
// Financial Profile + Risk Reports (SCAFFOLDED-5, NEW-13)
// ---------------------------------------------------------------------------
export {
  FinancialProfileService,
  FinancialProfileError,
  type FinancialStatement,
  type FinancialStatementRepository,
  type LitigationRecord,
  type LitigationRepository,
  type IBankReferenceProvider,
  type BankReferenceQuery,
  type BankReferenceResult,
  type SubmitStatementInput,
  type RecordLitigationInput,
} from './financial-profile-service.js';
// Mining-domain Wave 5 — the legacy property-tenant repos
// (PostgresFinancialStatementRepository / PostgresLitigationRepository)
// have been removed. The mining equivalents live under
// `@borjie/domain-services/buyer`.

export {
  RiskReportService,
  RiskReportError,
  type TenantRiskReport,
  type RiskReportRepository,
  type RiskReportInputsProvider,
  type RiskNarrator,
  type RiskReportSnapshot,
  type RiskReportRecommendation,
} from './risk-report-service.js';
// Mining-domain Wave 5 — the legacy property-tenant risk-report repo +
// inputs provider have been removed. The mining-domain
// PostgresBuyerRiskReportRepository lives under
// `@borjie/domain-services/buyer`.
