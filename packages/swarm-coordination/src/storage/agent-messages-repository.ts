/**
 * In-memory `AgentMessagesRepository` implementation.
 *
 * Wave 18HH. Pure-memory adapter for tests + dev. Production wires a
 * Drizzle-backed adapter on the database package.
 */

import { randomUUID } from 'node:crypto';
import { computeSwarmAuditHash } from '../audit/audit-chain-link.js';
import type {
  AgentMessage,
  AgentMessagesRepository,
  AgentSubject,
  SendMessageInput,
} from '../types.js';

interface InMemoryAgentMessagesRepositoryDeps {
  readonly now: () => Date;
}

export function createInMemoryAgentMessagesRepository(
  deps: InMemoryAgentMessagesRepositoryDeps = { now: () => new Date() },
): AgentMessagesRepository {
  const rows = new Map<string, AgentMessage>();

  return {
    async send(input: SendMessageInput): Promise<AgentMessage> {
      const now = deps.now();
      const id = randomUUID();
      const row: AgentMessage = Object.freeze({
        id,
        tenantId: input.tenantId,
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId ?? null,
        toSubject: input.toSubject ?? null,
        messageKind: input.messageKind,
        payload: input.payload,
        sentAt: now,
        ackAt: null,
        auditHash: computeSwarmAuditHash({
          op: 'send',
          tenantId: input.tenantId,
          fromAgentId: input.fromAgentId,
          messageKind: input.messageKind,
          sentAt: now.toISOString(),
        }),
      });
      rows.set(id, row);
      return row;
    },

    async pullUnacked(
      tenantId: string,
      toAgentId: string,
    ): Promise<ReadonlyArray<AgentMessage>> {
      const matches: AgentMessage[] = [];
      for (const row of rows.values()) {
        if (
          row.tenantId === tenantId &&
          row.toAgentId === toAgentId &&
          row.ackAt === null
        ) {
          matches.push(row);
        }
      }
      return matches;
    },

    async pullSubjectScoped(
      tenantId: string,
      subject: AgentSubject,
    ): Promise<ReadonlyArray<AgentMessage>> {
      const matches: AgentMessage[] = [];
      for (const row of rows.values()) {
        if (
          row.tenantId === tenantId &&
          row.toSubject !== null &&
          row.toSubject.kind === subject.kind &&
          row.toSubject.id === subject.id
        ) {
          matches.push(row);
        }
      }
      return matches;
    },

    async ack(tenantId: string, id: string): Promise<void> {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        return;
      }
      rows.set(id, Object.freeze({ ...existing, ackAt: deps.now() }));
    },
  };
}
