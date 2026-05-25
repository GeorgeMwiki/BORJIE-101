/**
 * Kernel feedback port — duck-typed structural interface the kernel
 * reads from at step 4 (memory recall) WITHOUT compile-time depending
 * on `@borjie/database`. The api-gateway composition root binds
 * this to the Drizzle-backed `createFeedbackService(db)`. Test rigs
 * bind in-memory fakes.
 *
 * Mirrors LITFIN's online-learning feedback loop, scoped to property:
 * stock LLMs are STATIC, so without an explicit feedback channel the
 * same hallucination repeats forever. The kernel mixes the user's
 * recent feedback (verbatim corrections + a per-category negative-
 * rate) into the system prompt so the next turn is biased toward
 * conservative, citation-heavy output when the user has been pushing
 * back lately.
 *
 * The shapes here intentionally mirror `FeedbackEntry` /
 * `FeedbackSignal` in `packages/database/src/services/kernel-feedback.
 * service.ts` so the production service is structurally compatible
 * with this port without any adapter glue.
 */

export type FeedbackSignal =
  | 'thumbs-up'
  | 'thumbs-down'
  | 'correction'
  | 'flagged';

export interface FeedbackEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly thoughtId: string;
  readonly threadId: string;
  readonly signal: FeedbackSignal;
  readonly rating?: number;
  readonly correctionText?: string;
  readonly category?: string;
  readonly capturedAt: string;
}

export interface FeedbackRecallArgs {
  readonly tenantId: string;
  readonly userId: string;
  /** Cap the row count returned. Kernel typically asks for 10. */
  readonly limit: number;
}

/**
 * The kernel only reads recent feedback. WRITES go through the
 * gateway's POST /feedback route (NOT through the kernel) so the
 * write path is auditable and the kernel itself stays read-only on
 * this side-channel.
 */
export interface FeedbackMemoryPort {
  recallRecent(
    args: FeedbackRecallArgs,
  ): Promise<ReadonlyArray<FeedbackEntry>>;
}
