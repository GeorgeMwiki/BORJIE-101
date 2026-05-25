/**
 * Runtime-defense-composer types — chain all 9 N-D modules.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4 + §6
 *
 * Pipeline:
 *   1. detect canary leak attempt
 *   2. check tier
 *   3. CLOSE refusal if Tier-3 violation
 *   4. spotlight any disclosed content
 *   5. emit EU AI Act disclosure if first interaction
 *   6. log audit
 *   7. return final response + disclosure metadata
 */

import type { AuthInjectedPrincipal } from '../role-gate/types.js';
import type { CanaryToken } from '../canary-tokens/types.js';
import type { CapabilityField, DisclosureTier } from '../tier-taxonomy/types.js';
import type {
  CloseRefusalCategory,
  RefusalCard,
} from '../close-pattern/types.js';
import type { DisclosureAuditEvent, DisclosureAuditSink } from '../disclosure-audit/types.js';
import type { DisclosureSurface } from '../eu-ai-act-art-50/types.js';

/**
 * A draft response the upstream LLM produced. May contain disclosure
 * fields keyed by CapabilityField; the composer will gate them.
 */
export interface DraftResponse {
  readonly text: string;
  readonly fields?: Partial<Record<CapabilityField, string>>;
}

/**
 * Hints to the composer about what the user is asking.
 */
export interface DraftIntentHints {
  /** True when the query was detected as asking for SP text / "show me your instructions". */
  readonly isSystemPromptProbe?: boolean;
  /** True when the query was detected as asking for LLM identity. */
  readonly isModelIdentityProbe?: boolean;
  /** Any other Tier-3 fields the LLM tried to include. */
  readonly attemptedFields?: ReadonlyArray<CapabilityField>;
}

/**
 * Composer input.
 */
export interface DefendedRespondInput {
  readonly principal: AuthInjectedPrincipal;
  readonly query: string;
  readonly draftResponse: DraftResponse;
  readonly canary: CanaryToken;
  readonly hints?: DraftIntentHints;
  readonly isFirstInteraction: boolean;
  readonly surface: DisclosureSurface;
  readonly auditSink: DisclosureAuditSink;
  readonly now?: number;
}

/**
 * Composer output.
 */
export interface DefendedResponse {
  readonly text: string;
  readonly principalTier: DisclosureTier;
  readonly refused: boolean;
  readonly refusalCategory?: CloseRefusalCategory;
  readonly refusalCard?: RefusalCard;
  readonly fieldsReturned: ReadonlyArray<CapabilityField>;
  readonly refusedFields: ReadonlyArray<CapabilityField>;
  readonly canaryLeakDetected: boolean;
  readonly euAct50EmittedSurface?: DisclosureSurface;
  readonly auditEvent: DisclosureAuditEvent;
}
