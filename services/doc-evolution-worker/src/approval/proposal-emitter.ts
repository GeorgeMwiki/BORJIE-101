/**
 * proposal-emitter — writes a pending proposal row and dispatches a
 * notification so the owner sees the diff in the unified approval queue.
 *
 * Spec §4 Layer 4: "These signals drive lock/improve decisions and
 * generate improvement proposals under the same human-in-the-loop
 * pattern as the Anticipatory UX layer".
 */

import type {
  DocEvolutionProposalRow,
  ProposedDiff,
} from '../types.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';
import { emitAuditEntry } from '../audit/audit-emit.js';
import type { ChainEntry } from '@borjie/audit-hash-chain';

export interface ProposalNotification {
  readonly kind: 'doc_evolution_proposal_pending';
  readonly tenant_id: string;
  readonly proposal_id: string;
  readonly recipe_id: string;
  readonly current_version: number;
  readonly proposed_version: number;
  readonly summary: string;
}

export interface NotificationSink {
  emit(notification: ProposalNotification): Promise<void> | void;
}

export interface ProposalEmitterDeps {
  readonly proposals: ProposalRepository;
  readonly sink: NotificationSink;
  readonly auditChain?: ReadonlyArray<ChainEntry>;
  readonly auditSecretId?: string;
  readonly auditSecretValue?: string;
}

export interface EmitProposalInput {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly diff: ProposedDiff;
  readonly signals: Readonly<Record<string, unknown>>;
  readonly citations: ReadonlyArray<string>;
}

export interface EmitProposalResult {
  readonly proposal: DocEvolutionProposalRow;
  readonly auditChain: ReadonlyArray<ChainEntry>;
}

export async function emitProposal(
  deps: ProposalEmitterDeps,
  input: EmitProposalInput,
): Promise<EmitProposalResult> {
  const proposal = await deps.proposals.insertPending({
    tenant_id: input.tenant_id,
    recipe_id: input.recipe_id,
    current_version: input.diff.current_version,
    proposed_version: input.diff.proposed_version,
    proposed_diff: input.diff,
    signals: input.signals,
    citations: input.citations,
  });

  await safeNotify(deps.sink, {
    kind: 'doc_evolution_proposal_pending',
    tenant_id: input.tenant_id,
    proposal_id: proposal.id,
    recipe_id: input.recipe_id,
    current_version: input.diff.current_version,
    proposed_version: input.diff.proposed_version,
    summary: input.diff.summary,
  });

  const baseChain = deps.auditChain ?? [];
  const audit = emitAuditEntry({
    kind: 'doc_evo.improve_proposal',
    tenant_id: input.tenant_id,
    subject: {
      proposal_id: proposal.id,
      recipe_id: input.recipe_id,
      current_version: input.diff.current_version,
      proposed_version: input.diff.proposed_version,
      edits_count: input.diff.edits.length,
      summary: input.diff.summary,
    },
    chain: baseChain,
    ...(deps.auditSecretId !== undefined
      ? { secret_id: deps.auditSecretId }
      : {}),
    ...(deps.auditSecretValue !== undefined
      ? { secret_value: deps.auditSecretValue }
      : {}),
  });

  return { proposal, auditChain: audit.chain };
}

async function safeNotify(
  sink: NotificationSink,
  notification: ProposalNotification,
): Promise<void> {
  try {
    await sink.emit(notification);
  } catch {
    // Notification sink failures must not block the proposal write —
    // the row is the authoritative artefact; the notification is best-effort.
  }
}
