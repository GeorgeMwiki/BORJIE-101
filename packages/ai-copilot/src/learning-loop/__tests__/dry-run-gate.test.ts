/**
 * Tests for learning-loop/dry-run-gate.
 *
 * Coverage: in-memory repo behaviour, in-memory inbox capture, status
 * lifecycle (draft → dry_run_pending → awaiting_human_review), simulator
 * fallback on error, no-simulator fallback to evidence-based projection,
 * diff computation, warnings for low confidence and small samples,
 * proposal-not-found error.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createInMemoryProposalRepository,
  createInMemoryHeadInbox,
  runProposalThroughSimulator,
  type DryRunGateDeps,
  type PolicySimulatorPort,
} from '../dry-run-gate.js';
import type { PatternEvidence, PolicyProposal } from '../types.js';
import type { AutonomyPolicy } from '../../autonomy/types.js';
import { buildDefaultPolicy } from '../../autonomy/defaults.js';

function patternEvidence(overrides: Partial<PatternEvidence> = {}): PatternEvidence {
  return {
    id: 'pat_1',
    domain: 'finance',
    actionType: 'auto_approve_refund',
    contextFeature: 'vendorIsTrusted',
    contextValue: 'true',
    sampleSize: 50,
    successRate: 0.92,
    baselineSuccessRate: 0.7,
    chiSquared: 8,
    significant: true,
    discoveredAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildProposal(overrides: Partial<PolicyProposal> = {}): PolicyProposal {
  return {
    id: 'prop-1',
    tenantId: 'tenant-1',
    proposedPatch: {
      finance: {
        autoSendReminders: true,
        reminderDayOffsets: [5, 10, 20],
        autoApproveRefundsMinorUnits: 60_000_00,
        autoApproveWaiversMinorUnits: 25_000_00,
        escalateArrearsAboveMinorUnits: 500_000_00,
      },
    },
    evidence: [patternEvidence()],
    estimatedImpact: 'unlock 50 refunds/window',
    reasoning: 'lift dominates baseline',
    confidence: 0.85,
    status: 'draft',
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<DryRunGateDeps> = {},
): DryRunGateDeps & {
  proposals: ReturnType<typeof createInMemoryProposalRepository>;
  headInbox: ReturnType<typeof createInMemoryHeadInbox>;
} {
  const proposals = createInMemoryProposalRepository();
  const headInbox = createInMemoryHeadInbox();
  return {
    proposals,
    headInbox,
    outcomes: {
      async insert(o) {
        return o;
      },
      async updateStatus() {
        return null;
      },
      async findByTenant() {
        return [];
      },
      async findByActionId() {
        return null;
      },
    },
    currentPolicyProvider: async () => buildDefaultPolicy('tenant-1'),
    ...overrides,
  };
}

describe('createInMemoryProposalRepository', () => {
  it('inserts and recalls a proposal', async () => {
    const repo = createInMemoryProposalRepository();
    const proposal = buildProposal();
    await repo.insert(proposal);
    // nosemgrep: missing-tenant-id-arg reason: test of repo's by-globally-unique-id lookup.
    const fetched = await repo.findById(proposal.id);
    expect(fetched).toEqual(proposal);
  });

  it('updates status without mutating prior row', async () => {
    const repo = createInMemoryProposalRepository();
    const proposal = buildProposal();
    await repo.insert(proposal);
    const updated = await repo.updateStatus(proposal.id, 'approved');
    expect(updated?.status).toBe('approved');
    expect(proposal.status).toBe('draft'); // original unchanged
  });

  it('returns null when updating a missing proposal', async () => {
    const repo = createInMemoryProposalRepository();
    const updated = await repo.updateStatus('nope', 'approved');
    expect(updated).toBeNull();
  });

  it('lists pending proposals filtered to in-flight statuses', async () => {
    const repo = createInMemoryProposalRepository();
    await repo.insert(buildProposal({ id: 'a', status: 'draft' }));
    await repo.insert(buildProposal({ id: 'b', status: 'rolled_out' }));
    await repo.insert(
      buildProposal({ id: 'c', status: 'awaiting_human_review' }),
    );
    const pending = await repo.findPending('tenant-1');
    expect(pending.map((p) => p.id).sort()).toEqual(['a', 'c']);
  });
});

describe('createInMemoryHeadInbox', () => {
  it('captures every posted message', async () => {
    const inbox = createInMemoryHeadInbox();
    await inbox.post({
      tenantId: 't1',
      subject: 's',
      body: 'b',
      proposalId: 'p1',
    });
    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0]).toEqual({
      tenantId: 't1',
      subject: 's',
      body: 'b',
      proposalId: 'p1',
    });
  });
});

describe('runProposalThroughSimulator', () => {
  it('throws when proposal is not found by id', async () => {
    const deps = makeDeps();
    await expect(runProposalThroughSimulator('missing-id', deps)).rejects.toThrow(
      /proposal not found/,
    );
  });

  it('flips proposal through draft → dry_run_pending → awaiting_human_review', async () => {
    const deps = makeDeps();
    const proposal = buildProposal();
    await deps.proposals.insert(proposal);
    await runProposalThroughSimulator(proposal, deps);
    // nosemgrep: missing-tenant-id-arg reason: test of repo's by-globally-unique-id lookup (post-simulator verification).
    const final = await deps.proposals.findById(proposal.id);
    expect(final?.status).toBe('awaiting_human_review');
  });

  it('uses evidence-based projection when no simulator is supplied', async () => {
    const deps = makeDeps();
    const proposal = buildProposal();
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    expect(report.simulatedOutcomes.projectedSuccessRate).toBeCloseTo(0.92);
    expect(report.simulatedOutcomes.projectedVolume).toBe(50);
  });

  it('falls back to evidence-based projection when simulator throws', async () => {
    const simulator: PolicySimulatorPort = {
      async project() {
        throw new Error('upstream down');
      },
    };
    const deps = makeDeps({ simulator });
    const proposal = buildProposal();
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    expect(report.simulatedOutcomes.projectedVolume).toBe(50);
    expect(report.simulatedOutcomes.estimatedImpact).toMatch(/Simulator error/);
  });

  it('uses simulator output when available', async () => {
    const simulator: PolicySimulatorPort = {
      async project() {
        return {
          projectedSuccessRate: 0.99,
          projectedVolume: 200,
          notes: 'simulated',
        };
      },
    };
    const deps = makeDeps({ simulator });
    const proposal = buildProposal();
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    expect(report.simulatedOutcomes.projectedSuccessRate).toBeCloseTo(0.99);
    expect(report.simulatedOutcomes.projectedVolume).toBe(200);
  });

  it('emits a warning for low confidence', async () => {
    const deps = makeDeps();
    const proposal = buildProposal({ confidence: 0.5 });
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    expect(report.warnings.some((w) => /confidence/.test(w))).toBe(true);
  });

  it('emits a warning for evidence with sampleSize < 10', async () => {
    const deps = makeDeps();
    const proposal = buildProposal({
      evidence: [patternEvidence({ sampleSize: 4 })],
    });
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    expect(report.warnings.some((w) => /samples/.test(w))).toBe(true);
  });

  it('builds a diff for nested policy fields', async () => {
    const deps = makeDeps();
    const proposal = buildProposal();
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    // current policy default: 50_000_00; proposed: 60_000_00
    expect(report.diff['finance.autoApproveRefundsMinorUnits']).toEqual({
      before: 50_000_00,
      after: 60_000_00,
    });
  });

  it('posts a head-inbox message with the proposal id and reasoning', async () => {
    const deps = makeDeps();
    const proposal = buildProposal();
    await deps.proposals.insert(proposal);
    await runProposalThroughSimulator(proposal, deps);
    expect(deps.headInbox.messages).toHaveLength(1);
    expect(deps.headInbox.messages[0].proposalId).toBe(proposal.id);
    expect(deps.headInbox.messages[0].body).toContain(proposal.reasoning);
  });

  it('uses the supplied clock for generatedAt', async () => {
    const fixed = new Date('2026-05-01T01:02:03.000Z');
    const deps = makeDeps({ now: () => fixed });
    const proposal = buildProposal();
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    expect(report.generatedAt).toBe(fixed.toISOString());
  });

  it('returns zeros when projection has no evidence to fold over', async () => {
    const deps = makeDeps();
    const proposal = buildProposal({ evidence: [] });
    await deps.proposals.insert(proposal);
    const report = await runProposalThroughSimulator(proposal, deps);
    expect(report.simulatedOutcomes.projectedSuccessRate).toBe(0);
    expect(report.simulatedOutcomes.projectedVolume).toBe(0);
  });
});
