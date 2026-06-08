/**
 * Conversation-feel layer — shared types.
 *
 * Vision: every assistant reply that leaves the system can pass through
 * guards that strip chatbot-feel patterns and enforce conversation
 * discipline. These guards never alter substance — they only remove filler,
 * force position-taking, enforce continuity, and shape rhythm.
 *
 * Locale discipline: a guard operates within ONE locale at a time and never
 * injects the other language. The active `Locale` is threaded through every
 * mutating pass so an `en` reply stays `en` and an `sw` reply stays `sw`.
 *
 * References:
 *  - Anthropic, "Towards Understanding Sycophancy in Language Models" (2024).
 *  - Grice, "Logic and Conversation" (1975) — cooperative principle.
 *  - Sacks, Schegloff, Jefferson, "A Simplest Systematics for the
 *    Organization of Turn-Taking for Conversation" (1974, 2024 reissue).
 *  - Strunk + White, "The Elements of Style" (1918, 4th ed. 2000).
 *  - Kahneman, Sibony, Sunstein, "Noise" (2021) — confidence calibration.
 *
 * Ported from BossNyumba `packages/conversation-feel` and neutralized for
 * Borjie's mining-estate domain (real-estate wording removed).
 */

/**
 * The two user-facing languages. Borjie defaults to `en`; Tanzanian users
 * may toggle to `sw`. The toggle is ABSOLUTE — when one locale is active the
 * other must never appear in a reply. Guards respect this invariant.
 */
export type Locale = 'en' | 'sw';

export type ChatbotFeelPattern =
  | 'filler_opener'
  | 'filler_closer'
  | 'sycophantic_agreement'
  | 'theatrical_apology'
  | 'verbose_preamble'
  | 'hedge_overload'
  | 'paraphrased_question'
  | 'generic_transition'
  | 'anything_else_closer'
  | 'mechanical_bullets';

export interface RemovedPhrase {
  readonly pattern: ChatbotFeelPattern;
  readonly phrase: string;
  readonly position: number;
  readonly reason: string;
}

export interface StrippedResponse {
  readonly stripped: string;
  readonly original: string;
  readonly removed_phrases: ReadonlyArray<RemovedPhrase>;
  readonly residual_chatbot_score: number;
}

export type GuardOutcome = 'pass' | 'silent_fix' | 'request_regen' | 'annotate';

export interface GuardIntervention {
  readonly id: string;
  readonly guard: string;
  readonly outcome: GuardOutcome;
  readonly reason: string;
  readonly before: string;
  readonly after: string;
  readonly removed?: ReadonlyArray<RemovedPhrase>;
  readonly metadata?: Record<string, unknown>;
  readonly hash_prev: string;
  readonly hash_self: string;
  readonly created_at: string;
  readonly session_id: string;
}

/**
 * The Borjie product surfaces (neutralized from BossNyumba's borrower /
 * officer / litfin_admin portals). Used only to gate optional wit; never
 * affects substance.
 */
export type Surface =
  | 'owner'
  | 'manager'
  | 'employee'
  | 'admin'
  | 'buyer'
  | 'marketing';

export interface ConversationContext {
  readonly session_id: string;
  readonly turn_index: number;
  readonly locale: Locale;
  readonly surface: Surface;
  readonly user_message: string;
  readonly recent_turns: ReadonlyArray<RecentTurn>;
  readonly known_user_facts?: ReadonlyArray<UserFact>;
  readonly user_asked_for_opinion?: boolean;
  readonly is_genuinely_uncertain?: boolean;
  readonly calibrated_confidence?: number;
  readonly turn_kind?: TurnKind;
}

export type TurnKind =
  | 'question'
  | 'explanation'
  | 'deep_teaching'
  | 'decision'
  | 'smalltalk';

export interface RecentTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly turn_index: number;
}

export interface UserFact {
  readonly key: string;
  readonly value: string;
  readonly source_turn: number;
}

export interface RhythmScore {
  readonly variance: number;
  readonly question_back_ratio: number;
  readonly pause_signals: number;
  readonly flatlined: boolean;
  readonly turns_analyzed: number;
}

export interface SessionStats {
  readonly session_id: string;
  readonly anti_pattern_strips: number;
  readonly continuity_enforcements: number;
  readonly position_taking_interventions: number;
  readonly sycophancy_pushbacks: number;
  readonly brevity_violations: number;
  readonly specificity_fixes: number;
  readonly honest_uncertainty_invocations: number;
  readonly wit_uses: number;
  readonly rhythm: RhythmScore;
  readonly chatbot_feel_score: number; // 0..100, lower = more human
}
