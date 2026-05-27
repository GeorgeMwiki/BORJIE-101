/**
 * Drizzle-backed Statement Repository.
 *
 * Production implementation of `IStatementRepository` against the
 * Drizzle-managed `statements` table (declared in
 * `packages/database/src/schemas/ledger.schema.ts`).
 *
 * Design notes:
 *
 *   - Tenant predicate is on EVERY query. RLS (migration 0169) is
 *     belt; this repo is suspenders.
 *   - Statements carry rich JSON `lineItems` + `summaries`. The
 *     domain shape uses `Money` instances; the DB stores minor units
 *     + currency separately. Conversion is centralised in
 *     `rowToStatement` / `statementToInsert`.
 *   - `existsForPeriod` exploits the DB unique index
 *     `statements_account_period_idx` (tenant_id, account_id, type,
 *     period_start, period_end) added in the original ledger
 *     schema. The repo-level check is a defensive read; the unique
 *     index is the enforcement.
 *   - Hard DB errors bubble up. No silent swallow.
 */

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  Money,
  type AccountId,
  type CurrencyCode,
  type CustomerId,
  type OwnerId,
  type PropertyId,
  type Statement,
  type StatementId,
  type StatementLineItem,
  type StatementPeriodType,
  type StatementStatus,
  type StatementSummary,
  type StatementType,
  type TenantId,
} from '@borjie/domain-models';
import { type DatabaseClient } from '@borjie/database';
import { statements, type StatementRow } from './drizzle-schema';
import type {
  IStatementRepository,
  StatementFilters,
  StatementPaginatedResult,
} from './statement.repository';

// ────────────────────────────────────────────────────────────────────
// JSON ⇄ Money helpers
//
// lineItems / summaries are persisted as JSONB. Money instances must
// be flattened to `{ amountMinorUnits, currency }` before the write
// and re-hydrated on read so the consumer keeps the domain dialect.
// ────────────────────────────────────────────────────────────────────

interface SerializedMoney {
  readonly amountMinorUnits: number;
  readonly currency: CurrencyCode;
}

interface SerializedLineItem {
  readonly date: string; // ISO timestamp
  readonly type: string;
  readonly description: string;
  readonly reference?: string;
  readonly debit?: SerializedMoney;
  readonly credit?: SerializedMoney;
  readonly balance: SerializedMoney;
  readonly propertyId?: string;
  readonly unitId?: string;
  readonly metadata?: Record<string, unknown>;
}

interface SerializedSummary {
  readonly label: string;
  readonly amount: SerializedMoney;
  readonly percentage?: number;
  readonly breakdown?: ReadonlyArray<{
    readonly label: string;
    readonly amount: SerializedMoney;
  }>;
}

function moneyToSerialized(m: Money): SerializedMoney {
  return { amountMinorUnits: m.amountMinorUnits, currency: m.currency };
}

function serializedToMoney(m: SerializedMoney): Money {
  return Money.fromMinorUnits(m.amountMinorUnits, m.currency);
}

function lineItemToSerialized(item: StatementLineItem): SerializedLineItem {
  return {
    date: item.date.toISOString(),
    type: item.type,
    description: item.description,
    reference: item.reference,
    debit: item.debit ? moneyToSerialized(item.debit) : undefined,
    credit: item.credit ? moneyToSerialized(item.credit) : undefined,
    balance: moneyToSerialized(item.balance),
    propertyId: item.propertyId,
    unitId: item.unitId,
    metadata: item.metadata,
  };
}

function serializedToLineItem(s: SerializedLineItem): StatementLineItem {
  return {
    date: new Date(s.date),
    type: s.type,
    description: s.description,
    reference: s.reference,
    debit: s.debit ? serializedToMoney(s.debit) : undefined,
    credit: s.credit ? serializedToMoney(s.credit) : undefined,
    balance: serializedToMoney(s.balance),
    propertyId: s.propertyId as PropertyId | undefined,
    unitId: s.unitId,
    metadata: s.metadata,
  };
}

function summaryToSerialized(s: StatementSummary): SerializedSummary {
  return {
    label: s.label,
    amount: moneyToSerialized(s.amount),
    percentage: s.percentage,
    breakdown: s.breakdown?.map((b) => ({
      label: b.label,
      amount: moneyToSerialized(b.amount),
    })),
  };
}

function serializedToSummary(s: SerializedSummary): StatementSummary {
  return {
    label: s.label,
    amount: serializedToMoney(s.amount),
    percentage: s.percentage,
    breakdown: s.breakdown?.map((b) => ({
      label: b.label,
      amount: serializedToMoney(b.amount),
    })),
  };
}

function safeArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  return [];
}

function safeMetadata(v: unknown): Record<string, unknown> | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object') return v as Record<string, unknown>;
  return undefined;
}

// ────────────────────────────────────────────────────────────────────
// Row ⇄ Domain converters
// ────────────────────────────────────────────────────────────────────

function rowToStatement(row: StatementRow): Statement {
  const currency = row.currency as CurrencyCode;
  const lineItems = safeArray<SerializedLineItem>(row.lineItems).map(
    serializedToLineItem,
  );
  const summaries = safeArray<SerializedSummary>(row.summaries).map(
    serializedToSummary,
  );

  return {
    id: row.id as StatementId,
    tenantId: row.tenantId as TenantId,
    type: row.type as StatementType,
    status: row.status as StatementStatus,
    periodType: row.periodType as StatementPeriodType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    generatedAt: row.generatedAt,
    ownerId: (row.ownerId ?? undefined) as OwnerId | undefined,
    customerId: (row.customerId ?? undefined) as CustomerId | undefined,
    propertyId: (row.propertyId ?? undefined) as PropertyId | undefined,
    accountId: row.accountId as AccountId,
    currency,
    openingBalance: Money.fromMinorUnits(
      row.openingBalanceMinorUnits ?? 0,
      currency,
    ),
    closingBalance: Money.fromMinorUnits(
      row.closingBalanceMinorUnits ?? 0,
      currency,
    ),
    totalDebits: Money.fromMinorUnits(row.totalDebitsMinorUnits ?? 0, currency),
    totalCredits: Money.fromMinorUnits(
      row.totalCreditsMinorUnits ?? 0,
      currency,
    ),
    netChange: Money.fromMinorUnits(row.netChangeMinorUnits ?? 0, currency),
    lineItems,
    summaries,
    sentAt: row.sentAt ?? undefined,
    viewedAt: row.viewedAt ?? undefined,
    recipientEmail: row.recipientEmail ?? undefined,
    documentUrl: row.documentUrl ?? undefined,
    documentFormat: undefined,
    metadata: safeMetadata(undefined),
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? '',
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? '',
  } as Statement;
}

function statementToInsert(s: Statement): typeof statements.$inferInsert {
  return {
    id: s.id,
    tenantId: s.tenantId,
    accountId: s.accountId ?? '',
    ownerId: s.ownerId ?? null,
    customerId: s.customerId ?? null,
    propertyId: s.propertyId ?? null,
    type: s.type,
    status: s.status,
    periodType: s.periodType,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    currency: s.currency,
    openingBalanceMinorUnits: s.openingBalance.amountMinorUnits,
    closingBalanceMinorUnits: s.closingBalance.amountMinorUnits,
    totalDebitsMinorUnits: s.totalDebits.amountMinorUnits,
    totalCreditsMinorUnits: s.totalCredits.amountMinorUnits,
    netChangeMinorUnits: s.netChange.amountMinorUnits,
    lineItems: s.lineItems.map(lineItemToSerialized),
    summaries: s.summaries.map(summaryToSerialized),
    recipientEmail: s.recipientEmail ?? null,
    sentAt: s.sentAt ?? null,
    viewedAt: s.viewedAt ?? null,
    documentUrl: s.documentUrl ?? null,
    generatedAt: s.generatedAt,
    createdBy: s.createdBy ?? null,
    updatedBy: s.updatedBy ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────
// Drizzle repository
// ────────────────────────────────────────────────────────────────────

export class DrizzleStatementRepository implements IStatementRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(statement: Statement): Promise<Statement> {
    const inserted = await this.db
      .insert(statements)
      .values(statementToInsert(statement))
      .returning();

    if (!inserted[0]) {
      throw new Error(
        `DrizzleStatementRepository.create: insert returned no row for id=${statement.id}`,
      );
    }
    return rowToStatement(inserted[0]);
  }

  async findById(
    id: StatementId,
    tenantId: TenantId,
  ): Promise<Statement | null> {
    const rows = await this.db
      .select()
      .from(statements)
      .where(and(eq(statements.id, id), eq(statements.tenantId, tenantId)))
      .limit(1);

    return rows[0] ? rowToStatement(rows[0]) : null;
  }

  async update(statement: Statement): Promise<Statement> {
    const updates = {
      ownerId: statement.ownerId ?? null,
      customerId: statement.customerId ?? null,
      propertyId: statement.propertyId ?? null,
      type: statement.type,
      status: statement.status,
      periodType: statement.periodType,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      currency: statement.currency,
      openingBalanceMinorUnits: statement.openingBalance.amountMinorUnits,
      closingBalanceMinorUnits: statement.closingBalance.amountMinorUnits,
      totalDebitsMinorUnits: statement.totalDebits.amountMinorUnits,
      totalCreditsMinorUnits: statement.totalCredits.amountMinorUnits,
      netChangeMinorUnits: statement.netChange.amountMinorUnits,
      lineItems: statement.lineItems.map(lineItemToSerialized),
      summaries: statement.summaries.map(summaryToSerialized),
      recipientEmail: statement.recipientEmail ?? null,
      sentAt: statement.sentAt ?? null,
      viewedAt: statement.viewedAt ?? null,
      documentUrl: statement.documentUrl ?? null,
      updatedBy: statement.updatedBy ?? null,
      updatedAt: new Date(),
    };

    const updated = await this.db
      .update(statements)
      .set(updates)
      .where(
        and(
          eq(statements.id, statement.id),
          eq(statements.tenantId, statement.tenantId),
        ),
      )
      .returning();

    if (!updated[0]) {
      throw new Error(
        `DrizzleStatementRepository.update: no row updated for id=${statement.id}`,
      );
    }
    return rowToStatement(updated[0]);
  }

  async find(
    filters: StatementFilters,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<StatementPaginatedResult> {
    const conditions = [eq(statements.tenantId, filters.tenantId)];

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      conditions.push(inArray(statements.type, types));
    }
    if (filters.status) {
      const ss = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      conditions.push(inArray(statements.status, ss));
    }
    if (filters.ownerId) {
      conditions.push(eq(statements.ownerId, filters.ownerId));
    }
    if (filters.customerId) {
      conditions.push(eq(statements.customerId, filters.customerId));
    }
    if (filters.propertyId) {
      conditions.push(eq(statements.propertyId, filters.propertyId));
    }
    if (filters.accountId) {
      conditions.push(eq(statements.accountId, filters.accountId));
    }
    if (filters.periodType) {
      conditions.push(eq(statements.periodType, filters.periodType));
    }
    if (filters.periodStart) {
      conditions.push(gte(statements.periodStart, filters.periodStart));
    }
    if (filters.periodEnd) {
      conditions.push(lte(statements.periodEnd, filters.periodEnd));
    }

    const where = and(...conditions);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(500, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(statements)
        .where(where)
        .orderBy(desc(statements.generatedAt))
        .limit(safePageSize)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(statements)
        .where(where),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      statements: rows.map(rowToStatement),
      total,
      page: safePage,
      pageSize: safePageSize,
      hasMore: offset + rows.length < total,
    };
  }

  async findLatestByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
    type: StatementType,
  ): Promise<Statement | null> {
    const rows = await this.db
      .select()
      .from(statements)
      .where(
        and(
          eq(statements.tenantId, tenantId),
          eq(statements.ownerId, ownerId),
          eq(statements.type, type),
        ),
      )
      .orderBy(desc(statements.periodEnd))
      .limit(1);

    return rows[0] ? rowToStatement(rows[0]) : null;
  }

  async findLatestByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    type: StatementType,
  ): Promise<Statement | null> {
    const rows = await this.db
      .select()
      .from(statements)
      .where(
        and(
          eq(statements.tenantId, tenantId),
          eq(statements.customerId, customerId),
          eq(statements.type, type),
        ),
      )
      .orderBy(desc(statements.periodEnd))
      .limit(1);

    return rows[0] ? rowToStatement(rows[0]) : null;
  }

  async existsForPeriod(
    tenantId: TenantId,
    accountId: AccountId,
    type: StatementType,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: statements.id })
      .from(statements)
      .where(
        and(
          eq(statements.tenantId, tenantId),
          eq(statements.accountId, accountId),
          eq(statements.type, type),
          eq(statements.periodStart, periodStart),
          eq(statements.periodEnd, periodEnd),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  async findPendingDelivery(tenantId: TenantId): Promise<Statement[]> {
    const rows = await this.db
      .select()
      .from(statements)
      .where(
        and(
          eq(statements.tenantId, tenantId),
          eq(statements.status, 'GENERATED'),
          isNull(statements.sentAt),
        ),
      )
      .orderBy(asc(statements.generatedAt));

    return rows.map(rowToStatement);
  }

  async findByStatus(
    tenantId: TenantId,
    status: StatementStatus,
  ): Promise<Statement[]> {
    const rows = await this.db
      .select()
      .from(statements)
      .where(
        and(eq(statements.tenantId, tenantId), eq(statements.status, status)),
      );

    return rows.map(rowToStatement);
  }
}
