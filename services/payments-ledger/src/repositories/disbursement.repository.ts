/**
 * Disbursement Repository Interface
 * Defines the contract for disbursement persistence
 */
import { TenantId, OwnerId, Money, CurrencyCode } from '@borjie/domain-models';

/**
 * Disbursement status.
 *
 * NEEDS_REVERSAL (EDGE-HARDENING #6): the ledger journal was posted but the
 * outbound transfer FAILED afterwards. The disbursement is retryable — the
 * reconciliation job either re-drives the transfer under the SAME
 * idempotency key (on confirmed non-delivery) or posts a compensating
 * reversal. NEVER a blind re-transfer.
 */
export type DisbursementStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'IN_TRANSIT'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'NEEDS_REVERSAL';

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
   * Get disbursement by transfer ID.
   *
   * F1 (CROSS-TENANT money write) — `tenantId` is REQUIRED. The B2C result
   * webhook runs OUTSIDE tenant context (webhooks are excluded from auth), so
   * without a tenant predicate tenant A's inbound result could resolve to
   * tenant B's disbursement (the provider transfer-id namespace is shared) and
   * post a reversal into tenant B's ledger. The caller resolves the tenant
   * from the globally-unique `disb-<id>` originator FIRST, then passes it here
   * so the lookup is tenant-scoped (mirrors `findByExternalId`). RLS is the
   * belt; this predicate is suspenders.
   */
  findByTransferId(
    provider: string,
    transferId: string,
    tenantId: TenantId,
  ): Promise<Disbursement | null>;

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

  /**
   * F1 — resolve a disbursement's owning tenant from its globally-unique id.
   *
   * The B2C result webhook runs OUTSIDE tenant context and only knows the
   * disbursement id (echoed back as the `disb-<id>` OriginatorConversationID).
   * It must learn the tenant BEFORE any tenant-scoped op. This is the only
   * cross-tenant read in the repository; it returns just the tenant id (never
   * row contents) and is keyed on the unguessable UUID PK so it resolves to a
   * single row. Production binds the `service_role_bypass` GUC for this read;
   * the in-memory adapter looks up its map directly.
   *
   * Returns null when no disbursement has that id.
   */
  resolveTenantById(id: string): Promise<{ tenantId: TenantId } | null>;
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

  async findByTransferId(
    provider: string,
    transferId: string,
    tenantId: TenantId,
  ): Promise<Disbursement | null> {
    for (const disbursement of this.disbursements.values()) {
      if (
        disbursement.provider === provider &&
        disbursement.transferId === transferId &&
        disbursement.tenantId === tenantId
      ) {
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
        // NEEDS_REVERSAL is retryable — surfaced to the reconciliation job.
        ['PENDING', 'PROCESSING', 'IN_TRANSIT', 'NEEDS_REVERSAL'].includes(d.status)
      )
      .map(d => ({ ...d }));
  }

  async findLastByOwner(tenantId: TenantId, ownerId: OwnerId): Promise<Disbursement | null> {
    const disbursements = Array.from(this.disbursements.values())
      .filter(d => d.tenantId === tenantId && d.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return disbursements.length > 0 ? { ...disbursements[0] } : null;
  }

  async resolveTenantById(id: string): Promise<{ tenantId: TenantId } | null> {
    const disbursement = this.disbursements.get(id);
    return disbursement ? { tenantId: disbursement.tenantId } : null;
  }
}
