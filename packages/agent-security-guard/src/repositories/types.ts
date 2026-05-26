/**
 * Repository ports for SEC-4 persistence.
 *
 * Pure ports (no Drizzle imports here) so that the package can run in
 * unit tests, in CI workflows, and in production composition without
 * dragging a live Postgres into the bundle. Production composition
 * wires these to Drizzle-backed implementations against the tables in
 * migration `0054_agent_security.sql`.
 */
import type {
  AgentSecuritySignal,
  OutputFilterBlock,
  PromptInjectionAttempt,
  RedTeamRun,
  ToolUseViolation,
} from '../types.js';

export interface PromptInjectionAttemptRepository {
  readonly insert: (row: PromptInjectionAttempt) => Promise<void>;
  readonly latestForTenant: (
    tenantId: string,
    limit: number,
  ) => Promise<ReadonlyArray<PromptInjectionAttempt>>;
}

export interface ToolUseViolationRepository {
  readonly insert: (row: ToolUseViolation) => Promise<void>;
  readonly latestForTenant: (
    tenantId: string,
    limit: number,
  ) => Promise<ReadonlyArray<ToolUseViolation>>;
}

export interface OutputFilterBlockRepository {
  readonly insertMany: (rows: ReadonlyArray<OutputFilterBlock>) => Promise<void>;
  readonly latestForTenant: (
    tenantId: string,
    limit: number,
  ) => Promise<ReadonlyArray<OutputFilterBlock>>;
}

export interface AgentSecuritySignalRepository {
  readonly insert: (row: AgentSecuritySignal) => Promise<void>;
  readonly latestForTenant: (
    tenantId: string,
    limit: number,
  ) => Promise<ReadonlyArray<AgentSecuritySignal>>;
}

export interface RedTeamRunRepository {
  readonly insert: (row: RedTeamRun) => Promise<void>;
  readonly latestForTenant: (
    tenantId: string,
    limit: number,
  ) => Promise<ReadonlyArray<RedTeamRun>>;
  readonly latestHashForTenant: (tenantId: string) => Promise<string | null>;
}
