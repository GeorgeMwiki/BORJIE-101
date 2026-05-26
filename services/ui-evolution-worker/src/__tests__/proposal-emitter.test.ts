import { describe, expect, it, vi } from 'vitest';
import { emitProposal, createLogNotificationSink } from '../approval/proposal-emitter.js';
import type { ProposedDiff, EvolutionProposal } from '../types.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';

describe('emitProposal', () => {
  it('inserts pending proposal and notifies the sink', async () => {
    const insertSpy = vi.fn(async (args: {
      tenantId: string;
      tabRecipeId: string;
      currentVersion: number;
      proposedVersion: number;
      diff: ProposedDiff;
      signals: ReadonlyArray<unknown>;
      citations: ReadonlyArray<string>;
    }) => {
      const stored: EvolutionProposal = {
        id: 'p-1',
        tenantId: args.tenantId,
        tabRecipeId: args.tabRecipeId,
        currentVersion: args.currentVersion,
        proposedVersion: args.proposedVersion,
        proposedSchemaDiff: args.diff,
        signals: [],
        citations: args.citations,
        status: 'pending',
        proposedAtIso: '2026-05-10T02:00:00.000Z',
      };
      return stored;
    });

    const repo: ProposalRepository = {
      insertPending: insertSpy as ProposalRepository['insertPending'],
      hasPendingProposalFor: async () => false,
      findById: async () => null,
      updateStatus: async () => undefined,
    };

    const sinkCalls: Array<{ proposalId: string }> = [];
    const sink = {
      async emit(event: { proposalId: string }) {
        sinkCalls.push({ proposalId: event.proposalId });
      },
    };

    const out = await emitProposal({
      tenantId: 't1',
      tabRecipeId: 'r',
      currentVersion: 1,
      diff: {
        ops: [],
        rationaleEn: 'hello world',
        rationaleSw: 'habari ya ulimwengu',
      },
      signals: [],
      citations: ['CITE-1'],
      repository: repo,
      sink,
    });
    expect(out.proposedVersion).toBe(2);
    expect(out.tabRecipeId).toBe('r');
    expect(sinkCalls).toEqual([{ proposalId: 'p-1' }]);
    expect(insertSpy).toHaveBeenCalledOnce();
  });

  it('createLogNotificationSink wires to a logger', async () => {
    const lines: Array<{ line: string; data?: Record<string, unknown> }> = [];
    const sink = createLogNotificationSink((line, data) =>
      lines.push({ line, ...(data !== undefined ? { data } : {}) }),
    );
    await sink.emit({
      kind: 'ui-evolution.proposal.created',
      tenantId: 't1',
      proposalId: 'p-1',
      tabRecipeId: 'r',
      currentVersion: 1,
      proposedVersion: 2,
      signalsCount: 3,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.line).toBe('ui-evolution.proposal.created');
  });
});
