/**
 * Postgres-backed arrears infrastructure.
 *
 * Three adapters that the api-gateway wires into the arrears router:
 *
 *   1. PostgresArrearsRepository — persists line proposals and case
 *      rows. Cases are stored in `arrears_line_proposals` via their
 *      `arrears_case_id` linkage; we keep proposals as the primary
 *      aggregate. Case creation writes a seed proposal-shaped row into
 *      a dedicated `arrears_cases` table ONLY when that table exists.
 *      When it does not, we persist a logical case record by emitting
 *      the caseNumber + id pair and rely on proposals being keyed by
 *      `arrears_case_id`. This preserves the immutable ledger
 *      invariant: nothing is ever updated in place — approvals append
 *      a fresh transaction row and set the proposal's `related_entry_id`
 *      via a single targeted UPDATE on the proposal record only.
 *
 *   2. PostgresLedgerPort — appends arrears adjustments to the
 *      `transactions` table. The entries are written as
 *      transaction_type ∈ {'adjustment','write_off'} with a negative
 *      or positive signed amount matching the arrears proposal. The
 *      balance_before/balance_after fields are computed against the
 *      most recent transaction for the (tenantId, customerId) pair.
 *      Never mutates; only INSERTs.
 *
 *   3. PostgresArrearsEntryLoader — reads the customer's ledger
 *      (transactions) plus the approved arrears proposals for the
 *      given arrears_case_id and returns them as `LedgerReplayEntry[]`
 *      the projection service can replay into a balance snapshot.
 *      When no proposals exist for the case, returns an empty entry
 *      list and `customerId = null` so the router can 404.
 *
 * Tenant isolation is enforced on every SELECT/INSERT/UPDATE via
 * WHERE tenant_id = :ctx.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as Database from '@borjie/database';
// REMOVED (borjie hard-fork): ArrearsLedger may not be exported by database package
const ArrearsLedger: any = (Database as any).ArrearsLedger ?? { arrearsLineProposals: undefined };
const transactions: any = (Database as any).transactions ?? undefined;
import type {
  ArrearsRepository,
  LedgerPort,
  LedgerAdjustmentEntry,
} from '@borjie/payments-ledger-service/arrears';
import type {
  ArrearsLineProposal,
  ArrearsProposalKind,
  ArrearsProposalStatus,
  LedgerReplayEntry,
} from '@borjie/payments-ledger-service/arrears';

const arrearsLineProposals = ArrearsLedger?.arrearsLineProposals;

type DrizzleLike = {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  [k: string]: any;
};

function toIso(d: Date | string | null | undefined): string {
  if (!d) return new Date(0).toISOString();
  if (typeof d === 'string') return d;
  return d.toISOString();
}

function rowToProposal(r: any): ArrearsLineProposal {
  return {
    id: r.id,
    tenantId: r.tenantId,
    customerId: r.customerId,
    arrearsCaseId: r.arrearsCaseId,
    invoiceId: r.invoiceId ?? null,
    kind: r.kind as ArrearsProposalKind,
    amountMinorUnits: r.amountMinorUnits,
    currency: r.currency,
    reason: r.reason,
    evidenceDocIds: Array.isArray(r.evidenceDocIds) ? r.evidenceDocIds : [],
    status: r.status as ArrearsProposalStatus,
    proposedBy: r.proposedBy,
    proposedAt: toIso(r.proposedAt),
    approvedBy: r.approvedBy ?? null,
    approvedAt: r.approvedAt ? toIso(r.approvedAt) : null,
    approvalNotes: r.approvalNotes ?? null,
    rejectedBy: r.rejectedBy ?? null,
    rejectedAt: r.rejectedAt ? toIso(r.rejectedAt) : null,
    rejectionReason: r.rejectionReason ?? null,
    relatedEntryId: r.relatedEntryId ?? null,
    balanceBeforeMinorUnits: r.balanceBeforeMinorUnits ?? null,
    projectedBalanceAfterMinorUnits: r.projectedBalanceAfterMinorUnits ?? null,
    createdAt: toIso(r.createdAt),
  };
}

// ---------------------------------------------------------------------------
// PostgresArrearsRepository
// ---------------------------------------------------------------------------

export class PostgresArrearsRepository implements ArrearsRepository {
  constructor(private readonly db: DrizzleLike) {}

  async saveProposal(proposal: ArrearsLineProposal): Promise<void> {
    await this.db.insert(arrearsLineProposals).values({
      id: proposal.id,
      tenantId: proposal.tenantId,
      customerId: proposal.customerId,
      arrearsCaseId: proposal.arrearsCaseId,
      invoiceId: proposal.invoiceId,
      kind: proposal.kind,
      amountMinorUnits: proposal.amountMinorUnits,
      currency: proposal.currency,
      reason: proposal.reason,
      evidenceDocIds: Array.from(proposal.evidenceDocIds ?? []),
      status: proposal.status,
      proposedBy: proposal.proposedBy,
      proposedAt: new Date(proposal.proposedAt),
      approvedBy: proposal.approvedBy,
      approvedAt: proposal.approvedAt ? new Date(proposal.approvedAt) : null,
      approvalNotes: proposal.approvalNotes,
      rejectedBy: proposal.rejectedBy,
      rejectedAt: proposal.rejectedAt ? new Date(proposal.rejectedAt) : null,
      rejectionReason: proposal.rejectionReason,
      relatedEntryId: proposal.relatedEntryId,
      balanceBeforeMinorUnits: proposal.balanceBeforeMinorUnits,
      projectedBalanceAfterMinorUnits: proposal.projectedBalanceAfterMinorUnits,
      createdAt: new Date(proposal.createdAt),
    });
  }

  async getProposal(
    tenantId: string,
    proposalId: string
  ): Promise<ArrearsLineProposal | null> {
    const rows = await this.db
      .select()
      .from(arrearsLineProposals)
      .where(
        and(
          eq(arrearsLineProposals.id, proposalId),
          eq(arrearsLineProposals.tenantId, tenantId)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToProposal(row) : null;
  }

  async updateProposalOnApproval(
    tenantId: string,
    proposalId: string,
    approval: {
      approvedBy: string;
      approvedAt: string;
      approvalNotes?: string;
      relatedEntryId: string;
    }
  ): Promise<void> {
    await this.db
      .update(arrearsLineProposals)
      .set({
        status: 'approved',
        approvedBy: approval.approvedBy,
        approvedAt: new Date(approval.approvedAt),
        approvalNotes: approval.approvalNotes ?? null,
        relatedEntryId: approval.relatedEntryId,
      })
      .where(
        and(
          eq(arrearsLineProposals.id, proposalId),
          eq(arrearsLineProposals.tenantId, tenantId)
        )
      );
  }

  async updateProposalOnRejection(
    tenantId: string,
    proposalId: string,
    rejection: {
      rejectedBy: string;
      rejectedAt: string;
      rejectionReason: string;
    }
  ): Promise<void> {
    await this.db
      .update(arrearsLineProposals)
      .set({
        status: 'rejected',
        rejectedBy: rejection.rejectedBy,
        rejectedAt: new Date(rejection.rejectedAt),
        rejectionReason: rejection.rejectionReason,
      })
      .where(
        and(
          eq(arrearsLineProposals.id, proposalId),
          eq(arrearsLineProposals.tenantId, tenantId)
        )
      );
  }

  async createCase(args: {
    tenantId: string;
    customerId: string;
    leaseId?: string;
    propertyId?: string;
    unitId?: string;
    caseNumber: string;
    totalArrearsAmount: number;
    currency: string;
    daysOverdue: number;
    overdueInvoiceCount: number;
    oldestInvoiceDate: Date;
    createdBy: string;
    notes?: string;
  }): Promise<{ id: string; caseNumber: string }> {
    // The canonical `arrears_cases` table may not be present in every
    // deployment (the richer projection suite in `arrears_line_proposals`
    // is the source of truth post-NEW-4). When it is present we write
    // a case row; when it is not we still return a stable id so the
    // caller can start submitting proposals keyed by that id.
    const id = `arc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const hasTable = await this.arrearsCasesTableExists();
    if (hasTable) {
      await this.db.execute(sql`
        INSERT INTO arrears_cases (
          id, tenant_id, customer_id, lease_id, property_id, unit_id,
          case_number, status,
          total_arrears_amount, current_balance, currency,
          days_past_due, aging_bucket,
          overdue_invoices,
          created_at, updated_at, created_by
        ) VALUES (
          ${id}, ${args.tenantId}, ${args.customerId},
          ${args.leaseId ?? null}, ${args.propertyId ?? null}, ${
            args.unitId ?? null
          },
          ${args.caseNumber}, 'active',
          ${args.totalArrearsAmount}, ${args.totalArrearsAmount}, ${args.currency},
          ${args.daysOverdue}, ${agingBucketFor(args.daysOverdue)},
          ${sql.raw("'[]'::jsonb")},
          now(), now(), ${args.createdBy}
        )
      `);
    }
    return { id, caseNumber: args.caseNumber };
  }

  private _tableExists: boolean | null = null;
  private async arrearsCasesTableExists(): Promise<boolean> {
    if (this._tableExists !== null) return this._tableExists;
    const res = await this.db.execute(sql`
      SELECT to_regclass('public.arrears_cases') AS reg
    `);
    // drizzle postgres-js returns { rows: [{reg: ...}] } OR raw array
    const rows = res?.rows ?? res ?? [];
    const first = Array.isArray(rows) ? rows[0] : null;
    this._tableExists = !!(first && first.reg);
    return this._tableExists;
  }
}

function agingBucketFor(daysPastDue: number): string {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  if (daysPastDue <= 180) return '91-180';
  return '180+';
}

// ---------------------------------------------------------------------------
// PostgresLedgerPort
// ---------------------------------------------------------------------------

function ledgerTypeToTransactionType(
  t: LedgerAdjustmentEntry['entryType']
): string {
  switch (t) {
    case 'waiver':
    case 'adjustment':
      return 'adjustment';
    case 'writeoff':
      return 'write_off';
    case 'late_fee':
      return 'charge';
    default:
      return 'adjustment';
  }
}

export class PostgresLedgerPort implements LedgerPort {
  constructor(private readonly db: DrizzleLike) {}

  async appendAdjustment(entry: LedgerAdjustmentEntry): Promise<void> {
    // Compute prior balance for the customer so balance_after is
    // correct. We read the most recent posted transaction for the
    // (tenantId, customerId) pair.
    const [latest] = await this.db
      .select({ balanceAfter: transactions.balanceAfter, seq: transactions.sequenceNumber })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, entry.tenantId),
          eq(transactions.customerId, entry.customerId)
        )
      )
      .orderBy(desc(transactions.sequenceNumber))
      .limit(1);

    const balanceBefore = latest?.balanceAfter ?? 0;
    const balanceAfter = balanceBefore + entry.amountMinorUnits;
    const nextSeq = (latest?.seq ?? 0) + 1;

    // Per-tenant transaction numbers: use the entry id as the tail so
    // the unique constraint (tenant_id, transaction_number) holds.
    const transactionNumber = `ARRADJ-${entry.id}`;

    await this.db.insert(transactions).values({
      id: entry.id,
      tenantId: entry.tenantId,
      customerId: entry.customerId,
      invoiceId: entry.invoiceId,
      transactionNumber,
      journalId: entry.relatedEntryId ?? entry.id,
      transactionType: ledgerTypeToTransactionType(entry.entryType),
      amount: entry.amountMinorUnits,
      currency: entry.currency,
      balanceBefore,
      balanceAfter,
      effectiveDate: new Date(entry.postedAt),
      postedAt: new Date(entry.postedAt),
      description: entry.description,
      reference: entry.relatedEntryId,
      sequenceNumber: nextSeq,
      metadata: { source: 'arrears-adjustment', entryType: entry.entryType },
      createdAt: new Date(entry.postedAt),
      createdBy: entry.postedBy,
    });
  }
}

// ---------------------------------------------------------------------------
// PostgresArrearsEntryLoader
// ---------------------------------------------------------------------------

export interface ArrearsEntryLoaderInput {
  readonly tenantId: string;
  readonly arrearsCaseId: string;
}

export interface ArrearsEntryLoaderResult {
  readonly customerId: string;
  readonly currency: string;
  readonly entries: readonly LedgerReplayEntry[];
}

export type ArrearsEntryLoader = (
  input: ArrearsEntryLoaderInput
) => Promise<ArrearsEntryLoaderResult | null>;

function transactionTypeToLedgerType(
  t: string
): LedgerReplayEntry['entryType'] {
  switch (t) {
    case 'charge':
      return 'charge';
    case 'payment':
      return 'payment';
    case 'adjustment':
      return 'adjustment';
    case 'write_off':
      return 'writeoff';
    case 'refund':
      return 'payment'; // refund = negative payment, handled by sign
    default:
      return 'adjustment';
  }
}

export function createPostgresArrearsEntryLoader(
  db: DrizzleLike
): ArrearsEntryLoader {
  return async ({ tenantId, arrearsCaseId }) => {
    // Resolve the case's customer + currency by looking up ANY proposal
    // on this case. If none exists, the case is unknown to this system.
    const proposalRows = await db
      .select()
      .from(arrearsLineProposals)
      .where(
        and(
          eq(arrearsLineProposals.arrearsCaseId, arrearsCaseId),
          eq(arrearsLineProposals.tenantId, tenantId)
        )
      )
      .orderBy(arrearsLineProposals.createdAt)
      .limit(200);

    if (proposalRows.length === 0) {
      // No proposals — try the arrears_cases table if it exists,
      // otherwise the case is unknown.
      const caseRow = await lookupArrearsCase(db, tenantId, arrearsCaseId);
      if (!caseRow) return null;
      const customerId: string = caseRow.customer_id;
      const currency: string = caseRow.currency;
      const txEntries = await loadCustomerTransactions(db, tenantId, customerId);
      return {
        customerId,
        currency,
        entries: txEntries.map((r) => transactionRowToLedgerEntry(r)),
      };
    }

    const first = proposalRows[0];
    const customerId: string = first.customerId;
    const currency: string = first.currency;

    // Load the customer's transactions (the immutable ledger).
    const txEntries = await loadCustomerTransactions(db, tenantId, customerId);
    const txLedger = txEntries.map((r) => transactionRowToLedgerEntry(r));

    // Project approved proposals as their OWN ledger entries when the
    // associated transaction wasn't materialised (e.g. approval
    // happened before the gateway was wired to the ledger port, or the
    // `transactions` write failed and the approval proposal was
    // retained as the source of truth). Only approved proposals count.
    const approvedProposalEntries: LedgerReplayEntry[] = proposalRows
      .filter((p: any) => p.status === 'approved')
      .map((p: any) => proposalToLedgerEntry(p))
      .filter(
        (entry) => !txLedger.some((t) => t.id === entry.id)
      );

    return {
      customerId,
      currency,
      entries: [...txLedger, ...approvedProposalEntries],
    };
  };
}

async function lookupArrearsCase(
  db: DrizzleLike,
  tenantId: string,
  arrearsCaseId: string
): Promise<{ customer_id: string; currency: string } | null> {
  try {
    const res = await db.execute(sql`
      SELECT customer_id, currency
      FROM arrears_cases
      WHERE id = ${arrearsCaseId} AND tenant_id = ${tenantId}
      LIMIT 1
    `);
    const rows = res?.rows ?? res ?? [];
    const first = Array.isArray(rows) ? rows[0] : null;
    return first ?? null;
  } catch {
    // Table may not exist in every deployment. Treat as unknown case.
    return null;
  }
}

async function loadCustomerTransactions(
  db: DrizzleLike,
  tenantId: string,
  customerId: string
): Promise<any[]> {
  return await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.customerId, customerId)
      )
    )
    .orderBy(transactions.sequenceNumber)
    .limit(1000);
}

function transactionRowToLedgerEntry(r: any): LedgerReplayEntry {
  return {
    id: r.id,
    tenantId: r.tenantId,
    customerId: r.customerId,
    invoiceId: r.invoiceId ?? null,
    entryType: transactionTypeToLedgerType(r.transactionType),
    amountMinorUnits: r.amount,
    currency: r.currency,
    description: r.description ?? '',
    transactionDate: toIso(r.effectiveDate),
    postedAt: toIso(r.postedAt),
    relatedEntryId: r.reference ?? r.journalId ?? null,
  };
}

function proposalToLedgerEntry(p: any): LedgerReplayEntry {
  const type: LedgerReplayEntry['entryType'] =
    p.kind === 'writeoff'
      ? 'writeoff'
      : p.kind === 'waiver'
        ? 'waiver'
        : p.kind === 'late_fee'
          ? 'late_fee'
          : 'adjustment';
  return {
    id: p.relatedEntryId ?? p.id,
    tenantId: p.tenantId,
    customerId: p.customerId,
    invoiceId: p.invoiceId ?? null,
    entryType: type,
    amountMinorUnits: p.amountMinorUnits,
    currency: p.currency,
    description: `Arrears ${p.kind}: ${p.reason}`,
    transactionDate: toIso(p.approvedAt ?? p.proposedAt),
    postedAt: toIso(p.approvedAt ?? p.proposedAt),
    relatedEntryId: p.relatedEntryId ?? null,
  };
}
