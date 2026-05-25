/**
 * Postgres-backed Financial Profile Repositories (SCAFFOLDED-5)
 *
 *   - PostgresFinancialStatementRepository — CRUD on tenant_financial_statements
 *   - PostgresLitigationRepository         — append-only history on
 *                                            tenant_litigation_history
 *
 * Tenant isolation enforced in every query (WHERE tenant_id = :ctx).
 */

import { and, desc, eq } from 'drizzle-orm';
import {
  tenantFinancialStatements,
  tenantLitigationHistory,
} from '@borjie/database';
import type { TenantId, ISOTimestamp, UserId } from '@borjie/domain-models';
import type {
  FinancialStatement,
  FinancialStatementRepository,
  LitigationRecord,
  LitigationRepository,
  BankReferenceStatus,
  FinancialStatementStatus,
  IncomeSource,
  LitigationKind,
  LitigationOutcome,
} from './financial-profile-service.js';

export interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

function toIso(d: Date | string | null | undefined): ISOTimestamp | null {
  if (!d) return null;
  return (d instanceof Date ? d.toISOString() : String(d)) as ISOTimestamp;
}

function rowToStatement(row: Record<string, any>): FinancialStatement {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    customerId: row.customerId,
    status: (row.status ?? 'submitted') as FinancialStatementStatus,
    monthlyGrossIncome: Number(row.monthlyGrossIncome ?? 0),
    monthlyNetIncome: Number(row.monthlyNetIncome ?? 0),
    otherIncome: Number(row.otherIncome ?? 0),
    incomeCurrency: String(row.incomeCurrency ?? ''),
    incomeSources: (row.incomeSources ?? []) as readonly IncomeSource[],
    monthlyExpenses: Number(row.monthlyExpenses ?? 0),
    monthlyDebtService: Number(row.monthlyDebtService ?? 0),
    existingArrears: Number(row.existingArrears ?? 0),
    employmentStatus: row.employmentStatus ?? null,
    employerName: row.employerName ?? null,
    employmentStartDate: toIso(row.employmentStartDate),
    bankReferenceStatus: (row.bankReferenceStatus ??
      'not_requested') as BankReferenceStatus,
    bankReferenceProvider: row.bankReferenceProvider ?? null,
    bankReferenceScore:
      row.bankReferenceScore == null ? null : Number(row.bankReferenceScore),
    supportingDocumentIds: (row.supportingDocumentIds ?? []) as readonly string[],
    consentGiven: Boolean(row.consentGiven),
    consentGivenAt: toIso(row.consentGivenAt),
    submittedAt: toIso(row.submittedAt),
    submittedBy: (row.submittedBy ?? null) as UserId | null,
    verifiedAt: toIso(row.verifiedAt),
    verifiedBy: (row.verifiedBy ?? null) as UserId | null,
    createdAt: toIso(row.createdAt) ?? ('' as ISOTimestamp),
    updatedAt: toIso(row.updatedAt) ?? ('' as ISOTimestamp),
  };
}

function statementToRow(stmt: FinancialStatement): Record<string, unknown> {
  return {
    id: stmt.id,
    tenantId: stmt.tenantId as unknown as string,
    customerId: stmt.customerId,
    status: stmt.status,
    monthlyGrossIncome: stmt.monthlyGrossIncome,
    monthlyNetIncome: stmt.monthlyNetIncome,
    otherIncome: stmt.otherIncome,
    incomeCurrency: stmt.incomeCurrency,
    incomeSources: stmt.incomeSources,
    monthlyExpenses: stmt.monthlyExpenses,
    monthlyDebtService: stmt.monthlyDebtService,
    existingArrears: stmt.existingArrears,
    employmentStatus: stmt.employmentStatus,
    employerName: stmt.employerName,
    employmentStartDate: stmt.employmentStartDate
      ? new Date(stmt.employmentStartDate)
      : null,
    bankReferenceStatus: stmt.bankReferenceStatus,
    bankReferenceProvider: stmt.bankReferenceProvider,
    bankReferenceScore:
      stmt.bankReferenceScore == null ? null : String(stmt.bankReferenceScore),
    supportingDocumentIds: stmt.supportingDocumentIds,
    consentGiven: stmt.consentGiven,
    consentGivenAt: stmt.consentGivenAt ? new Date(stmt.consentGivenAt) : null,
    submittedAt: stmt.submittedAt ? new Date(stmt.submittedAt) : null,
    submittedBy: stmt.submittedBy,
    verifiedAt: stmt.verifiedAt ? new Date(stmt.verifiedAt) : null,
    verifiedBy: stmt.verifiedBy,
    createdAt: stmt.createdAt ? new Date(stmt.createdAt) : new Date(),
    updatedAt: stmt.updatedAt ? new Date(stmt.updatedAt) : new Date(),
  };
}

export class PostgresFinancialStatementRepository
  implements FinancialStatementRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async create(stmt: FinancialStatement): Promise<FinancialStatement> {
    await this.db.insert(tenantFinancialStatements).values(statementToRow(stmt));
    return stmt;
  }

  async update(stmt: FinancialStatement): Promise<FinancialStatement> {
    const values = statementToRow(stmt);
    // Don't overwrite createdAt on update
    const { createdAt: _omitCreated, ...updateValues } = values as Record<
      string,
      unknown
    > & { createdAt: unknown };
    await this.db
      .update(tenantFinancialStatements)
      .set({ ...updateValues, updatedAt: new Date() })
      .where(
        and(
          eq(tenantFinancialStatements.id, stmt.id),
          eq(
            tenantFinancialStatements.tenantId,
            stmt.tenantId as unknown as string
          )
        )
      );
    return stmt;
  }

  async findById(
    id: string,
    tenantId: TenantId
  ): Promise<FinancialStatement | null> {
    const rows = await this.db
      .select()
      .from(tenantFinancialStatements)
      .where(
        and(
          eq(tenantFinancialStatements.id, id),
          eq(
            tenantFinancialStatements.tenantId,
            tenantId as unknown as string
          )
        )
      )
      .limit(1);
    return rows[0] ? rowToStatement(rows[0]) : null;
  }

  async findLatestByCustomer(
    customerId: string,
    tenantId: TenantId
  ): Promise<FinancialStatement | null> {
    const rows = await this.db
      .select()
      .from(tenantFinancialStatements)
      .where(
        and(
          eq(tenantFinancialStatements.customerId, customerId),
          eq(
            tenantFinancialStatements.tenantId,
            tenantId as unknown as string
          )
        )
      )
      .orderBy(desc(tenantFinancialStatements.createdAt))
      .limit(1);
    return rows[0] ? rowToStatement(rows[0]) : null;
  }
}

function rowToLitigation(row: Record<string, any>): LitigationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    customerId: row.customerId,
    kind: (row.kind ?? 'other') as LitigationKind,
    outcome: (row.outcome ?? 'pending') as LitigationOutcome,
    caseNumber: row.caseNumber ?? null,
    court: row.court ?? null,
    jurisdiction: row.jurisdiction ?? null,
    filedAt: toIso(row.filedAt),
    resolvedAt: toIso(row.resolvedAt),
    amountInvolved:
      row.amountInvolved == null ? null : Number(row.amountInvolved),
    currency: row.currency ?? null,
    summary: row.summary ?? null,
    disclosedBySelf: Boolean(row.disclosedBySelf),
    evidenceDocumentIds: (row.evidenceDocumentIds ?? []) as readonly string[],
    createdAt: toIso(row.createdAt) ?? ('' as ISOTimestamp),
    createdBy: (row.createdBy ?? '') as UserId,
  };
}

export class PostgresLitigationRepository implements LitigationRepository {
  constructor(private readonly db: DrizzleLike) {}

  async create(record: LitigationRecord): Promise<LitigationRecord> {
    await this.db.insert(tenantLitigationHistory).values({
      id: record.id,
      tenantId: record.tenantId as unknown as string,
      customerId: record.customerId,
      kind: record.kind,
      outcome: record.outcome,
      caseNumber: record.caseNumber,
      court: record.court,
      jurisdiction: record.jurisdiction,
      filedAt: record.filedAt ? new Date(record.filedAt) : null,
      resolvedAt: record.resolvedAt ? new Date(record.resolvedAt) : null,
      amountInvolved: record.amountInvolved,
      currency: record.currency,
      summary: record.summary,
      disclosedBySelf: record.disclosedBySelf,
      evidenceDocumentIds: record.evidenceDocumentIds,
      createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
      updatedAt: new Date(),
      createdBy: record.createdBy as unknown as string,
    });
    return record;
  }

  async findByCustomer(
    customerId: string,
    tenantId: TenantId
  ): Promise<LitigationRecord[]> {
    const rows = await this.db
      .select()
      .from(tenantLitigationHistory)
      .where(
        and(
          eq(tenantLitigationHistory.customerId, customerId),
          eq(
            tenantLitigationHistory.tenantId,
            tenantId as unknown as string
          )
        )
      )
      .orderBy(desc(tenantLitigationHistory.createdAt));
    return rows.map(rowToLitigation);
  }
}
