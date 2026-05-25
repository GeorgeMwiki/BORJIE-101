import { describe, it, expect, beforeEach } from 'vitest';
import {
  createArrearsService,
  ArrearsProposalError,
  type ArrearsRepository,
  type LedgerPort,
  type LedgerAdjustmentEntry,
} from '../arrears';
import type { ArrearsLineProposal } from '../arrears/arrears-case';

function makeMocks() {
  const proposals = new Map<string, ArrearsLineProposal>();
  const appendedEntries: LedgerAdjustmentEntry[] = [];

  const repo: ArrearsRepository = {
    async saveProposal(p) {
      // Immutable-ish: store a fresh copy
      proposals.set(p.id, { ...p });
    },
    async getProposal(tenantId, id) {
      const p = proposals.get(id);
      if (!p) return null;
      if (p.tenantId !== tenantId) return null;
      return p;
    },
    async updateProposalOnApproval(tenantId, id, approval) {
      const p = proposals.get(id);
      if (!p) return;
      proposals.set(id, {
        ...p,
        status: 'approved',
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        approvalNotes: approval.approvalNotes ?? null,
        relatedEntryId: approval.relatedEntryId,
      });
    },
    async updateProposalOnRejection(tenantId, id, rejection) {
      const p = proposals.get(id);
      if (!p) return;
      proposals.set(id, {
        ...p,
        status: 'rejected',
        rejectedBy: rejection.rejectedBy,
        rejectedAt: rejection.rejectedAt,
        rejectionReason: rejection.rejectionReason,
      });
    },
    async createCase(args) {
      return { id: `case-${args.caseNumber}`, caseNumber: args.caseNumber };
    },
  };

  const ledger: LedgerPort = {
    async appendAdjustment(entry) {
      appendedEntries.push({ ...entry });
    },
  };

  return { repo, ledger, proposals, appendedEntries };
}

describe('ArrearsService', () => {
  let mocks: ReturnType<typeof makeMocks>;
  let service: ReturnType<typeof createArrearsService>;

  beforeEach(() => {
    mocks = makeMocks();
    let counter = 0;
    service = createArrearsService({
      repo: mocks.repo,
      ledger: mocks.ledger,
      now: () => new Date('2026-01-15T10:00:00Z'),
      idGenerator: () => `id-${++counter}`,
      caseNumberGenerator: async () => 'ARR-TEST',
    });
  });

  describe('openCase', () => {
    it('creates a case with generated number', async () => {
      const result = await service.openCase({
        tenantId: 't1',
        customerId: 'c1',
        currency: 'TZS',
        totalArrearsAmount: 100_000,
        daysOverdue: 45,
        overdueInvoiceCount: 2,
        oldestInvoiceDate: new Date('2025-12-01'),
        createdBy: 'u1',
      });
      expect(result.caseNumber).toBe('ARR-TEST');
    });

    it('rejects negative arrears amount', async () => {
      await expect(
        service.openCase({
          tenantId: 't1',
          customerId: 'c1',
          currency: 'TZS',
          totalArrearsAmount: -1,
          daysOverdue: 0,
          overdueInvoiceCount: 0,
          oldestInvoiceDate: new Date(),
          createdBy: 'u',
        })
      ).rejects.toThrow(ArrearsProposalError);
    });
  });

  describe('proposeAdjustment', () => {
    it('creates a pending proposal (never mutates ledger)', async () => {
      const proposal = await service.proposeAdjustment({
        tenantId: 't1',
        customerId: 'c1',
        arrearsCaseId: 'case-1',
        kind: 'waiver',
        amountMinorUnits: 5000,
        currency: 'TZS',
        reason: 'Hardship',
        proposedBy: 'u1',
      });
      expect(proposal.status).toBe('pending');
      expect(proposal.amountMinorUnits).toBe(-5000); // waiver flips sign
      expect(proposal.relatedEntryId).toBeNull();
      expect(mocks.appendedEntries).toHaveLength(0);
    });

    it('rejects zero amount', async () => {
      await expect(
        service.proposeAdjustment({
          tenantId: 't1',
          customerId: 'c1',
          arrearsCaseId: 'case-1',
          kind: 'adjustment',
          amountMinorUnits: 0,
          currency: 'TZS',
          reason: 'x',
          proposedBy: 'u',
        })
      ).rejects.toThrow(/non-zero/);
    });

    it('rejects empty reason', async () => {
      await expect(
        service.proposeAdjustment({
          tenantId: 't1',
          customerId: 'c1',
          arrearsCaseId: 'case-1',
          kind: 'waiver',
          amountMinorUnits: 100,
          currency: 'TZS',
          reason: '   ',
          proposedBy: 'u',
        })
      ).rejects.toThrow(/reason/);
    });
  });

  describe('approveProposal', () => {
    it('appends a NEW ledger entry — never mutates existing entries', async () => {
      const p = await service.proposeAdjustment({
        tenantId: 't1',
        customerId: 'c1',
        arrearsCaseId: 'case-1',
        kind: 'waiver',
        amountMinorUnits: 10_000,
        currency: 'TZS',
        reason: 'relief',
        proposedBy: 'u1',
      });

      const result = await service.approveProposal({
        tenantId: 't1',
        proposalId: p.id,
        approvedBy: 'approver',
      });

      expect(result.proposal.status).toBe('approved');
      expect(result.entry.entryType).toBe('waiver');
      expect(result.entry.amountMinorUnits).toBe(-10_000);
      expect(mocks.appendedEntries).toHaveLength(1);
      expect(mocks.appendedEntries[0].id).toBe(result.entry.id);
      // Ledger entry object must not reference the proposal id as its
      // own id (new entry, not mutation)
      expect(result.entry.id).not.toBe(p.id);
    });

    it('rejects cross-tenant approval', async () => {
      const p = await service.proposeAdjustment({
        tenantId: 't1',
        customerId: 'c1',
        arrearsCaseId: 'case-1',
        kind: 'waiver',
        amountMinorUnits: 1,
        currency: 'TZS',
        reason: 'x',
        proposedBy: 'u',
      });
      await expect(
        service.approveProposal({
          tenantId: 't2',
          proposalId: p.id,
          approvedBy: 'u',
        })
      ).rejects.toThrow(/not found/);
    });

    it('rejects approval of non-pending proposal', async () => {
      const p = await service.proposeAdjustment({
        tenantId: 't1',
        customerId: 'c1',
        arrearsCaseId: 'case-1',
        kind: 'waiver',
        amountMinorUnits: 1,
        currency: 'TZS',
        reason: 'x',
        proposedBy: 'u',
      });
      await service.approveProposal({
        tenantId: 't1',
        proposalId: p.id,
        approvedBy: 'u',
      });
      await expect(
        service.approveProposal({
          tenantId: 't1',
          proposalId: p.id,
          approvedBy: 'u',
        })
      ).rejects.toThrow(/INVALID_STATE|status approved/);
    });
  });

  describe('rejectProposal', () => {
    it('transitions pending -> rejected without touching ledger', async () => {
      const p = await service.proposeAdjustment({
        tenantId: 't1',
        customerId: 'c1',
        arrearsCaseId: 'case-1',
        kind: 'waiver',
        amountMinorUnits: 100,
        currency: 'TZS',
        reason: 'x',
        proposedBy: 'u',
      });
      const rejected = await service.rejectProposal({
        tenantId: 't1',
        proposalId: p.id,
        rejectedBy: 'reviewer',
        rejectionReason: 'Insufficient evidence',
      });
      expect(rejected.status).toBe('rejected');
      expect(mocks.appendedEntries).toHaveLength(0);
    });
  });
});
