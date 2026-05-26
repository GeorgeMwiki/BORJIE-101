/**
 * Proposal emitter — writes a pending proposal and surfaces a
 * notification event for the owner review queue.
 *
 * This is the worker's "owner ping" — every time we emit a proposal
 * we also drop an audit-hash-chain entry so the owner can later prove
 * "yes, my UI changed because Mr. Mwikila proposed it on this date,
 * and I personally approved it on this date."
 *
 * The notification publication is purposefully decoupled — we take a
 * `NotificationSink` port so the worker can be wired against in-app
 * push, email, WhatsApp, or whatever the platform decides. Tests pass
 * a vi-spy.
 */

import type {
  EvolutionProposal,
  FailingSignal,
  ProposedDiff,
} from '../types.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface NotificationSink {
  emit(args: {
    readonly kind: 'ui-evolution.proposal.created';
    readonly tenantId: string;
    readonly proposalId: string;
    readonly tabRecipeId: string;
    readonly currentVersion: number;
    readonly proposedVersion: number;
    readonly signalsCount: number;
  }): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EmitProposalArgs {
  readonly tenantId: string;
  readonly tabRecipeId: string;
  readonly currentVersion: number;
  readonly diff: ProposedDiff;
  readonly signals: ReadonlyArray<FailingSignal>;
  readonly citations: ReadonlyArray<string>;
  readonly repository: ProposalRepository;
  readonly sink: NotificationSink;
}

/**
 * Persist the proposal and notify. The proposed_version is computed
 * here as current_version + 1 (spec §4: "Promote to live (version
 * bump)" — the new version is monotonically next).
 */
export async function emitProposal(
  args: EmitProposalArgs,
): Promise<EvolutionProposal> {
  const proposed = await args.repository.insertPending({
    tenantId: args.tenantId,
    tabRecipeId: args.tabRecipeId,
    currentVersion: args.currentVersion,
    proposedVersion: args.currentVersion + 1,
    diff: args.diff,
    signals: args.signals,
    citations: args.citations,
  });
  await args.sink.emit({
    kind: 'ui-evolution.proposal.created',
    tenantId: proposed.tenantId,
    proposalId: proposed.id,
    tabRecipeId: proposed.tabRecipeId,
    currentVersion: proposed.currentVersion,
    proposedVersion: proposed.proposedVersion,
    signalsCount: proposed.signals.length,
  });
  return proposed;
}

// ---------------------------------------------------------------------------
// Convenience — a log-backed sink for development and tests.
// ---------------------------------------------------------------------------

export function createLogNotificationSink(
  log: (line: string, data?: Record<string, unknown>) => void,
): NotificationSink {
  return {
    emit(event) {
      log('ui-evolution.proposal.created', {
        tenantId: event.tenantId,
        proposalId: event.proposalId,
        tabRecipeId: event.tabRecipeId,
        proposedVersion: event.proposedVersion,
        signalsCount: event.signalsCount,
      });
    },
  };
}
