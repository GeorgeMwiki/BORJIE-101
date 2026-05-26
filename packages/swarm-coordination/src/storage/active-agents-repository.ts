/**
 * In-memory `ActiveAgentsRepository` implementation.
 *
 * Wave 18HH. Pure-memory adapter for tests + dev. Production wires a
 * Drizzle-backed adapter on the database package; this adapter ships
 * with `@borjie/swarm-coordination` so consumers can scaffold the
 * registry + patterns without a live Postgres.
 *
 * Immutability: all stored rows are frozen on insert. Mutation
 * operations replace the row outright (`status` flip, heartbeat
 * refresh).
 */

import { randomUUID } from 'node:crypto';
import { computeSwarmAuditHash } from '../audit/audit-chain-link.js';
import type {
  ActiveAgent,
  ActiveAgentsRepository,
  AgentStatus,
  AgentSubject,
  RegisterAgentInput,
} from '../types.js';

interface InMemoryActiveAgentsRepositoryDeps {
  /** Clock injection for deterministic testing. */
  readonly now: () => Date;
}

export function createInMemoryActiveAgentsRepository(
  deps: InMemoryActiveAgentsRepositoryDeps = { now: () => new Date() },
): ActiveAgentsRepository {
  const rows = new Map<string, ActiveAgent>();

  return {
    async register(input: RegisterAgentInput): Promise<ActiveAgent> {
      const now = deps.now();
      const id = randomUUID();
      const row: ActiveAgent = Object.freeze({
        id,
        tenantId: input.tenantId,
        agentId: input.agentId,
        agentKind: input.agentKind,
        scopeId: input.scopeId ?? null,
        subject: input.subject ?? null,
        parentAgentId: input.parentAgentId ?? null,
        startedAt: now,
        expectedCompletionAt: input.expectedCompletionAt ?? null,
        heartbeatAt: now,
        status: 'running',
        auditHash: computeSwarmAuditHash({
          op: 'register',
          tenantId: input.tenantId,
          agentId: input.agentId,
          agentKind: input.agentKind,
          startedAt: now.toISOString(),
        }),
      });
      rows.set(id, row);
      return row;
    },

    async heartbeat(tenantId: string, id: string): Promise<void> {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        return;
      }
      rows.set(
        id,
        Object.freeze({ ...existing, heartbeatAt: deps.now() }),
      );
    },

    async deregister(
      tenantId: string,
      id: string,
      terminalStatus: Exclude<AgentStatus, 'running'>,
    ): Promise<void> {
      const existing = rows.get(id);
      if (existing === undefined || existing.tenantId !== tenantId) {
        return;
      }
      rows.set(
        id,
        Object.freeze({ ...existing, status: terminalStatus }),
      );
    },

    async listRunningOnSubject(
      tenantId: string,
      subject: AgentSubject,
    ): Promise<ReadonlyArray<ActiveAgent>> {
      const matches: ActiveAgent[] = [];
      for (const row of rows.values()) {
        if (
          row.tenantId === tenantId &&
          row.status === 'running' &&
          row.subject !== null &&
          row.subject.kind === subject.kind &&
          row.subject.id === subject.id
        ) {
          matches.push(row);
        }
      }
      return matches;
    },

    async listStaleRunning(
      olderThan: Date,
    ): Promise<ReadonlyArray<ActiveAgent>> {
      const stale: ActiveAgent[] = [];
      for (const row of rows.values()) {
        if (
          row.status === 'running' &&
          row.heartbeatAt.getTime() < olderThan.getTime()
        ) {
          stale.push(row);
        }
      }
      return stale;
    },
  };
}
