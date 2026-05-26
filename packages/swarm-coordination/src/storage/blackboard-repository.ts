/**
 * In-memory `BlackboardRepository` implementation.
 *
 * Wave 18HH. Pure-memory adapter for tests + dev. Production wires a
 * Drizzle-backed adapter on the database package.
 */

import { randomUUID } from 'node:crypto';
import { computeSwarmAuditHash } from '../audit/audit-chain-link.js';
import type {
  AgentSubject,
  BlackboardPosting,
  BlackboardRepository,
  PostContributionInput,
} from '../types.js';

interface InMemoryBlackboardRepositoryDeps {
  readonly now: () => Date;
}

export function createInMemoryBlackboardRepository(
  deps: InMemoryBlackboardRepositoryDeps = { now: () => new Date() },
): BlackboardRepository {
  const rows = new Map<string, BlackboardPosting>();

  return {
    async post(input: PostContributionInput): Promise<BlackboardPosting> {
      const now = deps.now();
      const id = randomUUID();
      const row: BlackboardPosting = Object.freeze({
        id,
        tenantId: input.tenantId,
        scopeId: input.scopeId ?? null,
        postedByAgentId: input.postedByAgentId,
        subject: input.subject,
        contributionKind: input.contributionKind,
        payload: input.payload,
        supersedesPostingId: input.supersedesPostingId ?? null,
        postedAt: now,
        auditHash: computeSwarmAuditHash({
          op: 'post',
          tenantId: input.tenantId,
          postedByAgentId: input.postedByAgentId,
          subjectKind: input.subject.kind,
          subjectId: input.subject.id,
          contributionKind: input.contributionKind,
          postedAt: now.toISOString(),
        }),
      });
      rows.set(id, row);
      return row;
    },

    async readSubject(
      tenantId: string,
      subject: AgentSubject,
      scopeId?: string,
    ): Promise<ReadonlyArray<BlackboardPosting>> {
      const matches: BlackboardPosting[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.subject.kind !== subject.kind) continue;
        if (row.subject.id !== subject.id) continue;
        if (scopeId !== undefined && row.scopeId !== scopeId) continue;
        matches.push(row);
      }
      // Newest first.
      return matches.slice().sort(
        (a, b) => b.postedAt.getTime() - a.postedAt.getTime(),
      );
    },
  };
}
