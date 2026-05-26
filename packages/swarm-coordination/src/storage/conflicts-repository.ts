/**
 * In-memory `ConflictsRepository` implementation.
 *
 * Wave 18HH. Pure-memory adapter for tests + dev. Production wires a
 * Drizzle-backed adapter on the database package.
 */

import { randomUUID } from 'node:crypto';
import { computeSwarmAuditHash } from '../audit/audit-chain-link.js';
import type {
  ConflictResolutionKind,
  ConflictsRepository,
  CoordinationConflict,
  OpenConflictInput,
} from '../types.js';

interface InMemoryConflictsRepositoryDeps {
  readonly now: () => Date;
}

export function createInMemoryConflictsRepository(
  deps: InMemoryConflictsRepositoryDeps = { now: () => new Date() },
): ConflictsRepository {
  const rows = new Map<string, CoordinationConflict>();

  return {
    async open(input: OpenConflictInput): Promise<CoordinationConflict> {
      const now = deps.now();
      const id = randomUUID();
      const row: CoordinationConflict = Object.freeze({
        id,
        tenantId: input.tenantId,
        subject: input.subject,
        conflictingProposalIds: input.conflictingProposalIds.slice(),
        detectedAt: now,
        resolutionKind: null,
        reconciliationPayload: null,
        resolvedAt: null,
        auditHash: computeSwarmAuditHash({
          op: 'open_conflict',
          tenantId: input.tenantId,
          subjectKind: input.subject.kind,
          subjectId: input.subject.id,
          proposals: input.conflictingProposalIds.slice(),
          detectedAt: now.toISOString(),
        }),
      });
      rows.set(id, row);
      return row;
    },

    async resolve(
      tenantId: string,
      id: string,
      kind: ConflictResolutionKind,
      reconciliationPayload: Readonly<Record<string, unknown>>,
    ): Promise<void> {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        return;
      }
      rows.set(
        id,
        Object.freeze({
          ...existing,
          resolutionKind: kind,
          reconciliationPayload,
          resolvedAt: deps.now(),
        }),
      );
    },

    async listUnresolved(
      tenantId: string,
    ): Promise<ReadonlyArray<CoordinationConflict>> {
      const matches: CoordinationConflict[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId && row.resolvedAt === null) {
          matches.push(row);
        }
      }
      return matches;
    },
  };
}
