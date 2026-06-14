/**
 * Master Brain chat surface type shapes.
 *
 * The wire shape that the gateway SSE channel emits.
 */

export interface ChatEvidence {
  readonly id: string;
  readonly label: string;
  readonly docTitle: string;
  readonly excerpt: string;
  readonly page?: number;
}

export interface ChatBreadcrumb {
  readonly agent: string;
  readonly action: string;
  readonly latencyMs: number;
}

/**
 * KI-005 — the evidence-chain Auditor verdict the gateway surfaces as the
 * terminal `auditor` SSE frame for a turn. Mirrors the non-stream
 * `BrainTurnAudit` contract. The chat surface renders a grounding badge /
 * warning when the answer was ungrounded (`groundingFault` or a non-null
 * `evidenceWarning`); an `approve` verdict with no warning renders nothing.
 */
export interface ChatGroundingSignal {
  readonly verdict: 'approve' | 'reject' | 'needs_human';
  readonly evidenceCount: number;
  readonly evidenceWarning: 'no_evidence_cited' | 'evidence_invalid' | null;
  readonly groundingFault: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'owner' | 'master-brain';
  readonly content: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly breadcrumbs: ReadonlyArray<ChatBreadcrumb>;
  readonly createdAt: string;
  /**
   * KI-005 — the Auditor grounding verdict for this answer, when the gateway
   * surfaced one. Absent on owner messages and on legacy wires that predate
   * the `auditor` frame — consumers must handle `undefined`.
   */
  readonly grounding?: ChatGroundingSignal;
}
