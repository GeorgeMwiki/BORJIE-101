/**
 * Message-routing classifier.
 *
 * Wave 18HH. Pure helper. Given a `SendMessageInput`, classifies the
 * delivery mode so the receiver layer can dispatch correctly.
 *
 * Three modes:
 *   - 'direct'        — `toAgentId` set, no `toSubject`.
 *   - 'broadcast'     — neither `toAgentId` nor `toSubject` set.
 *                        Visible to all agents in scope.
 *   - 'subject_scoped' — `toSubject` set (with or without toAgentId).
 *
 * The classifier rejects the impossible (`toAgentId` AND `toSubject`
 * are mutually exclusive) so the sender catches misuse before it
 * reaches the DB.
 */

import type { SendMessageInput } from '../types.js';

export type RoutingMode = 'direct' | 'broadcast' | 'subject_scoped';

export function classifyRouting(input: SendMessageInput): RoutingMode {
  const hasAgent = input.toAgentId !== undefined;
  const hasSubject = input.toSubject !== undefined;

  if (hasAgent && hasSubject) {
    throw new Error(
      'A2A message cannot be both direct AND subject-scoped; pick one',
    );
  }
  if (hasAgent) {
    return 'direct';
  }
  if (hasSubject) {
    return 'subject_scoped';
  }
  return 'broadcast';
}
