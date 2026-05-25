/**
 * Arrears service
 *
 * Responsibilities:
 *   - openCase()          : create a new arrears case
 *   - proposeAdjustment() : append a PROPOSAL (not a ledger mutation)
 *   - approveProposal()   : upon approval, create a NEW ledger entry
 *                           referencing relatedEntryId (immutable ledger)
 *
 * All functions return NEW objects — no in-place mutation.
 */
import { randomUUID } from 'crypto';
import {
  type ArrearsLineProposal,
  type ArrearsProposalKind,
  type ArrearsProposalStatus,
} from './arrears-case';

export interface LedgerAdjustmentEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly invoiceId: string | null;
  readonly entryType: 'adjustment' | 'waiver' | 'writeoff' | 'late_fee';
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly description: string;
  readonly relatedEntryId: string | null;
  readonly postedAt: string;
  readonly postedBy: string;
}

export interface ArrearsRepository {
  saveProposal(proposal: ArrearsLineProposal): Promise<void>;
  getProposal(
    tenantId: string,
    proposalId: string
  ): Promise<ArrearsLineProposal | null>;
  updateProposalOnApproval(
    tenantId: string,
    proposalId: string,
    approval: {
      approvedBy: string;
      approvedAt: string;
      approvalNotes?: string;
      relatedEntryId: string;
    }
  ): Promise<void>;
  updateProposalOnRejection(
    tenantId: string,
    proposalId: string,
    rejection: {
      rejectedBy: string;
      rejectedAt: string;
      rejectionReason: string;
    }
  ): Promise<void>;
  createCase(args: {
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
  }): Promise<{ id: string; caseNumber: string }>;
}

export interface LedgerPort {
  /** Append an adjustment entry. Caller must have computed relatedEntryId. */
  appendAdjustment(entry: LedgerAdjustmentEntry): Promise<void>;
}

export interface OpenCaseInput {
  readonly tenantId: string;
  readonly customerId: string;
  readonly currency: string;
  readonly totalArrearsAmount: number;
  readonly daysOverdue: number;
  readonly overdueInvoiceCount: number;
  readonly oldestInvoiceDate: Date;
  readonly leaseId?: string;
  readonly propertyId?: string;
  readonly unitId?: string;
  readonly createdBy: string;
  readonly notes?: string;
}

export interface ProposeAdjustmentInput {
  readonly tenantId: string;
  readonly customerId: string;
  readonly arrearsCaseId: string;
  readonly invoiceId?: string;
  readonly kind: ArrearsProposalKind;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly reason: string;
  readonly evidenceDocIds?: readonly string[];
  readonly proposedBy: string;
  readonly balanceBeforeMinorUnits?: number;
}

export interface ApproveProposalInput {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly approvedBy: string;
  readonly approvalNotes?: string;
  /** Optional override for the posted-at time. Defaults to now. */
  readonly postedAt?: Date;
}

export interface RejectProposalInput {
  readonly tenantId: string;
  readonly proposalId: string;
  readonly rejectedBy: string;
  readonly rejectionReason: string;
}

export class ArrearsProposalError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'TENANT_MISMATCH'
      | 'INVALID_STATE'
      | 'VALIDATION'
  ) {
    super(message);
    this.name = 'ArrearsProposalError';
  }
}

function kindToLedgerType(
  kind: ArrearsProposalKind
): LedgerAdjustmentEntry['entryType'] {
  switch (kind) {
    case 'waiver':
      return 'waiver';
    case 'writeoff':
      return 'writeoff';
    case 'late_fee':
      return 'late_fee';
    case 'adjustment':
    case 'correction':
    default:
      return 'adjustment';
  }
}

/**
 * The signed amount to apply to the ledger.
 *   - waiver / writeoff reduce balance   → negative
 *   - late_fee increases balance         → positive
 *   - adjustment / correction use the sign of the input as-is
 */
function signedLedgerAmount(
  kind: ArrearsProposalKind,
  amount: number
): number {
  switch (kind) {
    case 'waiver':
    case 'writeoff':
      return -Math.abs(amount);
    case 'late_fee':
      return Math.abs(amount);
    case 'adjustment':
    case 'correction':
      return amount;
  }
}

export interface ArrearsService {
  openCase(input: OpenCaseInput): Promise<{ id: string; caseNumber: string }>;
  proposeAdjustment(
    input: ProposeAdjustmentInput
  ): Promise<ArrearsLineProposal>;
  approveProposal(
    input: ApproveProposalInput
  ): Promise<{ proposal: ArrearsLineProposal; entry: LedgerAdjustmentEntry }>;
  rejectProposal(input: RejectProposalInput): Promise<ArrearsLineProposal>;
}

export interface ArrearsServiceDeps {
  readonly repo: ArrearsRepository;
  readonly ledger: LedgerPort;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  readonly caseNumberGenerator?: (tenantId: string) => Promise<string>;
}

export function createArrearsService(
  deps: ArrearsServiceDeps
): ArrearsService {
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => randomUUID());
  const genCaseNumber =
    deps.caseNumberGenerator ??
    (async () => `ARR-${Date.now().toString(36).toUpperCase()}`);

  return {
    async openCase(input) {
      if (input.totalArrearsAmount < 0) {
        throw new ArrearsProposalError(
          'totalArrearsAmount cannot be negative',
          'VALIDATION'
        );
      }
      const caseNumber = await genCaseNumber(input.tenantId);
      return deps.repo.createCase({
        tenantId: input.tenantId,
        customerId: input.customerId,
        leaseId: input.leaseId,
        propertyId: input.propertyId,
        unitId: input.unitId,
        caseNumber,
        totalArrearsAmount: input.totalArrearsAmount,
        currency: input.currency,
        daysOverdue: input.daysOverdue,
        overdueInvoiceCount: input.overdueInvoiceCount,
        oldestInvoiceDate: input.oldestInvoiceDate,
        createdBy: input.createdBy,
        notes: input.notes,
      });
    },

    async proposeAdjustment(input) {
      if (input.amountMinorUnits === 0) {
        throw new ArrearsProposalError(
          'amount must be non-zero',
          'VALIDATION'
        );
      }
      if (!input.reason || input.reason.trim().length === 0) {
        throw new ArrearsProposalError('reason required', 'VALIDATION');
      }

      const signed = signedLedgerAmount(input.kind, input.amountMinorUnits);
      const proposal: ArrearsLineProposal = {
        id: genId(),
        tenantId: input.tenantId,
        customerId: input.customerId,
        arrearsCaseId: input.arrearsCaseId,
        invoiceId: input.invoiceId ?? null,
        kind: input.kind,
        amountMinorUnits: signed,
        currency: input.currency,
        reason: input.reason,
        evidenceDocIds: input.evidenceDocIds ?? [],
        status: 'pending',
        proposedBy: input.proposedBy,
        proposedAt: now().toISOString(),
        approvedBy: null,
        approvedAt: null,
        approvalNotes: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        relatedEntryId: null,
        balanceBeforeMinorUnits: input.balanceBeforeMinorUnits ?? null,
        projectedBalanceAfterMinorUnits:
          input.balanceBeforeMinorUnits !== undefined
            ? input.balanceBeforeMinorUnits + signed
            : null,
        createdAt: now().toISOString(),
      };

      await deps.repo.saveProposal(proposal);
      return proposal;
    },

    async approveProposal(input) {
      const proposal = await deps.repo.getProposal(
        input.tenantId,
        input.proposalId
      );
      if (!proposal) {
        throw new ArrearsProposalError('proposal not found', 'NOT_FOUND');
      }
      if (proposal.tenantId !== input.tenantId) {
        throw new ArrearsProposalError(
          'tenant mismatch',
          'TENANT_MISMATCH'
        );
      }
      if (proposal.status !== 'pending') {
        throw new ArrearsProposalError(
          `cannot approve proposal in status ${proposal.status}`,
          'INVALID_STATE'
        );
      }

      // Build the NEW ledger entry. The ledger itself is immutable —
      // we append a fresh entry that references the proposal's
      // relatedEntryId target (if one was supplied) but most commonly
      // this is a brand-new adjustment line with no prior entry to
      // correct. If the proposal was correcting a specific prior
      // ledger entry, that id should have been populated on the
      // proposal record by the caller before approval.
      const postedAt = (input.postedAt ?? now()).toISOString();
      const entry: LedgerAdjustmentEntry = {
        id: genId(),
        tenantId: proposal.tenantId,
        customerId: proposal.customerId,
        invoiceId: proposal.invoiceId,
        entryType: kindToLedgerType(proposal.kind),
        amountMinorUnits: proposal.amountMinorUnits,
        currency: proposal.currency,
        description: `Arrears ${proposal.kind}: ${proposal.reason}`,
        relatedEntryId: proposal.relatedEntryId,
        postedAt,
        postedBy: input.approvedBy,
      };

      await deps.ledger.appendAdjustment(entry);

      await deps.repo.updateProposalOnApproval(
        input.tenantId,
        input.proposalId,
        {
          approvedBy: input.approvedBy,
          approvedAt: postedAt,
          approvalNotes: input.approvalNotes,
          relatedEntryId: entry.id,
        }
      );

      const approved: ArrearsLineProposal = {
        ...proposal,
        status: 'approved',
        approvedBy: input.approvedBy,
        approvedAt: postedAt,
        approvalNotes: input.approvalNotes ?? null,
        relatedEntryId: entry.id,
      };

      return { proposal: approved, entry };
    },

    async rejectProposal(input) {
      const proposal = await deps.repo.getProposal(
        input.tenantId,
        input.proposalId
      );
      if (!proposal) {
        throw new ArrearsProposalError('proposal not found', 'NOT_FOUND');
      }
      if (proposal.tenantId !== input.tenantId) {
        throw new ArrearsProposalError(
          'tenant mismatch',
          'TENANT_MISMATCH'
        );
      }
      if (proposal.status !== 'pending') {
        throw new ArrearsProposalError(
          `cannot reject proposal in status ${proposal.status}`,
          'INVALID_STATE'
        );
      }
      const rejectedAt = now().toISOString();

      await deps.repo.updateProposalOnRejection(
        input.tenantId,
        input.proposalId,
        {
          rejectedBy: input.rejectedBy,
          rejectedAt,
          rejectionReason: input.rejectionReason,
        }
      );

      const rejected: ArrearsLineProposal = {
        ...proposal,
        status: 'rejected' as ArrearsProposalStatus,
        rejectedBy: input.rejectedBy,
        rejectedAt,
        rejectionReason: input.rejectionReason,
      };
      return rejected;
    },
  };
}
