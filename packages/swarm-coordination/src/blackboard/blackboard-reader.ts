/**
 * Blackboard reader — fetch contributions for a subject within a scope,
 * with superseded postings filtered out by default.
 *
 * Wave 18HH. Enforces the spec contract: agents reading the blackboard
 * for a subject see ONLY the live (un-superseded) tip postings. Use
 * `readWithSuperseded` to opt into the full history for audit views.
 */

import type {
  AgentSubject,
  BlackboardPosting,
  BlackboardRepository,
} from '../types.js';

export interface BlackboardReader {
  readSubject(
    tenantId: string,
    subject: AgentSubject,
    scopeId?: string,
  ): Promise<ReadonlyArray<BlackboardPosting>>;
  readWithSuperseded(
    tenantId: string,
    subject: AgentSubject,
    scopeId?: string,
  ): Promise<ReadonlyArray<BlackboardPosting>>;
}

export function createBlackboardReader(
  repository: BlackboardRepository,
): BlackboardReader {
  return {
    async readSubject(tenantId, subject, scopeId) {
      const all = await repository.readSubject(tenantId, subject, scopeId);
      const supersededIds = new Set(
        all
          .map((p) => p.supersedesPostingId)
          .filter((id): id is string => id !== null),
      );
      return all.filter((p) => !supersededIds.has(p.id));
    },
    readWithSuperseded(tenantId, subject, scopeId) {
      return repository.readSubject(tenantId, subject, scopeId);
    },
  };
}
