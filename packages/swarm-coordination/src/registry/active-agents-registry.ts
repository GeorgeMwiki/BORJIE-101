/**
 * Active-agents registry — public API.
 *
 * Wave 18HH. Three operations a running agent invokes:
 *
 *   - register(input) — at agent-turn start. Returns the registry row.
 *   - heartbeat(id)   — periodically (30s cadence). Refreshes liveness.
 *   - deregister(id)  — at agent-turn end. Terminal status required.
 *
 * Plus one query primitive for the patterns layer:
 *
 *   - listRunningOnSubject(subject) — for conflict detection and
 *     duplicate-research blindspot prevention.
 */

import type {
  ActiveAgent,
  ActiveAgentsRepository,
  AgentStatus,
  AgentSubject,
  RegisterAgentInput,
} from '../types.js';

export interface ActiveAgentsRegistry {
  register(input: RegisterAgentInput): Promise<ActiveAgent>;
  heartbeat(tenantId: string, id: string): Promise<void>;
  deregister(
    tenantId: string,
    id: string,
    terminalStatus: Exclude<AgentStatus, 'running'>,
  ): Promise<void>;
  listRunningOnSubject(
    tenantId: string,
    subject: AgentSubject,
  ): Promise<ReadonlyArray<ActiveAgent>>;
}

export function createActiveAgentsRegistry(
  repository: ActiveAgentsRepository,
): ActiveAgentsRegistry {
  return {
    register(input) {
      return repository.register(input);
    },
    heartbeat(tenantId, id) {
      return repository.heartbeat(tenantId, id);
    },
    deregister(tenantId, id, terminalStatus) {
      return repository.deregister(tenantId, id, terminalStatus);
    },
    listRunningOnSubject(tenantId, subject) {
      return repository.listRunningOnSubject(tenantId, subject);
    },
  };
}
