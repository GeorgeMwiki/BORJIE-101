/**
 * Conversation state types.
 *
 * This is conversation-level state distinct from the orchestrator's turn
 * machine. It tracks the *arc* of a conversation: greeting \u2192 discovery \u2192
 * task \u2192 wrap-up \u2192 followup. Context accumulates across turns with smart
 * compaction so Mr. Mwikila never forgets what the manager was doing.
 */

export type ConversationPhase =
  | 'greeting'
  | 'discovery'
  | 'task'
  | 'wrap_up'
  | 'followup';

export type Tone = 'positive' | 'neutral' | 'negative';

export interface ConversationTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly createdAt: string;
  readonly entities?: readonly ExtractedEntity[];
  readonly tone?: Tone;
  readonly latencyMs?: number;
}

export interface ExtractedEntity {
  readonly type:
    | 'property_id'
    | 'unit_id'
    | 'tenant_name'
    | 'amount_tzs'
    | 'date'
    | 'district';
  readonly value: string;
  readonly confidence: number;
}

export interface ConversationState {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly language: 'en' | 'sw';
  readonly phase: ConversationPhase;
  readonly history: readonly ConversationTurn[];
  readonly entities: readonly ExtractedEntity[];
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly toneWindow: readonly Tone[];
}

export interface ConversationConfig {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly language: 'en' | 'sw';
  readonly maxHistoryTurns?: number;
  readonly toneWindowSize?: number;
}

export interface UserHistorySignals {
  readonly displayName: string;
  readonly lastSessionAt?: string;
  readonly lastFocus?: string;
}
