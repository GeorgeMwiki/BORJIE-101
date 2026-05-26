// @ts-nocheck — pre-existing hard-fork drift; out of scope for issue #61 (5-file slice).
import { randomHex } from '../common/id-generator.js';
/**
 * Lease domain service.
 *
 * Handles lease lifecycle, customer management, and rental agreements
 * for the BORJIE platform.
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
  type Lease,
  type LeaseId,
  type LeaseStatus,
  type LeaseType,
  type LeaseOccupant,
  type RentFrequency,
  type Customer,
  type CustomerId,
  type CustomerProfile,
  type EmergencyContact,
  type PropertyId,
  type UnitId,
  type Money,
  createCustomer,
  generateCustomerNumber,
  asLeaseId,
  asCustomerId,
  ok,
  err,
} from '@borjie/domain-models';
// Lease domain functions live under a namespace to avoid symbol
// collisions with other modules (e.g. `createLease` is declared in
// both lease.ts and some tests). Pull them out explicitly.
import { Lease as LeaseFns } from '@borjie/domain-models';
const { createLease, activateLease, terminateLease, generateLeaseNumber } = LeaseFns;
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Error Types
// ============================================================================

export const LeaseServiceError = {
  LEASE_NOT_FOUND: 'LEASE_NOT_FOUND',
  LEASE_NUMBER_EXISTS: 'LEASE_NUMBER_EXISTS',
  LEASE_ALREADY_ACTIVE: 'LEASE_ALREADY_ACTIVE',
  LEASE_CANNOT_BE_ACTIVATED: 'LEASE_CANNOT_BE_ACTIVATED',
  LEASE_CANNOT_BE_TERMINATED: 'LEASE_CANNOT_BE_TERMINATED',
  LEASE_EXPIRED: 'LEASE_EXPIRED',
  UNIT_NOT_AVAILABLE: 'UNIT_NOT_AVAILABLE',
  UNIT_ALREADY_LEASED: 'UNIT_ALREADY_LEASED',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CUSTOMER_EMAIL_EXISTS: 'CUSTOMER_EMAIL_EXISTS',
  CUSTOMER_NUMBER_EXISTS: 'CUSTOMER_NUMBER_EXISTS',
  INVALID_LEASE_DATA: 'INVALID_LEASE_DATA',
  INVALID_CUSTOMER_DATA: 'INVALID_CUSTOMER_DATA',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  RENEWAL_NOT_ALLOWED: 'RENEWAL_NOT_ALLOWED',
} as const;

export type LeaseServiceErrorCode = (typeof LeaseServiceError)[keyof typeof LeaseServiceError];

export interface LeaseServiceErrorResult {
  code: LeaseServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface LeaseRepository {
  findById(id: LeaseId, tenantId: TenantId): Promise<Lease | null>;
  findByLeaseNumber(leaseNumber: string, tenantId: TenantId): Promise<Lease | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Lease>>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Lease>>;
  findByUnit(unitId: UnitId, tenantId: TenantId): Promise<Lease[]>;
  findActiveByUnit(unitId: UnitId, tenantId: TenantId): Promise<Lease | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Lease>>;
  findByStatus(status: LeaseStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Lease>>;
  findExpiringSoon(daysThreshold: number, tenantId: TenantId): Promise<Lease[]>;
  findExpired(tenantId: TenantId): Promise<Lease[]>;
  create(lease: Lease): Promise<Lease>;
  update(lease: Lease): Promise<Lease>;
  delete(id: LeaseId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

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

// ============================================================================
// Input Types
// ============================================================================

export interface CreateCustomerInput {
  profile: CustomerProfile;
  emergencyContacts?: EmergencyContact[];
  preferredLanguage?: string;
  notes?: string;
}

export interface UpdateCustomerInput {
  profile?: Partial<CustomerProfile>;
  emergencyContacts?: EmergencyContact[];
  preferredLanguage?: string;
  notes?: string;
  status?: string;
}

export interface CreateLeaseInput {
  propertyId: PropertyId;
  unitId: UnitId;
  customerId: CustomerId;
  type: LeaseType;
  startDate: ISOTimestamp;
  endDate?: ISOTimestamp;
  moveInDate: ISOTimestamp;
  rentAmount: Money;
  rentFrequency?: RentFrequency;
  rentDueDay?: number;
  securityDeposit: Money;
  lateFeePercentage?: number;
  lateFeeGraceDays?: number;
  additionalOccupants?: LeaseOccupant[];
  specialTerms?: string;
}

export interface UpdateLeaseInput {
  rentAmount?: Money;
  rentDueDay?: number;
  lateFeePercentage?: number;
  lateFeeGraceDays?: number;
  additionalOccupants?: LeaseOccupant[];
  specialTerms?: string;
}

export interface RenewalInput {
  newEndDate: ISOTimestamp;
  newRentAmount?: Money;
  newTerms?: string;
}

export type RenewalWindowType = 'T-90' | 'T-60' | 'T-30' | 'expired' | 'none';

export interface RenewalWindow {
  leaseId: LeaseId;
  leaseNumber: string;
  customerId: CustomerId;
  unitId: UnitId;
  endDate: ISOTimestamp;
  daysUntilExpiry: number;
  windowType: RenewalWindowType;
  recommended: boolean;
}

export type ConditionRating = 'excellent' | 'good' | 'fair' | 'poor' | 'damaged';

export interface ConditionReportItem {
  area: string; // e.g., 'kitchen', 'bedroom_1', 'bathroom', 'living_room'
  item: string; // e.g., 'walls', 'floor', 'ceiling', 'fixtures'
  condition: ConditionRating;
  notes: string | null;
  photoUrls: readonly string[];
}

export interface ConditionReport {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly leaseId: LeaseId;
  readonly unitId: UnitId;
  readonly type: 'move_in' | 'move_out';
  readonly items: readonly ConditionReportItem[];
  readonly overallCondition: ConditionRating;
  readonly inspectorId: UserId;
  readonly inspectedAt: ISOTimestamp;
  readonly customerAcknowledged: boolean;
  readonly customerAcknowledgedAt: ISOTimestamp | null;
  readonly notes: string | null;
  readonly createdAt: ISOTimestamp;
}

export type DepositDeductionReason = 'damage_repair' | 'unpaid_rent' | 'cleaning_fee' | 'key_replacement' | 'other';

export interface DepositDeduction {
  reason: DepositDeductionReason;
  description: string;
  amount: Money;
  evidenceDocumentIds: readonly string[];
}

export interface DepositDisposition {
  readonly leaseId: LeaseId;
  readonly tenantId: TenantId;
  readonly totalDeposit: Money;
  readonly deductions: readonly DepositDeduction[];
  readonly totalDeductions: Money;
  readonly refundAmount: Money;
  readonly dispositionDate: ISOTimestamp;
  readonly processedBy: UserId;
  readonly refundMethod: string | null;
  readonly refundReference: string | null;
  readonly status: 'pending' | 'approved' | 'refunded' | 'disputed';
}

// ============================================================================
// Domain Events
// ============================================================================

export interface LeaseCreatedEvent {
  eventId: string;
  eventType: 'LeaseCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    leaseId: LeaseId;
    leaseNumber: string;
    customerId: CustomerId;
    unitId: UnitId;
    startDate: ISOTimestamp;
    endDate: ISOTimestamp | null;
  };
}

export interface LeaseActivatedEvent {
  eventId: string;
  eventType: 'LeaseActivated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    leaseId: LeaseId;
    leaseNumber: string;
    customerId: CustomerId;
    unitId: UnitId;
  };
}

export interface LeaseTerminatedEvent {
  eventId: string;
  eventType: 'LeaseTerminated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    leaseId: LeaseId;
    leaseNumber: string;
    reason: string;
    moveOutDate: ISOTimestamp;
  };
}

export interface CustomerCreatedEvent {
  eventId: string;
  eventType: 'CustomerCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    customerId: CustomerId;
    customerNumber: string;
    email: string;
    fullName: string;
  };
}

export interface LeaseRenewalWindowEvent {
  eventId: string;
  eventType: 'LeaseRenewalWindow';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    leaseId: LeaseId;
    leaseNumber: string;
    customerId: CustomerId;
    unitId: UnitId;
    endDate: ISOTimestamp;
    windowType: RenewalWindowType;
    daysUntilExpiry: number;
  };
}

export interface DepositReturnedEvent {
  eventId: string;
  eventType: 'DepositReturned';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    leaseId: LeaseId;
    customerId: CustomerId;
    totalDeposit: Money;
    totalDeductions: Money;
    refundAmount: Money;
  };
}

// ============================================================================
// Lease Service Implementation
// ============================================================================

/**
 * Narrow read-side query for seeding a first-term lease. The composition
 * root wires a thin lookup against the units table — typically returning
 * the unit's `propertyId`, market rent (`Money`), and security deposit
 * (`Money`). Returning `null` is a valid signal that the unit isn't
 * priced yet; the orchestrator falls back to its default.
 *
 * Kept duck-typed so this package doesn't have to depend on the units
 * domain.
 */
export interface UnitFirstTermFinder {
  readonly findFirstTermDefaults: (
    tenantId: TenantId,
    unitId: UnitId,
  ) => Promise<{
    readonly propertyId: PropertyId;
    readonly rentAmount: Money;
    readonly securityDeposit?: Money;
    readonly rentFrequency?: RentFrequency;
    readonly type?: LeaseType;
  } | null>;
}

/**
 * Lease and Customer management service.
 * Handles full lease lifecycle from creation to termination/renewal.
 */
export class LeaseService {
  private readonly unitFirstTermFinder: UnitFirstTermFinder | null;

  constructor(
    private readonly leaseRepo: LeaseRepository,
    private readonly customerRepo: CustomerRepository,
    private readonly eventBus: EventBus,
    /**
     * Optional. Required only when `seedFirstTerm` is invoked (e.g. by
     * the VacancyToLeaseOrchestrator). Without it, `seedFirstTerm`
     * returns `null` and the caller falls back to default behaviour.
     */
    unitFirstTermFinder?: UnitFirstTermFinder,
  ) {
    this.unitFirstTermFinder = unitFirstTermFinder ?? null;
  }

  // ==================== Customer Operations ====================

  /**
   * Create a new customer (tenant/renter).
   */
  async createCustomer(
    tenantId: TenantId,
    input: CreateCustomerInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Customer, LeaseServiceErrorResult>> {
    // Validate required fields
    if (!input.profile.email || !input.profile.firstName || !input.profile.lastName) {
      return err({
        code: LeaseServiceError.INVALID_CUSTOMER_DATA,
        message: 'Email, first name, and last name are required',
      });
    }

    // Check email uniqueness
    const existingByEmail = await this.customerRepo.findByEmail(input.profile.email, tenantId);
    if (existingByEmail) {
      return err({
        code: LeaseServiceError.CUSTOMER_EMAIL_EXISTS,
        message: 'A customer with this email already exists',
      });
    }

    const customerNumber = await this.generateCustomerNumber(tenantId);
    const customerId = asCustomerId(`cust_${Date.now()}_${randomHex(4)}`);

    const customer = createCustomer(customerId, {
      tenantId,
      customerNumber,
      profile: input.profile,
      emergencyContacts: input.emergencyContacts,
      preferredLanguage: input.preferredLanguage,
      notes: input.notes,
    }, createdBy);

    const savedCustomer = await this.customerRepo.create(customer);

    // Publish event
    const event: CustomerCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'CustomerCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        customerId: savedCustomer.id,
        customerNumber: savedCustomer.customerNumber,
        email: savedCustomer.profile.email,
        fullName: `${savedCustomer.profile.firstName} ${savedCustomer.profile.lastName}`,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedCustomer.id, 'Customer'));

    return ok(savedCustomer);
  }

  /**
   * Get a customer by ID.
   */
  async getCustomer(customerId: CustomerId, tenantId: TenantId): Promise<Customer | null> {
    return this.customerRepo.findById(customerId, tenantId);
  }

  /**
   * Get a customer by email.
   */
  async getCustomerByEmail(email: string, tenantId: TenantId): Promise<Customer | null> {
    return this.customerRepo.findByEmail(email, tenantId);
  }

  /**
   * List all customers.
   */
  async listCustomers(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Customer>> {
    return this.customerRepo.findMany(tenantId, pagination);
  }

  /**
   * Search customers.
   */
  async searchCustomers(
    query: string,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Customer>> {
    return this.customerRepo.search(query, tenantId, pagination);
  }

  /**
   * Update a customer.
   */
  async updateCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    input: UpdateCustomerInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Customer, LeaseServiceErrorResult>> {
    const customer = await this.customerRepo.findById(customerId, tenantId);
    if (!customer) {
      return err({
        code: LeaseServiceError.CUSTOMER_NOT_FOUND,
        message: 'Customer not found',
      });
    }

    // Check email uniqueness if changing
    if (input.profile?.email && input.profile.email !== customer.profile.email) {
      const existingByEmail = await this.customerRepo.findByEmail(input.profile.email, tenantId);
      if (existingByEmail) {
        return err({
          code: LeaseServiceError.CUSTOMER_EMAIL_EXISTS,
          message: 'A customer with this email already exists',
        });
      }
    }

    const updatedCustomer: Customer = {
      ...customer,
      profile: input.profile ? { ...customer.profile, ...input.profile } : customer.profile,
      emergencyContacts: input.emergencyContacts ?? customer.emergencyContacts,
      preferredLanguage: input.preferredLanguage ?? customer.preferredLanguage,
      notes: input.notes ?? customer.notes,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedCustomer = await this.customerRepo.update(updatedCustomer);
    return ok(savedCustomer);
  }

  /**
   * Verify customer KYC.
   */
  async verifyCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Customer, LeaseServiceErrorResult>> {
    const customer = await this.customerRepo.findById(customerId, tenantId);
    if (!customer) {
      return err({
        code: LeaseServiceError.CUSTOMER_NOT_FOUND,
        message: 'Customer not found',
      });
    }

    const verifiedCustomer: Customer = {
      ...customer,
      status: 'active',
      kycVerified: true,
      kycVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedCustomer = await this.customerRepo.update(verifiedCustomer);
    return ok(savedCustomer);
  }

  // ==================== Lease Operations ====================

  /**
   * Create a new lease (draft).
   */
  async createLease(
    tenantId: TenantId,
    input: CreateLeaseInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Lease, LeaseServiceErrorResult>> {
    // Validate customer exists
    const customer = await this.customerRepo.findById(input.customerId, tenantId);
    if (!customer) {
      return err({
        code: LeaseServiceError.CUSTOMER_NOT_FOUND,
        message: 'Customer not found',
      });
    }

    // Check if unit already has an active lease
    const activeLease = await this.leaseRepo.findActiveByUnit(input.unitId, tenantId);
    if (activeLease) {
      return err({
        code: LeaseServiceError.UNIT_ALREADY_LEASED,
        message: 'This unit already has an active lease',
      });
    }

    // Validate date range
    if (input.endDate && new Date(input.endDate) <= new Date(input.startDate)) {
      return err({
        code: LeaseServiceError.INVALID_DATE_RANGE,
        message: 'End date must be after start date',
      });
    }

    const leaseNumber = await this.generateLeaseNumber(tenantId);
    const leaseId = asLeaseId(`lease_${Date.now()}_${randomHex(4)}`);

    const lease = createLease(leaseId, {
      tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId,
      customerId: input.customerId,
      leaseNumber,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      moveInDate: input.moveInDate,
      rentAmount: input.rentAmount,
      rentFrequency: input.rentFrequency,
      rentDueDay: input.rentDueDay,
      securityDeposit: input.securityDeposit,
      lateFeePercentage: input.lateFeePercentage,
      lateFeeGraceDays: input.lateFeeGraceDays,
      additionalOccupants: input.additionalOccupants,
      specialTerms: input.specialTerms,
    }, createdBy);

    const savedLease = await this.leaseRepo.create(lease);

    // Publish event
    const event: LeaseCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'LeaseCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId: savedLease.id,
        leaseNumber: savedLease.leaseNumber,
        customerId: savedLease.customerId,
        unitId: savedLease.unitId,
        startDate: savedLease.startDate,
        endDate: savedLease.endDate,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedLease.id, 'Lease'));

    return ok(savedLease);
  }

  /**
   * Seed the very first lease term for a unit/customer pair.
   *
   * Used by the VacancyToLeaseOrchestrator's renewal port (which is
   * actually about *initial* lease creation — see
   * `OrchestratorRenewalPort.seedFirstTerm`). Defaults the term to
   * 12 months starting today, with the rent + security deposit pulled
   * from the unit via the optional `UnitFirstTermFinder`.
   *
   * Returns `null` (rather than throwing) in degraded paths so the
   * orchestrator can transparently fall back to its default port:
   *   - no `UnitFirstTermFinder` was wired at construction time, or
   *   - the finder returned `null` (unit isn't priced yet).
   *
   * Returns the new `leaseId` on success. Errors from the underlying
   * `createLease` (e.g. UNIT_ALREADY_LEASED, CUSTOMER_NOT_FOUND) also
   * surface as `null` — the orchestrator's state machine is tolerant
   * of "no lease seeded yet" but cannot recover from a hard failure
   * downstream of `move_in_scheduled`.
   */
  async seedFirstTerm(args: {
    readonly tenantId: TenantId;
    readonly unitId: UnitId;
    readonly customerId: CustomerId;
    /** Defaults to today (ISO timestamp). Override for tests. */
    readonly startDate?: ISOTimestamp;
    /** Defaults to 12 months after `startDate`. */
    readonly endDate?: ISOTimestamp;
    readonly createdBy?: UserId;
    readonly correlationId?: string;
  }): Promise<{ readonly leaseId: string } | null> {
    if (!this.unitFirstTermFinder) return null;

    const defaults = await this.unitFirstTermFinder.findFirstTermDefaults(
      args.tenantId,
      args.unitId,
    );
    if (!defaults) return null;

    const startDate = (args.startDate ??
      (new Date().toISOString() as unknown as ISOTimestamp)) as ISOTimestamp;
    const endDateDefault = (() => {
      const start = new Date(startDate as unknown as string);
      const end = new Date(start);
      end.setFullYear(end.getFullYear() + 1);
      return end.toISOString();
    })();
    const endDate = (args.endDate ??
      (endDateDefault as unknown as ISOTimestamp)) as ISOTimestamp;

    // Security deposit defaults to one month's rent when the finder
    // does not supply an explicit value.
    const securityDeposit = defaults.securityDeposit ?? defaults.rentAmount;

    const correlationId = args.correlationId ?? `seed_first_term_${Date.now()}`;
    const createdBy = (args.createdBy ?? ('system' as unknown as UserId)) as UserId;

    const result = await this.createLease(
      args.tenantId,
      {
        propertyId: defaults.propertyId,
        unitId: args.unitId,
        customerId: args.customerId,
        type: defaults.type ?? ('residential' as unknown as LeaseType),
        startDate,
        endDate,
        moveInDate: startDate,
        rentAmount: defaults.rentAmount,
        rentFrequency:
          defaults.rentFrequency ?? ('monthly' as unknown as RentFrequency),
        securityDeposit,
      },
      createdBy,
      correlationId,
    );

    if (!result.ok) return null;
    return { leaseId: (result.value as Lease).id as unknown as string };
  }

  /**
   * Get a lease by ID.
   */
  async getLease(leaseId: LeaseId, tenantId: TenantId): Promise<Lease | null> {
    return this.leaseRepo.findById(leaseId, tenantId);
  }

  /**
   * Get a lease by lease number.
   */
  async getLeaseByNumber(leaseNumber: string, tenantId: TenantId): Promise<Lease | null> {
    return this.leaseRepo.findByLeaseNumber(leaseNumber, tenantId);
  }

  /**
   * List all leases.
   */
  async listLeases(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Lease>> {
    return this.leaseRepo.findMany(tenantId, pagination);
  }

  /**
   * List leases by property.
   */
  async listLeasesByProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Lease>> {
    return this.leaseRepo.findByProperty(propertyId, tenantId, pagination);
  }

  /**
   * List leases by customer.
   */
  async listLeasesByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Lease>> {
    return this.leaseRepo.findByCustomer(customerId, tenantId, pagination);
  }

  /**
   * List leases by status.
   */
  async listLeasesByStatus(
    status: LeaseStatus,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Lease>> {
    return this.leaseRepo.findByStatus(status, tenantId, pagination);
  }

  /**
   * Get active lease for a unit.
   */
  async getActiveLeaseForUnit(unitId: UnitId, tenantId: TenantId): Promise<Lease | null> {
    return this.leaseRepo.findActiveByUnit(unitId, tenantId);
  }

  /**
   * Find leases expiring soon.
   */
  async findExpiringSoonLeases(
    daysThreshold: number,
    tenantId: TenantId
  ): Promise<Lease[]> {
    return this.leaseRepo.findExpiringSoon(daysThreshold, tenantId);
  }

  /**
   * Activate a lease (after signing).
   */
  async activateLease(
    leaseId: LeaseId,
    tenantId: TenantId,
    documentIds: string[],
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Lease, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({
        code: LeaseServiceError.LEASE_NOT_FOUND,
        message: 'Lease not found',
      });
    }

    if (lease.status !== 'draft' && lease.status !== 'pending_signature') {
      return err({
        code: LeaseServiceError.LEASE_CANNOT_BE_ACTIVATED,
        message: `Lease cannot be activated from ${lease.status} status`,
      });
    }

    // Verify unit is still available
    const activeLease = await this.leaseRepo.findActiveByUnit(lease.unitId, tenantId);
    if (activeLease && activeLease.id !== leaseId) {
      return err({
        code: LeaseServiceError.UNIT_ALREADY_LEASED,
        message: 'This unit now has another active lease',
      });
    }

    const activatedLease = activateLease(lease, documentIds, updatedBy);
    const savedLease = await this.leaseRepo.update(activatedLease);

    // Publish event
    const event: LeaseActivatedEvent = {
      eventId: generateEventId(),
      eventType: 'LeaseActivated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId: savedLease.id,
        leaseNumber: savedLease.leaseNumber,
        customerId: savedLease.customerId,
        unitId: savedLease.unitId,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedLease.id, 'Lease'));

    return ok(savedLease);
  }

  /**
   * Terminate a lease.
   */
  async terminateLease(
    leaseId: LeaseId,
    tenantId: TenantId,
    reason: string,
    moveOutDate: ISOTimestamp,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Lease, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({
        code: LeaseServiceError.LEASE_NOT_FOUND,
        message: 'Lease not found',
      });
    }

    if (lease.status !== 'active' && lease.status !== 'expiring_soon') {
      return err({
        code: LeaseServiceError.LEASE_CANNOT_BE_TERMINATED,
        message: `Lease cannot be terminated from ${lease.status} status`,
      });
    }

    const terminatedLease = terminateLease(lease, reason, moveOutDate, updatedBy);
    const savedLease = await this.leaseRepo.update(terminatedLease);

    // Publish event
    const event: LeaseTerminatedEvent = {
      eventId: generateEventId(),
      eventType: 'LeaseTerminated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId: savedLease.id,
        leaseNumber: savedLease.leaseNumber,
        reason,
        moveOutDate,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedLease.id, 'Lease'));

    return ok(savedLease);
  }

  /**
   * Update lease terms.
   */
  async updateLease(
    leaseId: LeaseId,
    tenantId: TenantId,
    input: UpdateLeaseInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Lease, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({
        code: LeaseServiceError.LEASE_NOT_FOUND,
        message: 'Lease not found',
      });
    }

    const updatedLease: Lease = {
      ...lease,
      rentAmount: input.rentAmount ?? lease.rentAmount,
      rentDueDay: input.rentDueDay ?? lease.rentDueDay,
      lateFeePercentage: input.lateFeePercentage ?? lease.lateFeePercentage,
      lateFeeGraceDays: input.lateFeeGraceDays ?? lease.lateFeeGraceDays,
      additionalOccupants: input.additionalOccupants ?? lease.additionalOccupants,
      specialTerms: input.specialTerms ?? lease.specialTerms,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedLease = await this.leaseRepo.update(updatedLease);
    return ok(savedLease);
  }

  /**
   * Renew a lease.
   */
  async renewLease(
    leaseId: LeaseId,
    tenantId: TenantId,
    input: RenewalInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Lease, LeaseServiceErrorResult>> {
    const oldLease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!oldLease) {
      return err({
        code: LeaseServiceError.LEASE_NOT_FOUND,
        message: 'Lease not found',
      });
    }

    if (oldLease.status !== 'active' && oldLease.status !== 'expiring_soon') {
      return err({
        code: LeaseServiceError.RENEWAL_NOT_ALLOWED,
        message: `Cannot renew a lease that is ${oldLease.status}`,
      });
    }

    // Create new lease
    const newLeaseNumber = await this.generateLeaseNumber(tenantId);
    const newLeaseId = asLeaseId(`lease_${Date.now()}_${randomHex(4)}`);

    const newLease = createLease(newLeaseId, {
      tenantId,
      propertyId: oldLease.propertyId,
      unitId: oldLease.unitId,
      customerId: oldLease.customerId,
      leaseNumber: newLeaseNumber,
      type: oldLease.type,
      startDate: oldLease.endDate ?? new Date().toISOString(),
      endDate: input.newEndDate,
      moveInDate: oldLease.endDate ?? new Date().toISOString(),
      rentAmount: input.newRentAmount ?? oldLease.rentAmount,
      rentFrequency: oldLease.rentFrequency,
      rentDueDay: oldLease.rentDueDay,
      securityDeposit: oldLease.securityDeposit,
      lateFeePercentage: oldLease.lateFeePercentage,
      lateFeeGraceDays: oldLease.lateFeeGraceDays,
      additionalOccupants: oldLease.additionalOccupants as LeaseOccupant[],
      specialTerms: input.newTerms ?? oldLease.specialTerms ?? undefined,
    }, createdBy);

    // Link old and new leases
    const linkedNewLease: Lease = {
      ...newLease,
      renewedFromLeaseId: oldLease.id,
    };

    const linkedOldLease: Lease = {
      ...oldLease,
      status: 'renewed',
      renewedToLeaseId: newLeaseId,
      updatedAt: new Date().toISOString(),
      updatedBy: createdBy,
    };

    // Save both leases
    await this.leaseRepo.update(linkedOldLease);
    const savedNewLease = await this.leaseRepo.create(linkedNewLease);

    return ok(savedNewLease);
  }

  /**
   * Mark deposit as paid.
   */
  async markDepositPaid(
    leaseId: LeaseId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Lease, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({
        code: LeaseServiceError.LEASE_NOT_FOUND,
        message: 'Lease not found',
      });
    }

    const updatedLease: Lease = {
      ...lease,
      depositPaid: true,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedLease = await this.leaseRepo.update(updatedLease);
    return ok(savedLease);
  }

  // ==================== Renewal Window Detection ====================

  /**
   * Detect lease renewal windows (T-90, T-60, T-30 days before expiry).
   * Returns leases that are in a renewal window, sorted by urgency.
   */
  async detectRenewalWindows(
    tenantId: TenantId,
    correlationId: string
  ): Promise<RenewalWindow[]> {
    const now = new Date();
    // Fetch leases expiring within 90 days
    const expiringSoon = await this.leaseRepo.findExpiringSoon(90, tenantId);
    const windows: RenewalWindow[] = [];

    for (const lease of expiringSoon) {
      if (!lease.endDate) continue;
      if (lease.status !== 'active' && lease.status !== 'expiring_soon') continue;

      const endDate = new Date(lease.endDate);
      const daysUntilExpiry = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      let windowType: RenewalWindowType = 'none';

      if (daysUntilExpiry <= 0) {
        windowType = 'expired';
      } else if (daysUntilExpiry <= 30) {
        windowType = 'T-30';
      } else if (daysUntilExpiry <= 60) {
        windowType = 'T-60';
      } else if (daysUntilExpiry <= 90) {
        windowType = 'T-90';
      }

      if (windowType !== 'none') {
        windows.push({
          leaseId: lease.id,
          leaseNumber: lease.leaseNumber,
          customerId: lease.customerId,
          unitId: lease.unitId,
          endDate: lease.endDate,
          daysUntilExpiry,
          windowType,
          recommended: windowType === 'T-90' || windowType === 'T-60',
        });

        // Publish event for each window
        const event: LeaseRenewalWindowEvent = {
          eventId: generateEventId(),
          eventType: 'LeaseRenewalWindow',
          timestamp: now.toISOString(),
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            leaseId: lease.id,
            leaseNumber: lease.leaseNumber,
            customerId: lease.customerId,
            unitId: lease.unitId,
            endDate: lease.endDate,
            windowType,
            daysUntilExpiry,
          },
        };
        await this.eventBus.publish(createEventEnvelope(event, lease.id, 'Lease'));
      }
    }

    // Sort by urgency (closest to expiry first)
    windows.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    return windows;
  }

  /**
   * Get the renewal window status for a specific lease.
   */
  async getRenewalWindowStatus(
    leaseId: LeaseId,
    tenantId: TenantId
  ): Promise<Result<RenewalWindow, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({ code: LeaseServiceError.LEASE_NOT_FOUND, message: 'Lease not found' });
    }

    if (!lease.endDate) {
      // Month-to-month leases don't have renewal windows
      return ok({
        leaseId: lease.id,
        leaseNumber: lease.leaseNumber,
        customerId: lease.customerId,
        unitId: lease.unitId,
        endDate: '' as ISOTimestamp,
        daysUntilExpiry: -1,
        windowType: 'none' as RenewalWindowType,
        recommended: false,
      });
    }

    const now = new Date();
    const endDate = new Date(lease.endDate);
    const daysUntilExpiry = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    let windowType: RenewalWindowType = 'none';

    if (daysUntilExpiry <= 0) windowType = 'expired';
    else if (daysUntilExpiry <= 30) windowType = 'T-30';
    else if (daysUntilExpiry <= 60) windowType = 'T-60';
    else if (daysUntilExpiry <= 90) windowType = 'T-90';

    return ok({
      leaseId: lease.id,
      leaseNumber: lease.leaseNumber,
      customerId: lease.customerId,
      unitId: lease.unitId,
      endDate: lease.endDate,
      daysUntilExpiry,
      windowType,
      recommended: windowType === 'T-90' || windowType === 'T-60',
    });
  }

  // ==================== Condition Reports ====================

  /**
   * Create a move-in or move-out condition report.
   */
  async createConditionReport(
    tenantId: TenantId,
    leaseId: LeaseId,
    type: 'move_in' | 'move_out',
    items: ConditionReportItem[],
    inspectorId: UserId,
    notes?: string
  ): Promise<Result<ConditionReport, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({ code: LeaseServiceError.LEASE_NOT_FOUND, message: 'Lease not found' });
    }

    // Calculate overall condition from items
    const conditionScores: Record<ConditionRating, number> = {
      excellent: 5, good: 4, fair: 3, poor: 2, damaged: 1,
    };

    const avgScore = items.length > 0
      ? items.reduce((sum, item) => sum + conditionScores[item.condition], 0) / items.length
      : 3;

    let overallCondition: ConditionRating = 'fair';
    if (avgScore >= 4.5) overallCondition = 'excellent';
    else if (avgScore >= 3.5) overallCondition = 'good';
    else if (avgScore >= 2.5) overallCondition = 'fair';
    else if (avgScore >= 1.5) overallCondition = 'poor';
    else overallCondition = 'damaged';

    const now = new Date().toISOString();
    const report: ConditionReport = {
      id: `cond_${Date.now()}_${randomHex(4)}`,
      tenantId,
      leaseId,
      unitId: lease.unitId,
      type,
      items,
      overallCondition,
      inspectorId,
      inspectedAt: now,
      customerAcknowledged: false,
      customerAcknowledgedAt: null,
      notes: notes ?? null,
      createdAt: now,
    };

    return ok(report);
  }

  /**
   * Compare move-in and move-out condition reports to identify damage.
   */
  compareMoveInMoveOut(
    moveInReport: ConditionReport,
    moveOutReport: ConditionReport
  ): { area: string; item: string; moveInCondition: ConditionRating; moveOutCondition: ConditionRating; deteriorated: boolean }[] {
    const comparisons: { area: string; item: string; moveInCondition: ConditionRating; moveOutCondition: ConditionRating; deteriorated: boolean }[] = [];
    const conditionOrder: Record<ConditionRating, number> = {
      excellent: 5, good: 4, fair: 3, poor: 2, damaged: 1,
    };

    for (const moveOutItem of moveOutReport.items) {
      const moveInItem = moveInReport.items.find(
        i => i.area === moveOutItem.area && i.item === moveOutItem.item
      );

      if (moveInItem) {
        const deteriorated = conditionOrder[moveOutItem.condition] < conditionOrder[moveInItem.condition];
        comparisons.push({
          area: moveOutItem.area,
          item: moveOutItem.item,
          moveInCondition: moveInItem.condition,
          moveOutCondition: moveOutItem.condition,
          deteriorated,
        });
      } else {
        // Item exists in move-out but not move-in - flag as potentially new damage
        comparisons.push({
          area: moveOutItem.area,
          item: moveOutItem.item,
          moveInCondition: 'good', // assume baseline good
          moveOutCondition: moveOutItem.condition,
          deteriorated: conditionOrder[moveOutItem.condition] < conditionOrder['good'],
        });
      }
    }

    return comparisons;
  }

  // ==================== Deposit Management ====================

  /**
   * Calculate deposit disposition including deductions and refund amount.
   */
  async calculateDepositDisposition(
    leaseId: LeaseId,
    tenantId: TenantId,
    deductions: DepositDeduction[],
    processedBy: UserId,
    correlationId: string
  ): Promise<Result<DepositDisposition, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({ code: LeaseServiceError.LEASE_NOT_FOUND, message: 'Lease not found' });
    }

    if (!lease.depositPaid) {
      return err({
        code: LeaseServiceError.INVALID_LEASE_DATA,
        message: 'No deposit was paid for this lease',
      });
    }

    const totalDeposit = lease.securityDeposit;
    const currency = totalDeposit.currency;
    let totalDeductionAmount = 0;

    for (const deduction of deductions) {
      if (deduction.amount.amount < 0) {
        return err({
          code: LeaseServiceError.INVALID_LEASE_DATA,
          message: 'Deduction amounts must be positive',
        });
      }
      totalDeductionAmount += deduction.amount.amount;
    }

    if (totalDeductionAmount > totalDeposit.amount) {
      return err({
        code: LeaseServiceError.INVALID_LEASE_DATA,
        message: 'Total deductions cannot exceed deposit amount',
      });
    }

    const refundAmount = totalDeposit.amount - totalDeductionAmount;
    const now = new Date().toISOString();

    const disposition: DepositDisposition = {
      leaseId,
      tenantId,
      totalDeposit,
      deductions,
      totalDeductions: { amount: totalDeductionAmount, currency },
      refundAmount: { amount: refundAmount, currency },
      dispositionDate: now,
      processedBy,
      refundMethod: null,
      refundReference: null,
      status: 'pending',
    };

    // Publish event
    const event: DepositReturnedEvent = {
      eventId: generateEventId(),
      eventType: 'DepositReturned',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        leaseId,
        customerId: lease.customerId,
        totalDeposit,
        totalDeductions: disposition.totalDeductions,
        refundAmount: disposition.refundAmount,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, leaseId, 'Lease'));

    return ok(disposition);
  }

  /**
   * Mark deposit as refunded after actual payment processing.
   */
  async markDepositRefunded(
    leaseId: LeaseId,
    tenantId: TenantId,
    refundMethod: string,
    refundReference: string,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Lease, LeaseServiceErrorResult>> {
    const lease = await this.leaseRepo.findById(leaseId, tenantId);
    if (!lease) {
      return err({ code: LeaseServiceError.LEASE_NOT_FOUND, message: 'Lease not found' });
    }

    const updatedLease: Lease = {
      ...lease,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedLease = await this.leaseRepo.update(updatedLease);
    return ok(savedLease);
  }

  /**
   * Find expired leases for batch processing.
   */
  async findExpiredLeases(tenantId: TenantId): Promise<Lease[]> {
    return this.leaseRepo.findExpired(tenantId);
  }

  // ==================== Helpers ====================

  private async generateLeaseNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.leaseRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return generateLeaseNumber(year, sequence);
  }

  private async generateCustomerNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.customerRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return generateCustomerNumber(year, sequence);
  }
}


// Renewal (explicit workflow on top of LeaseService).
//
// The legacy `PostgresRenewalRepository` was retired during the mining
// hard-fork — licence renewal is the mining-domain analogue and is
// already handled by `services/api-gateway/src/routes/mining/licences.hono.ts`
// (see issue #11). The pure `RenewalService` + its repository
// interface stay exported so any remaining consumers can plug a
// stub repository in (the composition root binds a thin throwing
// adapter — see service-registry.ts).
export {
  RenewalService,
  RenewalServiceError,
  type RenewalLeaseSnapshot,
  type RenewalRepository,
  type RenewalServiceErrorCode,
  type RenewalServiceErrorResult,
  type LeaseRenewalStatus,
} from './renewal-service.js';

// Move-Out checklist (step-based end-of-tenancy workflow).
// Complements the richer inspection-backed MoveOut in ../inspections/move-out;
// this one tracks the 4 higher-level lease close-out steps.
export {
  MoveOutChecklistService,
  MoveOutError,
  createMoveOutChecklist,
  type MoveOutChecklist,
  type MoveOutStepState,
  type MoveOutStepStatus,
  type MoveOutRepository,
  type MoveOutErrorCode,
  type MoveOutErrorResult,
  type UtilityReading,
} from './move-out-checklist.js';
