/**
 * proposal-emitter.test — happy path + sink-failure tolerance.
 */

import { describe, it, expect } from 'vitest';
import {
  emitProposal,
  type NotificationSink,
  type ProposalNotification,
} from '../approval/proposal-emitter.js';
import type {
  DocEvolutionProposalRow,
  ProposalStatus,
  ProposedDiff,
} from '../types.js';
import type {
  InsertProposalArgs,
  ProposalRepository,
} from '../storage/proposal-repository.js';

function makeRepo(): {
  repo: ProposalRepository;
  inserted: InsertProposalArgs[];
} {
  const inserted: InsertProposalArgs[] = [];
  const repo: ProposalRepository = {
    async insertPending(args) {
      inserted.push(args);
      const row: DocEvolutionProposalRow = {
        id: `prop-${inserted.length}`,
        tenant_id: args.tenant_id,
        recipe_id: args.recipe_id,
        current_version: args.current_version,
        proposed_version: args.proposed_version,
        proposed_diff: args.proposed_diff,
        signals: args.signals,
        citations: args.citations,
        status: 'pending' as ProposalStatus,
        proposed_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
        reviewer_reason: null,
        approval_audit_hash: null,
      };
      return row;
    },
    async listPendingForRecipe() {
      return [];
    },
    async markReviewed() {
      /* not used */
    },
    async findById() {
      return null;
    },
  };
  return { repo, inserted };
}

const sampleDiff: ProposedDiff = {
  recipe_id: 'r1',
  current_version: 1,
  proposed_version: 2,
  summary: 'Improve assays.',
  edits: [
    {
      kind: 'rewrite',
      section_path: 'section.assays',
      rationale: 'r',
      proposed_text: 'Au in ppm.',
    },
  ],
};

describe('emitProposal', () => {
  it('writes a pending row, notifies, and emits an audit entry', async () => {
    const { repo, inserted } = makeRepo();
    const notifications: ProposalNotification[] = [];
    const sink: NotificationSink = {
      emit(n) {
        notifications.push(n);
      },
    };
    const out = await emitProposal(
      { proposals: repo, sink },
      {
        tenant_id: 't1',
        recipe_id: 'r1',
        diff: sampleDiff,
        signals: { reason: 'low_acceptance' },
        citations: ['statute:s5'],
      },
    );
    expect(inserted.length).toBe(1);
    expect(out.proposal.recipe_id).toBe('r1');
    expect(out.auditChain.length).toBe(1);
    expect(notifications.length).toBe(1);
    expect(notifications[0]!.summary).toBe(sampleDiff.summary);
    expect(notifications[0]!.proposal_id).toBe(out.proposal.id);
  });

  it('tolerates a failing sink and still writes the row', async () => {
    const { repo } = makeRepo();
    const sink: NotificationSink = {
      emit() {
        throw new Error('sink down');
      },
    };
    const out = await emitProposal(
      { proposals: repo, sink },
      {
        tenant_id: 't1',
        recipe_id: 'r1',
        diff: sampleDiff,
        signals: {},
        citations: [],
      },
    );
    expect(out.proposal.recipe_id).toBe('r1');
    expect(out.auditChain.length).toBe(1);
  });

  it('propagates audit secret-id/value when provided', async () => {
    const { repo } = makeRepo();
    const sink: NotificationSink = { emit() {} };
    const out = await emitProposal(
      {
        proposals: repo,
        sink,
        auditSecretId: 'k1',
        auditSecretValue: 'shh',
      },
      {
        tenant_id: 't1',
        recipe_id: 'r1',
        diff: sampleDiff,
        signals: {},
        citations: [],
      },
    );
    expect(out.auditChain[0]?.secretId).toBe('k1');
  });
});
