/**
 * CLOSE-pattern refusal types.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §3
 *
 * Four-line refusal grammar:
 *   [ACKNOWLEDGE]  validate the user's question
 *   [REFUSE]       state the boundary (without revealing why)
 *   [REDIRECT]     offer what CAN be told instead
 *   [INVITE]       ask what underlying need they're trying to meet
 *
 * Critical: limit articulation NEVER reveals the blocker (classifier vs
 * cost cap vs capability gap vs policy). See §3 refusal pattern library.
 */

/**
 * The canonical CLOSE refusal categories.
 *
 * `system-prompt-leak`       — user asked for SP text / instructions / "debug mode"
 * `classifier-blocked`       — pre-exec safety classifier flagged input
 * `cost-cap`                 — autonomy/spend budget exhausted
 * `capability-gap`           — no tool / no model coverage for this ask
 * `jurisdiction-gap`         — request is outside supported jurisdictions
 * `data-residency-violation` — would require cross-region data move
 */
export type CloseRefusalCategory =
  | 'system-prompt-leak'
  | 'classifier-blocked'
  | 'cost-cap'
  | 'capability-gap'
  | 'jurisdiction-gap'
  | 'data-residency-violation';

/**
 * Input to `closeRefusal`.
 */
export interface CloseRefusalInput {
  readonly ack: string;
  readonly refuse: string;
  readonly redirect: string;
  readonly invite: string;
}

/**
 * Structured refusal returned by `closeRefusal`. The composer renders
 * the 4 segments into final text via `renderRefusalCard`.
 */
export interface RefusalCard {
  readonly segments: {
    readonly acknowledge: string;
    readonly refuse: string;
    readonly redirect: string;
    readonly invite: string;
  };
  readonly category?: CloseRefusalCategory;
  /** Renders the card to a single user-facing string. */
  readonly text: string;
}
