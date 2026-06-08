/**
 * Modality refine path — INVARIANT rule 4 (chat-customizable).
 *
 * "The proposal is a starting point; the user chats to refine and genui
 * re-synthesizes from the amended spec." A refinement NEVER auto-applies; it
 * produces a NEW proposal (a re-synthesized UI spec over the same artifact)
 * that, like any proposal, surfaces for approval. The original proposal is
 * untouched (immutable) — refinement returns a fresh proposal.
 *
 * Pure — no I/O. The caller routes the refined proposal through the same
 * approval gate / portal-genui channel as a first proposal.
 *
 * @module composition/modality-capability/modality-refine
 */

import {
  buildModalityProposal,
  type ModalityProposal,
} from './modality-proposal.js';

export interface RefineModalityProposalArgs {
  /** The proposal being refined (carries the artifact + tenant/kind). */
  readonly prior: ModalityProposal;
  readonly tenantId: string;
  readonly userId: string | null;
  /** The chat amendment — a new title / description / field labels. */
  readonly amendment: {
    readonly title?: string;
    readonly description?: string;
    readonly fieldLabels?: ReadonlyArray<string>;
    readonly reason?: string;
  };
  /** Evidence ids carried from the prior proposal (the artifact's chain). */
  readonly evidenceIds: ReadonlyArray<string>;
}

/**
 * Re-synthesize a proposal from an amended spec. The artifact is carried
 * UNCHANGED from the prior proposal; only the genui-synthesized UI spec
 * (title / description / fields / reason) is re-derived. Returns `null` when
 * the amendment would clear evidence (never surface an evidence-free UI).
 *
 * The refined proposal keeps the prior `posture` — a refinement of a
 * propose-and-approve proposal stays propose-and-approve; it can NOT silently
 * escalate to `auto`.
 */
export function refineModalityProposal(
  args: RefineModalityProposalArgs,
): ModalityProposal | null {
  const priorPayload = args.prior.payload;
  const title = args.amendment.title ?? priorPayload.title;
  const description = args.amendment.description ?? priorPayload.description;
  const fieldLabels =
    args.amendment.fieldLabels ??
    priorPayload.summary.sections.flatMap((s) => s.fieldLabels);
  const reason = args.amendment.reason ?? priorPayload.reason;

  return buildModalityProposal({
    artifactKind: args.prior.artifactKind,
    tenantId: args.tenantId,
    userId: args.userId,
    need: {
      // A refinement is, by definition, warranted (the user asked for it) —
      // but it still must carry evidence; an empty chain returns null below.
      warranted: true,
      score: priorPayload.confidence,
      evidenceIds: args.evidenceIds,
      reason,
      // Refinement can NEVER escalate the autonomy posture.
      posture: args.prior.posture,
    },
    title,
    description,
    fieldLabels,
    artifact: args.prior.artifact,
  });
}
