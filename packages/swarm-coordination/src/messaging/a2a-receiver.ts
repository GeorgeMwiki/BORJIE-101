/**
 * A2A receiver — pull unacked messages addressed to a particular agent
 * or subject.
 *
 * Wave 18HH. The caller polls `pullForAgent` on its tick. After
 * processing, the caller MUST `ack(id)` each message; unacked
 * messages remain in the queue and will be re-pulled on the next
 * tick. Senders waiting on a `request` block on `ackAt IS NOT NULL`.
 */

import type {
  AgentMessage,
  AgentMessagesRepository,
  AgentSubject,
} from '../types.js';

export interface A2AReceiver {
  pullForAgent(
    tenantId: string,
    toAgentId: string,
  ): Promise<ReadonlyArray<AgentMessage>>;
  pullForSubject(
    tenantId: string,
    subject: AgentSubject,
  ): Promise<ReadonlyArray<AgentMessage>>;
  ack(tenantId: string, id: string): Promise<void>;
}

export function createA2AReceiver(
  repository: AgentMessagesRepository,
): A2AReceiver {
  return {
    pullForAgent(tenantId, toAgentId) {
      return repository.pullUnacked(tenantId, toAgentId);
    },
    pullForSubject(tenantId, subject) {
      return repository.pullSubjectScoped(tenantId, subject);
    },
    ack(tenantId, id) {
      return repository.ack(tenantId, id);
    },
  };
}
