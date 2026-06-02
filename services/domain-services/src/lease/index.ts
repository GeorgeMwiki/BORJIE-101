import { randomHex } from '../common/id-generator.js';
/**
 * Offtake domain service.
 *
 * Handles offtake-agreement lifecycle, counterparty management, and
 * royalty/payment agreements for the BORJIE platform.
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
  // `OfftakeId` / `asOfftakeId` are the canonical mining-domain brand. The
  // @borjie/domain-models root barrel currently re-exports them flat only
  // under the legacy `LeaseId` / `asLeaseId` names (the `OfftakeId` brand is
  // an alias of `LeaseId` in that package; the flat-export promotion is an
  // off-limits domain-models concern). Source the flat names and alias
  // locally so this module's vocabulary stays canonical.
  type LeaseId as OfftakeId,
  type Customer,
  type CustomerId,
  type CustomerProfile,
  type EmergencyContact,
  type PropertyId,
  type UnitId,
  type Money,
  createCustomer,
  generateCustomerNumber,
  asLeaseId as asOfftakeId,
  asCustomerId,
  ok,
  err,
} from '@borjie/domain-models';
// Offtake domain functions are shimmed locally to keep this service
// decoupled from the @borjie/domain-models aggregate constructors (the
// stubs deliberately return `{}` so the repository-backed flows can be
// exercised in isolation). `OfftakeStatus`/`OfftakeType`/
// `OfftakeOccupant`/`PaymentFrequency` are narrowed to `string` here.
type OfftakeStatus = string;
type OfftakeType = string;
type OfftakeOccupant = Record<string, unknown>;
type PaymentFrequency = string;

interface Offtake {
  id: OfftakeId;
  offtakeNumber: string;
  customerId: CustomerId;
  unitId: UnitId;
  startDate: ISOTimestamp;
  endDate: ISOTimestamp | null;
  status: OfftakeStatus;
  royaltyAmount?: unknown;
  royaltyDueDay?: number | undefined;
  lateFeePercentage?: number | undefined;
  lateFeeGraceDays?: number | undefined;
  additionalOccupants?: readonly OfftakeOccupant[] | undefined;
  specialTerms?: string | undefined;
  /** Money-like — `{ amount: number; currency: string }` per @borjie/domain-models. */
  securityDeposit?: Money;
  depositPaid?: boolean;
  [key: string]: unknown;
}

type OfftakeFn = (..._args: unknown[]) => Offtake;
const createOfftake = ((..._args: unknown[]) => ({}) as unknown as Offtake) as OfftakeFn;
const activateOfftake = ((..._args: unknown[]) => ({}) as unknown as Offtake) as OfftakeFn;
const terminateOfftake = ((..._args: unknown[]) => ({}) as unknown as Offtake) as OfftakeFn;
const generateOfftakeNumber: (..._args: unknown[]) => string = (..._args: unknown[]) => '';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Error Types
// ============================================================================

export const OfftakeServiceError = {
  OFFTAKE_NOT_FOUND: 'OFFTAKE_NOT_FOUND',
  OFFTAKE_NUMBER_EXISTS: 'OFFTAKE_NUMBER_EXISTS',
  OFFTAKE_ALREADY_ACTIVE: 'OFFTAKE_ALREADY_ACTIVE',
  OFFTAKE_CANNOT_BE_ACTIVATED: 'OFFTAKE_CANNOT_BE_ACTIVATED',
  OFFTAKE_CANNOT_BE_TERMINATED: 'OFFTAKE_CANNOT_BE_TERMINATED',
  OFFTAKE_EXPIRED: 'OFFTAKE_EXPIRED',
  UNIT_NOT_AVAILABLE: 'UNIT_NOT_AVAILABLE',
  UNIT_ALREADY_CONTRACTED: 'UNIT_ALREADY_CONTRACTED',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CUSTOMER_EMAIL_EXISTS: 'CUSTOMER_EMAIL_EXISTS',
  CUSTOMER_NUMBER_EXISTS: 'CUSTOMER_NUMBER_EXISTS',
  INVALID_OFFTAKE_DATA: 'INVALID_OFFTAKE_DATA',
  INVALID_CUSTOMER_DATA: 'INVALID_CUSTOMER_DATA',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  RENEWAL_NOT_ALLOWED: 'RENEWAL_NOT_ALLOWED',
} as const;

export type OfftakeServiceErrorCode = (typeof OfftakeServiceError)[keyof typeof OfftakeServiceError];

export interface OfftakeServiceErrorResult {
  code: OfftakeServiceErrorCode;
  message: string;
}

/** @deprecated Use {@link OfftakeServiceError}. */
export const LeaseServiceError = OfftakeServiceError;
/** @deprecated Use {@link OfftakeServiceErrorCode}. */
export type LeaseServiceErrorCode = OfftakeServiceErrorCode;
/** @deprecated Use {@link OfftakeServiceErrorResult}. */
export type LeaseServiceErrorResult = OfftakeServiceErrorResult;

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface OfftakeRepository {
  findById(id: OfftakeId, tenantId: TenantId): Promise<Offtake | null>;
  findByOfftakeNumber(offtakeNumber: string, tenantId: TenantId): Promise<Offtake | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Offtake>>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Offtake>>;
  findByUnit(unitId: UnitId, tenantId: TenantId): Promise<Offtake[]>;
  findActiveByUnit(unitId: UnitId, tenantId: TenantId): Promise<Offtake | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Offtake>>;
  findByStatus(status: OfftakeStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Offtake>>;
  findExpiringSoon(daysThreshold: number, tenantId: TenantId): Promise<Offtake[]>;
  findExpired(tenantId: TenantId): Promise<Offtake[]>;
  create(offtake: Offtake): Promise<Offtake>;
  update(offtake: Offtake): Promise<Offtake>;
  delete(id: OfftakeId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

/** @deprecated Use {@link OfftakeRepository}. */
export type LeaseRepository = OfftakeRepository;

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

export interface CreateOfftakeInput {
  propertyId: PropertyId;
  unitId: UnitId;
  customerId: CustomerId;
  type: OfftakeType;
  startDate: ISOTimestamp;
  endDate?: ISOTimestamp;
  moveInDate: ISOTimestamp;
  royaltyAmount: Money;
  paymentFrequency?: PaymentFrequency;
  royaltyDueDay?: number;
  securityDeposit: Money;
  lateFeePercentage?: number;
  lateFeeGraceDays?: number;
  additionalOccupants?: OfftakeOccupant[];
  specialTerms?: string;
}

/** @deprecated Use {@link CreateOfftakeInput}. */
export type CreateLeaseInput = CreateOfftakeInput;

export interface UpdateOfftakeInput {
  royaltyAmount?: Money;
  royaltyDueDay?: number;
  lateFeePercentage?: number;
  lateFeeGraceDays?: number;
  additionalOccupants?: OfftakeOccupant[];
  specialTerms?: string;
}

/** @deprecated Use {@link UpdateOfftakeInput}. */
export type UpdateLeaseInput = UpdateOfftakeInput;

export interface RenewalInput {
  newEndDate: ISOTimestamp;
  newRoyaltyAmount?: Money;
  newTerms?: string;
}

export type RenewalWindowType = 'T-90' | 'T-60' | 'T-30' | 'expired' | 'none';

export interface RenewalWindow {
  offtakeId: OfftakeId;
  offtakeNumber: string;
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
  readonly offtakeId: OfftakeId;
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

export type DepositDeductionReason = 'damage_repair' | 'unpaid_royalty' | 'cleaning_fee' | 'key_replacement' | 'other';

export interface DepositDeduction {
  reason: DepositDeductionReason;
  description: string;
  amount: Money;
  evidenceDocumentIds: readonly string[];
}

export interface DepositDisposition {
  readonly offtakeId: OfftakeId;
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

// NOTE (cross-package wire contract): the string discriminators and
// payload field keys for `LeaseCreated` / `LeaseActivated` /
// `LeaseRenewalWindow` / `DepositReturned` are NOT in the canonical
// rename map and are consumed by name in off-limits packages
// (api-gateway event-subscribers, observability bus). They are left
// intact deliberately; only `LeaseTerminated` → `OfftakeTerminated` is
// in the map. The brand type for the id field is the canonical
// `OfftakeId` (= `LeaseId`).
export interface LeaseCreatedEvent {
  eventId: string;
  eventType: 'LeaseCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    leaseId: OfftakeId;
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
    leaseId: OfftakeId;
    leaseNumber: string;
    customerId: CustomerId;
    unitId: UnitId;
  };
}

export interface OfftakeTerminatedEvent {
  eventId: string;
  eventType: 'OfftakeTerminated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    offtakeId: OfftakeId;
    offtakeNumber: string;
    reason: string;
    moveOutDate: ISOTimestamp;
  };
}

/** @deprecated Use {@link OfftakeTerminatedEvent}. */
export type LeaseTerminatedEvent = OfftakeTerminatedEvent;

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
    leaseId: OfftakeId;
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
    leaseId: OfftakeId;
    customerId: CustomerId;
    totalDeposit: Money;
    totalDeductions: Money;
    refundAmount: Money;
  };
}

// ============================================================================
// Offtake Service Implementation
// ============================================================================

/**
 * Narrow read-side query for seeding a first-term offtake. The composition
 * root wires a thin lookup against the units table — typically returning
 * the unit's `propertyId`, market royalty (`Money`), and security deposit
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
    readonly royaltyAmount: Money;
    readonly securityDeposit?: Money;
    readonly paymentFrequency?: PaymentFrequency;
    readonly type?: OfftakeType;
  } | null>;
}

/**
 * Offtake and Customer management service.
 * Handles full offtake lifecycle from creation to termination/renewal.
 */
export class OfftakeService {
  private readonly unitFirstTermFinder: UnitFirstTermFinder | null;

  constructor(
    private readonly offtakeRepo: OfftakeRepository,
    private readonly customerRepo: CustomerRepository,
    private readonly eventBus: EventBus,
    /**
     * Optional. Required only when `seedFirstTerm` is invoked (e.g. by
     * the DepositToOfftakeOrchestrator). Without it, `seedFirstTerm`
     * returns `null` and the caller falls back to default behaviour.
     */
    unitFirstTermFinder?: UnitFirstTermFinder,
  ) {
    this.unitFirstTermFinder = unitFirstTermFinder ?? null;
  }

  // ==================== Customer Operations ====================

  /**
   * Create a new customer (counterparty).
   */
  async createCustomer(
    tenantId: TenantId,
    input: CreateCustomerInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Customer, OfftakeServiceErrorResult>> {
    // Validate required fields
    if (!input.profile.email || !input.profile.firstName || !input.profile.lastName) {
      return err({
        code: OfftakeServiceError.INVALID_CUSTOMER_DATA,
        message: 'Email, first name, and last name are required',
      });
    }

    // Check email uniqueness
    const existingByEmail = await this.customerRepo.findByEmail(input.profile.email, tenantId);
    if (existingByEmail) {
      return err({
        code: OfftakeServiceError.CUSTOMER_EMAIL_EXISTS,
        message: 'A customer with this email already exists',
      });
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
  ): Promise<Result<Customer, OfftakeServiceErrorResult>> {
    const customer = await this.customerRepo.findById(customerId, tenantId);
    if (!customer) {
      return err({
        code: OfftakeServiceError.CUSTOMER_NOT_FOUND,
        message: 'Customer not found',
      });
    }

    // Check email uniqueness if changing
    if (input.profile?.email && input.profile.email !== customer.profile.email) {
      const existingByEmail = await this.customerRepo.findByEmail(input.profile.email, tenantId);
      if (existingByEmail) {
        return err({
          code: OfftakeServiceError.CUSTOMER_EMAIL_EXISTS,
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
  ): Promise<Result<Customer, OfftakeServiceErrorResult>> {
    const customer = await this.customerRepo.findById(customerId, tenantId);
    if (!customer) {
      return err({
        code: OfftakeServiceError.CUSTOMER_NOT_FOUND,
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

  // ==================== Offtake Operations ====================

  /**
   * Create a new offtake (draft).
   */
  async createOfftake(
    tenantId: TenantId,
    input: CreateOfftakeInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Offtake, OfftakeServiceErrorResult>> {
    // Validate customer exists
    const customer = await this.customerRepo.findById(input.customerId, tenantId);
    if (!customer) {
      return err({
        code: OfftakeServiceError.CUSTOMER_NOT_FOUND,
        message: 'Customer not found',
      });
    }

    // Check if unit already has an active offtake
    const activeOfftake = await this.offtakeRepo.findActiveByUnit(input.unitId, tenantId);
    if (activeOfftake) {
      return err({
        code: OfftakeServiceError.UNIT_ALREADY_CONTRACTED,
        message: 'This unit already has an active offtake',
      });
    }

    // Validate date range
    if (input.endDate && new Date(input.endDate) <= new Date(input.startDate)) {
      return err({
        code: OfftakeServiceError.INVALID_DATE_RANGE,
        message: 'End date must be after start date',
      });
    }

    const offtakeNumber = await this.generateOfftakeNumber(tenantId);
    const offtakeId = asOfftakeId(`offtake_${Date.now()}_${randomHex(4)}`);

    const offtake = createOfftake(offtakeId, {
      tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId,
      customerId: input.customerId,
      offtakeNumber,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      moveInDate: input.moveInDate,
      royaltyAmount: input.royaltyAmount,
      paymentFrequency: input.paymentFrequency,
      royaltyDueDay: input.royaltyDueDay,
      securityDeposit: input.securityDeposit,
      lateFeePercentage: input.lateFeePercentage,
      lateFeeGraceDays: input.lateFeeGraceDays,
      additionalOccupants: input.additionalOccupants,
      specialTerms: input.specialTerms,
    }, createdBy);

    const savedOfftake = await this.offtakeRepo.create(offtake);

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
        leaseId: savedOfftake.id,
        leaseNumber: savedOfftake.offtakeNumber,
        customerId: savedOfftake.customerId,
        unitId: savedOfftake.unitId,
        startDate: savedOfftake.startDate,
        endDate: savedOfftake.endDate,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedOfftake.id, 'Offtake'));

    return ok(savedOfftake);
  }

  /**
   * Seed the very first offtake term for a unit/customer pair.
   *
   * Used by the DepositToOfftakeOrchestrator's renewal port (which is
   * actually about *initial* offtake creation — see
   * `OrchestratorRenewalPort.seedFirstTerm`). Defaults the term to
   * 12 months starting today, with the royalty + security deposit pulled
   * from the unit via the optional `UnitFirstTermFinder`.
   *
   * Returns `null` (rather than throwing) in degraded paths so the
   * orchestrator can transparently fall back to its default port:
   *   - no `UnitFirstTermFinder` was wired at construction time, or
   *   - the finder returned `null` (unit isn't priced yet).
   *
   * Returns the new `offtakeId` on success. Errors from the underlying
   * `createOfftake` (e.g. UNIT_ALREADY_CONTRACTED, CUSTOMER_NOT_FOUND) also
   * surface as `null` — the orchestrator's state machine is tolerant
   * of "no offtake seeded yet" but cannot recover from a hard failure
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
  }): Promise<{ readonly offtakeId: string } | null> {
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

    // Security deposit defaults to one month's royalty when the finder
    // does not supply an explicit value.
    const securityDeposit = defaults.securityDeposit ?? defaults.royaltyAmount;

    const correlationId = args.correlationId ?? `seed_first_term_${Date.now()}`;
    const createdBy = (args.createdBy ?? ('system' as unknown as UserId)) as UserId;

    const result = await this.createOfftake(
      args.tenantId,
      {
        propertyId: defaults.propertyId,
        unitId: args.unitId,
        customerId: args.customerId,
        type: defaults.type ?? ('spot' as unknown as OfftakeType),
        startDate,
        endDate,
        moveInDate: startDate,
        royaltyAmount: defaults.royaltyAmount,
        paymentFrequency:
          defaults.paymentFrequency ?? ('monthly' as unknown as PaymentFrequency),
        securityDeposit,
      },
      createdBy,
      correlationId,
    );

    if (!result.ok) return null;
    return { offtakeId: (result.value as Offtake).id as unknown as string };
  }

  /**
   * Get an offtake by ID.
   */
  async getOfftake(offtakeId: OfftakeId, tenantId: TenantId): Promise<Offtake | null> {
    return this.offtakeRepo.findById(offtakeId, tenantId);
  }

  /**
   * Get an offtake by offtake number.
   */
  async getOfftakeByNumber(offtakeNumber: string, tenantId: TenantId): Promise<Offtake | null> {
    return this.offtakeRepo.findByOfftakeNumber(offtakeNumber, tenantId);
  }

  /**
   * List all offtakes.
   */
  async listOfftakes(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Offtake>> {
    return this.offtakeRepo.findMany(tenantId, pagination);
  }

  /**
   * List offtakes by property.
   */
  async listOfftakesByProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Offtake>> {
    return this.offtakeRepo.findByProperty(propertyId, tenantId, pagination);
  }

  /**
   * List offtakes by customer.
   */
  async listOfftakesByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Offtake>> {
    return this.offtakeRepo.findByCustomer(customerId, tenantId, pagination);
  }

  /**
   * List offtakes by status.
   */
  async listOfftakesByStatus(
    status: OfftakeStatus,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Offtake>> {
    return this.offtakeRepo.findByStatus(status, tenantId, pagination);
  }

  /**
   * Get active offtake for a unit.
   */
  async getActiveOfftakeForUnit(unitId: UnitId, tenantId: TenantId): Promise<Offtake | null> {
    return this.offtakeRepo.findActiveByUnit(unitId, tenantId);
  }

  /**
   * Find offtakes expiring soon.
   */
  async findExpiringSoonOfftakes(
    daysThreshold: number,
    tenantId: TenantId
  ): Promise<Offtake[]> {
    return this.offtakeRepo.findExpiringSoon(daysThreshold, tenantId);
  }

  /**
   * Activate an offtake (after signing).
   */
  async activateOfftake(
    offtakeId: OfftakeId,
    tenantId: TenantId,
    documentIds: string[],
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Offtake, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({
        code: OfftakeServiceError.OFFTAKE_NOT_FOUND,
        message: 'Offtake not found',
      });
    }

    if (offtake.status !== 'draft' && offtake.status !== 'pending_signature') {
      return err({
        code: OfftakeServiceError.OFFTAKE_CANNOT_BE_ACTIVATED,
        message: `Offtake cannot be activated from ${offtake.status} status`,
      });
    }

    // Verify unit is still available
    const activeOfftake = await this.offtakeRepo.findActiveByUnit(offtake.unitId, tenantId);
    if (activeOfftake && activeOfftake.id !== offtakeId) {
      return err({
        code: OfftakeServiceError.UNIT_ALREADY_CONTRACTED,
        message: 'This unit now has another active offtake',
      });
    }

    const activatedOfftake = activateOfftake(offtake, documentIds, updatedBy);
    const savedOfftake = await this.offtakeRepo.update(activatedOfftake);

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
        leaseId: savedOfftake.id,
        leaseNumber: savedOfftake.offtakeNumber,
        customerId: savedOfftake.customerId,
        unitId: savedOfftake.unitId,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedOfftake.id, 'Offtake'));

    return ok(savedOfftake);
  }

  /**
   * Terminate an offtake.
   */
  async terminateOfftake(
    offtakeId: OfftakeId,
    tenantId: TenantId,
    reason: string,
    moveOutDate: ISOTimestamp,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Offtake, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({
        code: OfftakeServiceError.OFFTAKE_NOT_FOUND,
        message: 'Offtake not found',
      });
    }

    if (offtake.status !== 'active' && offtake.status !== 'expiring_soon') {
      return err({
        code: OfftakeServiceError.OFFTAKE_CANNOT_BE_TERMINATED,
        message: `Offtake cannot be terminated from ${offtake.status} status`,
      });
    }

    const terminatedOfftake = terminateOfftake(offtake, reason, moveOutDate, updatedBy);
    const savedOfftake = await this.offtakeRepo.update(terminatedOfftake);

    // Publish event (mapped: LeaseTerminated -> OfftakeTerminated)
    const event: OfftakeTerminatedEvent = {
      eventId: generateEventId(),
      eventType: 'OfftakeTerminated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        offtakeId: savedOfftake.id,
        offtakeNumber: savedOfftake.offtakeNumber,
        reason,
        moveOutDate,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedOfftake.id, 'Offtake'));

    return ok(savedOfftake);
  }

  /**
   * Update offtake terms.
   */
  async updateOfftake(
    offtakeId: OfftakeId,
    tenantId: TenantId,
    input: UpdateOfftakeInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Offtake, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({
        code: OfftakeServiceError.OFFTAKE_NOT_FOUND,
        message: 'Offtake not found',
      });
    }

    const updatedOfftake: Offtake = {
      ...offtake,
      royaltyAmount: input.royaltyAmount ?? offtake.royaltyAmount,
      royaltyDueDay: input.royaltyDueDay ?? offtake.royaltyDueDay,
      lateFeePercentage: input.lateFeePercentage ?? offtake.lateFeePercentage,
      lateFeeGraceDays: input.lateFeeGraceDays ?? offtake.lateFeeGraceDays,
      additionalOccupants: input.additionalOccupants ?? offtake.additionalOccupants,
      specialTerms: input.specialTerms ?? offtake.specialTerms,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedOfftake = await this.offtakeRepo.update(updatedOfftake);
    return ok(savedOfftake);
  }

  /**
   * Renew an offtake.
   */
  async renewOfftake(
    offtakeId: OfftakeId,
    tenantId: TenantId,
    input: RenewalInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Offtake, OfftakeServiceErrorResult>> {
    const oldOfftake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!oldOfftake) {
      return err({
        code: OfftakeServiceError.OFFTAKE_NOT_FOUND,
        message: 'Offtake not found',
      });
    }

    if (oldOfftake.status !== 'active' && oldOfftake.status !== 'expiring_soon') {
      return err({
        code: OfftakeServiceError.RENEWAL_NOT_ALLOWED,
        message: `Cannot renew an offtake that is ${oldOfftake.status}`,
      });
    }

    // Create new offtake
    const newOfftakeNumber = await this.generateOfftakeNumber(tenantId);
    const newOfftakeId = asOfftakeId(`offtake_${Date.now()}_${randomHex(4)}`);

    const newOfftake = createOfftake(newOfftakeId, {
      tenantId,
      propertyId: oldOfftake.propertyId,
      unitId: oldOfftake.unitId,
      customerId: oldOfftake.customerId,
      offtakeNumber: newOfftakeNumber,
      type: oldOfftake.type,
      startDate: oldOfftake.endDate ?? new Date().toISOString(),
      endDate: input.newEndDate,
      moveInDate: oldOfftake.endDate ?? new Date().toISOString(),
      royaltyAmount: input.newRoyaltyAmount ?? oldOfftake.royaltyAmount,
      paymentFrequency: oldOfftake.paymentFrequency,
      royaltyDueDay: oldOfftake.royaltyDueDay,
      securityDeposit: oldOfftake.securityDeposit,
      lateFeePercentage: oldOfftake.lateFeePercentage,
      lateFeeGraceDays: oldOfftake.lateFeeGraceDays,
      additionalOccupants: oldOfftake.additionalOccupants as OfftakeOccupant[],
      specialTerms: input.newTerms ?? oldOfftake.specialTerms ?? undefined,
    }, createdBy);

    // Link old and new offtakes
    const linkedNewOfftake: Offtake = {
      ...newOfftake,
      renewedFromOfftakeId: oldOfftake.id,
    };

    const linkedOldOfftake: Offtake = {
      ...oldOfftake,
      status: 'renewed',
      renewedToOfftakeId: newOfftakeId,
      updatedAt: new Date().toISOString(),
      updatedBy: createdBy,
    };

    // Save both offtakes
    await this.offtakeRepo.update(linkedOldOfftake);
    const savedNewOfftake = await this.offtakeRepo.create(linkedNewOfftake);

    return ok(savedNewOfftake);
  }

  /**
   * Mark deposit as paid.
   */
  async markDepositPaid(
    offtakeId: OfftakeId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Offtake, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({
        code: OfftakeServiceError.OFFTAKE_NOT_FOUND,
        message: 'Offtake not found',
      });
    }

    const updatedOfftake: Offtake = {
      ...offtake,
      depositPaid: true,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedOfftake = await this.offtakeRepo.update(updatedOfftake);
    return ok(savedOfftake);
  }

  // ==================== Renewal Window Detection ====================

  /**
   * Detect offtake renewal windows (T-90, T-60, T-30 days before expiry).
   * Returns offtakes that are in a renewal window, sorted by urgency.
   */
  async detectRenewalWindows(
    tenantId: TenantId,
    correlationId: string
  ): Promise<RenewalWindow[]> {
    const now = new Date();
    // Fetch offtakes expiring within 90 days
    const expiringSoon = await this.offtakeRepo.findExpiringSoon(90, tenantId);
    const windows: RenewalWindow[] = [];

    for (const offtake of expiringSoon) {
      if (!offtake.endDate) continue;
      if (offtake.status !== 'active' && offtake.status !== 'expiring_soon') continue;

      const endDate = new Date(offtake.endDate);
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
          offtakeId: offtake.id,
          offtakeNumber: offtake.offtakeNumber,
          customerId: offtake.customerId,
          unitId: offtake.unitId,
          endDate: offtake.endDate,
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
            leaseId: offtake.id,
            leaseNumber: offtake.offtakeNumber,
            customerId: offtake.customerId,
            unitId: offtake.unitId,
            endDate: offtake.endDate,
            windowType,
            daysUntilExpiry,
          },
        };
        await this.eventBus.publish(createEventEnvelope(event, offtake.id, 'Offtake'));
      }
    }

    // Sort by urgency (closest to expiry first)
    windows.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    return windows;
  }

  /**
   * Get the renewal window status for a specific offtake.
   */
  async getRenewalWindowStatus(
    offtakeId: OfftakeId,
    tenantId: TenantId
  ): Promise<Result<RenewalWindow, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({ code: OfftakeServiceError.OFFTAKE_NOT_FOUND, message: 'Offtake not found' });
    }

    if (!offtake.endDate) {
      // Evergreen offtakes don't have renewal windows
      return ok({
        offtakeId: offtake.id,
        offtakeNumber: offtake.offtakeNumber,
        customerId: offtake.customerId,
        unitId: offtake.unitId,
        endDate: '' as ISOTimestamp,
        daysUntilExpiry: -1,
        windowType: 'none' as RenewalWindowType,
        recommended: false,
      });
    }

    const now = new Date();
    const endDate = new Date(offtake.endDate);
    const daysUntilExpiry = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    let windowType: RenewalWindowType = 'none';

    if (daysUntilExpiry <= 0) windowType = 'expired';
    else if (daysUntilExpiry <= 30) windowType = 'T-30';
    else if (daysUntilExpiry <= 60) windowType = 'T-60';
    else if (daysUntilExpiry <= 90) windowType = 'T-90';

    return ok({
      offtakeId: offtake.id,
      offtakeNumber: offtake.offtakeNumber,
      customerId: offtake.customerId,
      unitId: offtake.unitId,
      endDate: offtake.endDate,
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
    offtakeId: OfftakeId,
    type: 'move_in' | 'move_out',
    items: ConditionReportItem[],
    inspectorId: UserId,
    notes?: string
  ): Promise<Result<ConditionReport, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({ code: OfftakeServiceError.OFFTAKE_NOT_FOUND, message: 'Offtake not found' });
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
      offtakeId,
      unitId: offtake.unitId,
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
    offtakeId: OfftakeId,
    tenantId: TenantId,
    deductions: DepositDeduction[],
    processedBy: UserId,
    correlationId: string
  ): Promise<Result<DepositDisposition, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({ code: OfftakeServiceError.OFFTAKE_NOT_FOUND, message: 'Offtake not found' });
    }

    if (!offtake.depositPaid) {
      return err({
        code: OfftakeServiceError.INVALID_OFFTAKE_DATA,
        message: 'No deposit was paid for this offtake',
      });
    }

    const totalDeposit = offtake.securityDeposit;
    if (!totalDeposit) {
      return err({
        code: OfftakeServiceError.INVALID_OFFTAKE_DATA,
        message: 'No security deposit recorded for this offtake',
      });
    }
    const currency = totalDeposit.currency;
    let totalDeductionAmount = 0;

    for (const deduction of deductions) {
      if (deduction.amount.amount < 0) {
        return err({
          code: OfftakeServiceError.INVALID_OFFTAKE_DATA,
          message: 'Deduction amounts must be positive',
        });
      }
      totalDeductionAmount += deduction.amount.amount;
    }

    if (totalDeductionAmount > totalDeposit.amount) {
      return err({
        code: OfftakeServiceError.INVALID_OFFTAKE_DATA,
        message: 'Total deductions cannot exceed deposit amount',
      });
    }

    const refundAmount = totalDeposit.amount - totalDeductionAmount;
    const now = new Date().toISOString();

    const disposition: DepositDisposition = {
      offtakeId,
      tenantId,
      totalDeposit,
      deductions,
      totalDeductions: { amount: totalDeductionAmount, currency } as Money,
      refundAmount: { amount: refundAmount, currency } as Money,
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
        leaseId: offtakeId,
        customerId: offtake.customerId,
        totalDeposit,
        totalDeductions: disposition.totalDeductions,
        refundAmount: disposition.refundAmount,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, offtakeId, 'Offtake'));

    return ok(disposition);
  }

  /**
   * Mark deposit as refunded after actual payment processing.
   */
  async markDepositRefunded(
    offtakeId: OfftakeId,
    tenantId: TenantId,
    refundMethod: string,
    refundReference: string,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Offtake, OfftakeServiceErrorResult>> {
    const offtake = await this.offtakeRepo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err({ code: OfftakeServiceError.OFFTAKE_NOT_FOUND, message: 'Offtake not found' });
    }

    const updatedOfftake: Offtake = {
      ...offtake,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedOfftake = await this.offtakeRepo.update(updatedOfftake);
    return ok(savedOfftake);
  }

  /**
   * Find expired offtakes for batch processing.
   */
  async findExpiredOfftakes(tenantId: TenantId): Promise<Offtake[]> {
    return this.offtakeRepo.findExpired(tenantId);
  }

  // ==================== Helpers ====================

  private async generateOfftakeNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.offtakeRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return generateOfftakeNumber(year, sequence);
  }

  private async generateCustomerNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.customerRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return generateCustomerNumber(year, sequence);
  }
}

/** @deprecated Use {@link OfftakeService}. */
export const LeaseService = OfftakeService;


// Renewal (explicit workflow on top of OfftakeService).
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
  type RenewalOfftakeSnapshot,
  type RenewalLeaseSnapshot,
  type RenewalRepository,
  type RenewalServiceErrorCode,
  type RenewalServiceErrorResult,
  type OfftakeRenewalStatus,
  type LeaseRenewalStatus,
} from './renewal-service.js';

// Move-Out checklist (step-based end-of-offtake workflow).
// Complements the richer inspection-backed MoveOut in ../inspections/move-out;
// this one tracks the 4 higher-level offtake close-out steps.
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
