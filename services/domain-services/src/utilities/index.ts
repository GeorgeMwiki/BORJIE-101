import { randomHex } from '../common/id-generator.js';
/**
 * Utilities Tracking Service
 *
 * Tracks electricity, water, gas, internet, garbage, and security utilities.
 * Handles meter readings, consumption calculation, billing, and account management.
 */

import type {
  TenantId,
  UserId,
  UnitId,
  CustomerId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Types
// ============================================================================

export type UtilityType =
  | 'electricity'
  | 'water'
  | 'gas'
  | 'internet'
  | 'garbage'
  | 'security';

export type MeterType = 'prepaid' | 'postpaid' | 'shared';

export type UtilityResponsibility = 'tenant' | 'landlord' | 'shared';

export type UtilityBillStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface MeterReading {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly unitId: UnitId;
  readonly utilityType: UtilityType;
  readonly meterNumber: string;
  readonly reading: number;
  readonly readingDate: ISOTimestamp;
  readonly photo?: string | null;
  readonly readBy: UserId;
  readonly createdAt: ISOTimestamp;
}

export interface UtilityAccount {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly unitId: UnitId;
  readonly utilityType: UtilityType;
  readonly accountNumber: string;
  readonly meterType: MeterType;
  readonly provider: string;
  readonly responsibility: UtilityResponsibility;
  readonly customerId?: CustomerId | null;
  readonly meterNumber?: string | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export interface UtilityBill {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly accountId: string;
  readonly unitId: UnitId;
  readonly periodStart: ISOTimestamp;
  readonly periodEnd: ISOTimestamp;
  readonly amount: number;
  readonly dueDate: ISOTimestamp;
  readonly status: UtilityBillStatus;
  readonly utilityType: UtilityType;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt?: ISOTimestamp;
}

// ============================================================================
// Events
// ============================================================================

interface UtilityEventBase extends DomainEvent {
  readonly payload: Record<string, unknown>;
}

export interface MeterReadingRecordedEvent extends UtilityEventBase {
  readonly eventType: 'MeterReadingRecorded';
  readonly payload: {
    readonly readingId: string;
    readonly tenantId: TenantId;
    readonly unitId: UnitId;
    readonly utilityType: UtilityType;
    readonly meterNumber: string;
    readonly reading: number;
    readonly readingDate: ISOTimestamp;
    readonly readBy: UserId;
  };
}

export interface UtilityBillCreatedEvent extends UtilityEventBase {
  readonly eventType: 'UtilityBillCreated';
  readonly payload: {
    readonly billId: string;
    readonly tenantId: TenantId;
    readonly accountId: string;
    readonly unitId: UnitId;
    readonly utilityType: UtilityType;
    readonly amount: number;
    readonly periodStart: ISOTimestamp;
    readonly periodEnd: ISOTimestamp;
    readonly dueDate: ISOTimestamp;
  };
}

export interface HighConsumptionAlertEvent extends UtilityEventBase {
  readonly eventType: 'HighConsumptionAlert';
  readonly payload: {
    readonly tenantId: TenantId;
    readonly unitId: UnitId;
    readonly utilityType: UtilityType;
    readonly consumption: number;
    readonly threshold: number;
    readonly periodStart: ISOTimestamp;
    readonly periodEnd: ISOTimestamp;
  };
}

export type UtilityEvent =
  | MeterReadingRecordedEvent
  | UtilityBillCreatedEvent
  | HighConsumptionAlertEvent;

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface UtilityAccountStore {
  findById(id: string, tenantId: TenantId): Promise<UtilityAccount | null>;
  findByUnit(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType?: UtilityType
  ): Promise<readonly UtilityAccount[]>;
  create(account: UtilityAccount): Promise<UtilityAccount>;
  update(account: UtilityAccount): Promise<UtilityAccount>;
}

export interface MeterReadingStore {
  create(reading: MeterReading): Promise<MeterReading>;
  findByUnitAndType(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType: UtilityType,
    dateRange: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<readonly MeterReading[]>;
}

export interface UtilityBillStore {
  create(bill: UtilityBill): Promise<UtilityBill>;
  findById(id: string, tenantId: TenantId): Promise<UtilityBill | null>;
  findByUnit(
    tenantId: TenantId,
    unitId: UnitId,
    filters?: UtilityBillFilters
  ): Promise<readonly UtilityBill[]>;
}

export interface UtilityBillFilters {
  readonly utilityType?: UtilityType;
  readonly status?: UtilityBillStatus | UtilityBillStatus[];
  readonly accountId?: string;
  readonly fromDate?: ISOTimestamp;
  readonly toDate?: ISOTimestamp;
}

export interface DateRange {
  readonly start: ISOTimestamp;
  readonly end: ISOTimestamp;
}

// ============================================================================
// Error Types
// ============================================================================

export const UtilityServiceError = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  BILL_NOT_FOUND: 'BILL_NOT_FOUND',
  DUPLICATE_ACCOUNT: 'DUPLICATE_ACCOUNT',
  INVALID_READING: 'INVALID_READING',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  INSUFFICIENT_READINGS: 'INSUFFICIENT_READINGS',
} as const;

export type UtilityServiceErrorCode =
  (typeof UtilityServiceError)[keyof typeof UtilityServiceError];

export interface UtilityServiceErrorResult {
  code: UtilityServiceErrorCode;
  message: string;
}

// ============================================================================
// Utilities Service
// ============================================================================

/** Default consumption threshold (units) above which HighConsumptionAlert is emitted */
export const DEFAULT_HIGH_CONSUMPTION_THRESHOLD = 500;

export class UtilitiesService {
  constructor(
    private readonly accountStore: UtilityAccountStore,
    private readonly readingStore: MeterReadingStore,
    private readonly billStore: UtilityBillStore,
    private readonly eventBus: EventBus,
    private readonly highConsumptionThreshold = DEFAULT_HIGH_CONSUMPTION_THRESHOLD
  ) {}

  /**
   * Register a new utility account for a unit.
   */
  async registerUtilityAccount(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType: UtilityType,
    accountNumber: string,
    meterType: MeterType,
    provider: string,
    responsibility: UtilityResponsibility = 'tenant',
    meterNumber?: string | null
  ): Promise<Result<UtilityAccount, UtilityServiceErrorResult>> {
    const id = `ua_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();

    const account: UtilityAccount = {
      id,
      tenantId,
      unitId,
      utilityType,
      accountNumber,
      meterType,
      provider,
      responsibility,
      meterNumber: meterNumber ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.accountStore.create(account);
    return ok(saved);
  }

  /**
   * Record a meter reading for a unit.
   */
  async recordMeterReading(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType: UtilityType,
    reading: number,
    readingDate: ISOTimestamp,
    readBy: UserId,
    photo?: string | null
  ): Promise<Result<MeterReading, UtilityServiceErrorResult>> {
    if (reading < 0) {
      return err({
        code: UtilityServiceError.INVALID_READING,
        message: 'Meter reading cannot be negative',
      });
    }

    const accounts = await this.accountStore.findByUnit(tenantId, unitId, utilityType);
    const meterNumber = accounts[0]?.meterNumber ?? '';

    const id = `mr_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();

    const meterReading: MeterReading = {
      id,
      tenantId,
      unitId,
      utilityType,
      meterNumber,
      reading,
      readingDate,
      photo: photo ?? null,
      readBy,
      createdAt: now,
    };

    const saved = await this.readingStore.create(meterReading);

    const event: MeterReadingRecordedEvent = {
      eventId: generateEventId(),
      eventType: 'MeterReadingRecorded',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        readingId: saved.id,
        tenantId,
        unitId,
        utilityType,
        meterNumber,
        reading,
        readingDate,
        readBy,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, saved.id, 'MeterReading')
    );

    return ok(saved);
  }

  /**
   * Get meter readings for a unit within a date range.
   */
  async getMeterReadings(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType: UtilityType,
    dateRange: DateRange
  ): Promise<Result<readonly MeterReading[], UtilityServiceErrorResult>> {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);

    if (start > end) {
      return err({
        code: UtilityServiceError.INVALID_DATE_RANGE,
        message: 'Start date must be before or equal to end date',
      });
    }

    const readings = await this.readingStore.findByUnitAndType(
      tenantId,
      unitId,
      utilityType,
      dateRange
    );

    return ok(readings);
  }

  /**
   * Calculate consumption for a unit within a date range.
   * Consumption = (max reading - min reading) in the period.
   */
  async calculateConsumption(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType: UtilityType,
    dateRange: DateRange
  ): Promise<Result<number, UtilityServiceErrorResult>> {
    const readingsResult = await this.getMeterReadings(
      tenantId,
      unitId,
      utilityType,
      dateRange
    );

    if (!readingsResult.success) {
      return readingsResult;
    }

    const readings = readingsResult.data;

    if (readings.length < 2) {
      return err({
        code: UtilityServiceError.INSUFFICIENT_READINGS,
        message:
          'At least two meter readings are required to calculate consumption',
      });
    }

    const ordered = [...readings].sort(
      (a, b) =>
        new Date(a.readingDate).getTime() - new Date(b.readingDate).getTime()
    );

    const minReading = ordered[0]!.reading;
    const maxReading = ordered[ordered.length - 1]!.reading;
    const consumption = maxReading - minReading;

    if (consumption > this.highConsumptionThreshold) {
      const event: HighConsumptionAlertEvent = {
        eventId: generateEventId(),
        eventType: 'HighConsumptionAlert',
        timestamp: new Date().toISOString(),
        tenantId,
        correlationId: unitId,
        causationId: null,
        metadata: {},
        payload: {
          tenantId,
          unitId,
          utilityType,
          consumption,
          threshold: this.highConsumptionThreshold,
          periodStart: dateRange.start,
          periodEnd: dateRange.end,
        },
      };
      await this.eventBus.publish(
        createEventEnvelope(event, unitId, 'UtilityConsumption')
      );
    }

    return ok(consumption);
  }

  /**
   * Create a utility bill for an account.
   */
  async createUtilityBill(
    tenantId: TenantId,
    accountId: string,
    periodStart: ISOTimestamp,
    periodEnd: ISOTimestamp,
    amount: number,
    dueDate: ISOTimestamp
  ): Promise<Result<UtilityBill, UtilityServiceErrorResult>> {
    const account = await this.accountStore.findById(accountId, tenantId);

    if (!account) {
      return err({
        code: UtilityServiceError.ACCOUNT_NOT_FOUND,
        message: 'Utility account not found',
      });
    }

    const id = `ub_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();

    const bill: UtilityBill = {
      id,
      tenantId,
      accountId,
      unitId: account.unitId,
      periodStart,
      periodEnd,
      amount,
      dueDate,
      status: 'pending',
      utilityType: account.utilityType,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.billStore.create(bill);

    const event: UtilityBillCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'UtilityBillCreated',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        billId: saved.id,
        tenantId,
        accountId,
        unitId: account.unitId,
        utilityType: account.utilityType,
        amount,
        periodStart,
        periodEnd,
        dueDate,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, saved.id, 'UtilityBill')
    );

    return ok(saved);
  }

  /**
   * Get utility bills for a unit with optional filters.
   */
  async getUtilityBills(
    tenantId: TenantId,
    unitId: UnitId,
    filters?: UtilityBillFilters
  ): Promise<readonly UtilityBill[]> {
    return this.billStore.findByUnit(tenantId, unitId, filters);
  }

  /**
   * Get utility accounts for a unit.
   */
  async getUtilityAccounts(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType?: UtilityType
  ): Promise<readonly UtilityAccount[]> {
    return this.accountStore.findByUnit(tenantId, unitId, utilityType);
  }

  /**
   * Transfer a utility account to a new customer.
   */
  async transferUtilityAccount(
    accountId: string,
    tenantId: TenantId,
    newCustomerId: CustomerId
  ): Promise<Result<UtilityAccount, UtilityServiceErrorResult>> {
    const account = await this.accountStore.findById(accountId, tenantId);

    if (!account) {
      return err({
        code: UtilityServiceError.ACCOUNT_NOT_FOUND,
        message: 'Utility account not found',
      });
    }

    const updated: UtilityAccount = {
      ...account,
      customerId: newCustomerId,
      updatedAt: new Date().toISOString(),
    };

    const saved = await this.accountStore.update(updated);
    return ok(saved);
  }
}

// ============================================================================
// In-Memory Stores (for development/testing)
// ============================================================================

const accountMap = new Map<string, UtilityAccount>();
const readingMap = new Map<string, MeterReading>();
const billMap = new Map<string, UtilityBill>();

function accountKey(id: string, tenantId: TenantId): string {
  return `${tenantId}:${id}`;
}

function readingKey(id: string): string {
  return id;
}

function billKey(id: string, tenantId: TenantId): string {
  return `${tenantId}:${id}`;
}

export class MemoryUtilityAccountStore implements UtilityAccountStore {
  async findById(id: string, tenantId: TenantId): Promise<UtilityAccount | null> {
    return accountMap.get(accountKey(id, tenantId)) ?? null;
  }

  async findByUnit(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType?: UtilityType
  ): Promise<readonly UtilityAccount[]> {
    return [...accountMap.values()].filter(
      (a) =>
        a.tenantId === tenantId &&
        a.unitId === unitId &&
        (utilityType == null || a.utilityType === utilityType)
    );
  }

  async create(account: UtilityAccount): Promise<UtilityAccount> {
    accountMap.set(accountKey(account.id, account.tenantId), account);
    return account;
  }

  async update(account: UtilityAccount): Promise<UtilityAccount> {
    accountMap.set(accountKey(account.id, account.tenantId), account);
    return account;
  }

  clear(): void {
    accountMap.clear();
  }
}

export class MemoryMeterReadingStore implements MeterReadingStore {
  async create(reading: MeterReading): Promise<MeterReading> {
    readingMap.set(readingKey(reading.id), reading);
    return reading;
  }

  async findByUnitAndType(
    tenantId: TenantId,
    unitId: UnitId,
    utilityType: UtilityType,
    dateRange: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<readonly MeterReading[]> {
    const start = new Date(dateRange.start).getTime();
    const end = new Date(dateRange.end).getTime();

    return [...readingMap.values()].filter(
      (r) =>
        r.tenantId === tenantId &&
        r.unitId === unitId &&
        r.utilityType === utilityType &&
        new Date(r.readingDate).getTime() >= start &&
        new Date(r.readingDate).getTime() <= end
    );
  }

  clear(): void {
    readingMap.clear();
  }
}

export class MemoryUtilityBillStore implements UtilityBillStore {
  async create(bill: UtilityBill): Promise<UtilityBill> {
    billMap.set(billKey(bill.id, bill.tenantId), bill);
    return bill;
  }

  async findById(id: string, tenantId: TenantId): Promise<UtilityBill | null> {
    return billMap.get(billKey(id, tenantId)) ?? null;
  }

  async findByUnit(
    tenantId: TenantId,
    unitId: UnitId,
    filters?: UtilityBillFilters
  ): Promise<readonly UtilityBill[]> {
    let items = [...billMap.values()].filter(
      (b) => b.tenantId === tenantId && b.unitId === unitId
    );

    if (filters?.utilityType) {
      items = items.filter((b) => b.utilityType === filters.utilityType);
    }
    if (filters?.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      items = items.filter((b) => statuses.includes(b.status));
    }
    if (filters?.accountId) {
      items = items.filter((b) => b.accountId === filters.accountId);
    }
    if (filters?.fromDate) {
      items = items.filter(
        (b) => new Date(b.periodStart).getTime() >= new Date(filters!.fromDate!).getTime()
      );
    }
    if (filters?.toDate) {
      items = items.filter(
        (b) => new Date(b.periodEnd).getTime() <= new Date(filters!.toDate!).getTime()
      );
    }

    return items.sort(
      (a, b) =>
        new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime()
    );
  }

  clear(): void {
    billMap.clear();
  }
}
