/**
 * Piece O — Conversation observer.
 *
 * Subscribes to conversation message events (Piece F's conversation
 * stream — referenced as a soft contract; the table may not exist
 * yet, so this observer takes events via an in-memory queue instead).
 *
 * Pure function over message → signals: takes the extracted NER
 * entities + intent label and runs them through the scoring matrix.
 *
 * No IO here. The cron supplies the message stream + calls the writer.
 */

import {
  evaluateIntentLabel,
  evaluateNerEntities,
} from '../scoring-matrix.js';
import type { ConversationIntentPayload, NewSignalInput } from '../types.js';

/**
 * One observed conversation event. The shape is intentionally minimal
 * so this observer doesn't depend on Piece F's conversation table —
 * it accepts plain data from whichever source has it.
 */
export interface ConversationEvent {
  readonly tenantId: string;
  readonly userId: string;
  readonly messageId: string;
  readonly intent?: string;
  readonly entities: ReadonlyArray<readonly [string, string]>;
}

/**
 * Convert a conversation event into zero or more signals. Returns one
 * `NewSignalInput` per matrix hit. The caller writes to migration 0261.
 */
export function observeConversation(
  event: ConversationEvent,
): readonly NewSignalInput[] {
  if (!event || !event.tenantId || !event.userId) return [];

  const hits = [
    ...evaluateNerEntities(event.entities ?? []),
    ...evaluateIntentLabel(event.intent),
  ];

  if (hits.length === 0) return [];

  const payload: ConversationIntentPayload = {
    messageId: event.messageId,
    ...(event.intent !== undefined ? { intent: event.intent } : {}),
    entities: (event.entities ?? []).map(
      (e): [string, string] => [e[0], e[1]],
    ),
  };

  return hits.map((hit) => ({
    tenantId: event.tenantId,
    userId: event.userId,
    signalKind: 'conversation_intent' as const,
    signalPayload: { ...payload, matchedRule: hit.rule },
    suggestedModuleTemplateId: hit.suggestedModuleTemplateId,
    weight: hit.weight,
  }));
}
