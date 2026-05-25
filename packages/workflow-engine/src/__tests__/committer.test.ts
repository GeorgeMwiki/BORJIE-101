/**
 * Committer tests — register + apply + missing-applier + throw-handling.
 */

import { describe, expect, it } from 'vitest';
import {
  createCommitter,
  createRecordingApplier,
  type ChangeApplier,
  type ProposedChange,
  type WorkflowDefinition,
  type WorkflowRun,
} from '../index.js';

const FAKE_DEF: WorkflowDefinition = Object.freeze({
  id: 'parcel_edit_v1',
  kind: 'parcel_edit',
  version: 1,
  name: 'x',
  description: '',
  requiredCapability: 'metadata_edit',
  aiReviewRequired: true,
  humanApprovalRequired: true,
  autoCommitOnApproval: true,
  elasticPolicyKey: null,
});

const FAKE_RUN: WorkflowRun = Object.freeze({
  id: 'run-1',
  tenantId: 't1',
  definitionId: 'parcel_edit_v1',
  kind: 'parcel_edit',
  scope: 'parcel',
  scopeRef: 'p1',
  initiatedByUserId: 'worker',
  assignedReviewerUserId: null,
  assignedApproverUserId: null,
  state: 'in_approval',
  input: {},
  proposedChange: null,
  reviewDecision: null,
  approvalDecision: null,
  rejectionReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  committedAt: null,
});

const FAKE_PROPOSED: ProposedChange = Object.freeze({
  id: 'pc-1',
  runId: 'run-1',
  targetEntity: 'parcel:p1',
  fieldDiffs: [],
  snapshot: null,
  capturedAt: new Date(),
});

describe('committer', () => {
  it('applies via the registered applier', async () => {
    const { applier, calls } = createRecordingApplier('parcel_edit');
    const committer = createCommitter([applier]);
    const r = await committer.applyProposedChange({
      run: FAKE_RUN,
      definition: FAKE_DEF,
      proposedChange: FAKE_PROPOSED,
    });
    expect(r.success).toBe(true);
    expect(calls).toEqual([{ runId: 'run-1', proposedChangeId: 'pc-1' }]);
  });

  it('returns failure when no applier is registered', async () => {
    const committer = createCommitter([]);
    const r = await committer.applyProposedChange({
      run: FAKE_RUN,
      definition: FAKE_DEF,
      proposedChange: FAKE_PROPOSED,
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('no_applier_registered_for_kind');
  });

  it('captures applier throws as failure outcomes', async () => {
    const throwing: ChangeApplier = {
      kind: 'parcel_edit',
      async apply() {
        throw new Error('disk full');
      },
    };
    const committer = createCommitter([throwing]);
    const r = await committer.applyProposedChange({
      run: FAKE_RUN,
      definition: FAKE_DEF,
      proposedChange: FAKE_PROPOSED,
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('disk full');
  });
});
