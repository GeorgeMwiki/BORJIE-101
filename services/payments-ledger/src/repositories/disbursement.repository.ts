/**
 * Disbursement Repository Interface
 * Defines the contract for disbursement persistence
 */
import { TenantId, OwnerId, Money, CurrencyCode } from '@borjie/domain-models';

/**
 * Disbursement status
 */
export type DisbursementStatus = 'PENDING' | 'PROCESSING' | 'IN_TRANSIT' | 'PAID' | 'FAILED' | 'CANCELLED';

/**
 * Disbursement entity
 */
export interface Disbursement {
  id: string;
  tenantId: TenantId;
  ownerId: OwnerId;
  amountMinorUnits: number;
  currency: CurrencyCode;
  status: DisbursementStatus;
  destination: string;
  destinationType: string;
  provider?: string;
  transferId?: string;
  providerResponse?: Record<string, unknown>;
  description?: string;
  initiatedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  estimatedArrival?: Date;
  failureReason?: string;
  failureCode?: string;
  idempotencyKey?: string;
  ledgerEntryId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Disbursement filters
 */
export interface DisbursementFilters {
  tenantId: TenantId;
  ownerId?: OwnerId;
  status?: DisbursementStatus | DisbursementStatus[];
  fromDate?: Date;
  toDate?: Date;
}

/**
 * Paginated result
 */
export interface DisbursementPaginatedResult {
  items: Disbursement[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Disbursement Repository Interface
 */
export interface IDisbursementRepository {
  /**
   * Create a new disbursement
   */
  create(disbursement: Disbursement): Promise<Disbursement>;

  /**
   * Get disbursement by ID
   */
  findById(id: string, tenantId: TenantId): Promise<Disbursement | null>;

  /**
   * Get disbursement by idempotency key
   */
  findByIdempotencyKey(idempotencyKey: string, tenantId: TenantId): Promise<Disbursement | null>;

  /**
   * Get disbursement by transfer ID
   */
  findByTransferId(provider: string, transferId: string): Promise<Disbursement | null>;

  /**
   * Update disbursement
   */
  update(disbursement: Disbursement): Promise<Disbursement>;

  /**
   * Find disbursements with filters
   */
  find(filters: DisbursementFilters, page?: number, pageSize?: number): Promise<DisbursementPaginatedResult>;

  /**
   * Get disbursements by owner
   */
  findByOwner(tenantId: TenantId, ownerId: OwnerId, page?: number, pageSize?: number): Promise<DisbursementPaginatedResult>;

  /**
   * Get pending disbursements
   */
  findPending(tenantId: TenantId): Promise<Disbursement[]>;

  /**
   * Get last disbursement for owner
   */
  findLastByOwner(tenantId: TenantId, ownerId: OwnerId): Promise<Disbursement | null>;
}

/**
 * In-memory implementation for testing
 */
export class InMemoryDisbursementRepository implements IDisbursementRepository {
  private disbursements: Map<string, Disbursement> = new Map();

  async create(disbursement: Disbursement): Promise<Disbursement> {
    this.disbursements.set(disbursement.id, { ...disbursement });
    return disbursement;
  }

  async findById(id: string, tenantId: TenantId): Promise<Disbursement | null> {
    const disbursement = this.disbursements.get(id);
    if (disbursement && disbursement.tenantId === tenantId) {
      return { ...disbursement };
    }
    return null;
  }

  async findByIdempotencyKey(idempotencyKey: string, tenantId: TenantId): Promise<Disbursement | null> {
    for (const disbursement of this.disbursements.values()) {
      if (disbursement.idempotencyKey === idempotencyKey && disbursement.tenantId === tenantId) {
        return { ...disbursement };
      }
    }
    return null;
  }

  async findByTransferId(provider: string, transferId: string): Promise<Disbursement | null> {
    for (const disbursement of this.disbursements.values()) {
      if (disbursement.provider === provider && disbursement.transferId === transferId) {
        return { ...disbursement };
      }
    }
    return null;
  }

  async update(disbursement: Disbursement): Promise<Disbursement> {
    this.disbursements.set(disbursement.id, { ...disbursement, updatedAt: new Date() });
    return disbursement;
  }

  async find(
    filters: DisbursementFilters,
    page: number = 1,
    pageSize: number = 20
  ): Promise<DisbursementPaginatedResult> {
    let items = Array.from(this.disbursements.values())
      .filter(d => d.tenantId === filters.tenantId);

    if (filters.ownerId) {
      items = items.filter(d => d.ownerId === filters.ownerId);
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      items = items.filter(d => statuses.includes(d.status));
    }
    if (filters.fromDate) {
      items = items.filter(d => d.createdAt >= filters.fromDate!);
    }
    if (filters.toDate) {
      items = items.filter(d => d.createdAt <= filters.toDate!);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = items.length;
    const start = (page - 1) * pageSize;
    items = items.slice(start, start + pageSize);

    return {
      items: items.map(d => ({ ...d })),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    };
  }

  async findByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
    page: number = 1,
    pageSize: number = 20
  ): Promise<DisbursementPaginatedResult> {
    return this.find({ tenantId, ownerId }, page, pageSize);
  }

  async findPending(tenantId: TenantId): Promise<Disbursement[]> {
    return Array.from(this.disbursements.values())
      .filter(d => 
        d.tenantId === tenantId && 
        ['PENDING', 'PROCESSING', 'IN_TRANSIT'].includes(d.status)
      )
      .map(d => ({ ...d }));
  }

  async findLastByOwner(tenantId: TenantId, ownerId: OwnerId): Promise<Disbursement | null> {
    const disbursements = Array.from(this.disbursements.values())
      .filter(d => d.tenantId === tenantId && d.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return disbursements.length > 0 ? { ...disbursements[0] } : null;
  }
}
