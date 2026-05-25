/**
 * Statement Repository Interface
 * Defines the contract for statement persistence
 */
import {
  Statement,
  StatementId,
  TenantId,
  OwnerId,
  CustomerId,
  PropertyId,
  AccountId,
  StatementType,
  StatementStatus,
  StatementPeriodType
} from '@borjie/domain-models';

export interface StatementFilters {
  tenantId: TenantId;
  type?: StatementType | StatementType[];
  status?: StatementStatus | StatementStatus[];
  ownerId?: OwnerId;
  customerId?: CustomerId;
  propertyId?: PropertyId;
  accountId?: AccountId;
  periodType?: StatementPeriodType;
  periodStart?: Date;
  periodEnd?: Date;
}

export interface StatementPaginatedResult {
  statements: Statement[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface IStatementRepository {
  /**
   * Create a new statement
   */
  create(statement: Statement): Promise<Statement>;

  /**
   * Get statement by ID
   */
  findById(id: StatementId, tenantId: TenantId): Promise<Statement | null>;

  /**
   * Update statement
   */
  update(statement: Statement): Promise<Statement>;

  /**
   * Find statements with filters
   */
  find(
    filters: StatementFilters,
    page?: number,
    pageSize?: number
  ): Promise<StatementPaginatedResult>;

  /**
   * Get latest statement for an owner
   */
  findLatestByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
    type: StatementType
  ): Promise<Statement | null>;

  /**
   * Get latest statement for a customer
   */
  findLatestByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    type: StatementType
  ): Promise<Statement | null>;

  /**
   * Check if statement exists for period
   */
  existsForPeriod(
    tenantId: TenantId,
    accountId: AccountId,
    type: StatementType,
    periodStart: Date,
    periodEnd: Date
  ): Promise<boolean>;

  /**
   * Get statements pending delivery
   */
  findPendingDelivery(
    tenantId: TenantId
  ): Promise<Statement[]>;

  /**
   * Get statements by status
   */
  findByStatus(
    tenantId: TenantId,
    status: StatementStatus
  ): Promise<Statement[]>;
}

/**
 * In-memory implementation for testing
 */
export class InMemoryStatementRepository implements IStatementRepository {
  private statements: Map<string, Statement> = new Map();

  async create(statement: Statement): Promise<Statement> {
    this.statements.set(statement.id, { ...statement });
    return statement;
  }

  async findById(id: StatementId, tenantId: TenantId): Promise<Statement | null> {
    const statement = this.statements.get(id);
    if (statement && statement.tenantId === tenantId) {
      return { ...statement };
    }
    return null;
  }

  async update(statement: Statement): Promise<Statement> {
    this.statements.set(statement.id, { ...statement });
    return statement;
  }

  async find(
    filters: StatementFilters,
    page: number = 1,
    pageSize: number = 20
  ): Promise<StatementPaginatedResult> {
    let items = Array.from(this.statements.values())
      .filter(s => s.tenantId === filters.tenantId);

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      items = items.filter(s => types.includes(s.type));
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      items = items.filter(s => statuses.includes(s.status));
    }
    if (filters.ownerId) {
      items = items.filter(s => s.ownerId === filters.ownerId);
    }
    if (filters.customerId) {
      items = items.filter(s => s.customerId === filters.customerId);
    }
    if (filters.propertyId) {
      items = items.filter(s => s.propertyId === filters.propertyId);
    }
    if (filters.accountId) {
      items = items.filter(s => s.accountId === filters.accountId);
    }
    if (filters.periodType) {
      items = items.filter(s => s.periodType === filters.periodType);
    }
    if (filters.periodStart) {
      items = items.filter(s => s.periodStart >= filters.periodStart!);
    }
    if (filters.periodEnd) {
      items = items.filter(s => s.periodEnd <= filters.periodEnd!);
    }

    items.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());

    const total = items.length;
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    return {
      statements: pageItems.map(s => ({ ...s })),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    };
  }

  async findLatestByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
    type: StatementType
  ): Promise<Statement | null> {
    const statements = Array.from(this.statements.values())
      .filter(s =>
        s.tenantId === tenantId &&
        s.ownerId === ownerId &&
        s.type === type
      )
      .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());

    return statements.length > 0 ? { ...statements[0] } : null;
  }

  async findLatestByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    type: StatementType
  ): Promise<Statement | null> {
    const statements = Array.from(this.statements.values())
      .filter(s =>
        s.tenantId === tenantId &&
        s.customerId === customerId &&
        s.type === type
      )
      .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());

    return statements.length > 0 ? { ...statements[0] } : null;
  }

  async existsForPeriod(
    tenantId: TenantId,
    accountId: AccountId,
    type: StatementType,
    periodStart: Date,
    periodEnd: Date
  ): Promise<boolean> {
    for (const statement of this.statements.values()) {
      if (
        statement.tenantId === tenantId &&
        statement.accountId === accountId &&
        statement.type === type &&
        statement.periodStart.getTime() === periodStart.getTime() &&
        statement.periodEnd.getTime() === periodEnd.getTime()
      ) {
        return true;
      }
    }
    return false;
  }

  async findPendingDelivery(tenantId: TenantId): Promise<Statement[]> {
    return Array.from(this.statements.values())
      .filter(s =>
        s.tenantId === tenantId &&
        s.status === 'GENERATED' &&
        !s.sentAt
      )
      .map(s => ({ ...s }));
  }

  async findByStatus(
    tenantId: TenantId,
    status: StatementStatus
  ): Promise<Statement[]> {
    return Array.from(this.statements.values())
      .filter(s => s.tenantId === tenantId && s.status === status)
      .map(s => ({ ...s }));
  }
}
