/**
 * In-memory repository implementations for SEC-4.
 *
 * Useful for:
 *   - unit tests (deterministic, no DB),
 *   - the daily CI red-team workflow (no staging-DB dependency),
 *   - local development against `pnpm dev` without `pnpm migrate`.
 *
 * Each implementation is tenant-scoped at the application layer; the
 * production Drizzle adapter additionally enforces tenant isolation
 * via the `app.tenant_id` GUC RLS policy from migration 0054.
 */
import type {
  AgentSecuritySignal,
  OutputFilterBlock,
  PromptInjectionAttempt,
  RedTeamRun,
  ToolUseViolation,
} from '../types.js';
import type {
  AgentSecuritySignalRepository,
  OutputFilterBlockRepository,
  PromptInjectionAttemptRepository,
  RedTeamRunRepository,
  ToolUseViolationRepository,
} from './types.js';

function take<T>(rows: ReadonlyArray<T>, limit: number): ReadonlyArray<T> {
  if (limit <= 0) return Object.freeze([]);
  return Object.freeze(rows.slice(0, limit));
}

export function createInMemoryPromptInjectionRepo(): PromptInjectionAttemptRepository {
  const rows: PromptInjectionAttempt[] = [];
  return Object.freeze({
    insert: async (row: PromptInjectionAttempt) => {
      rows.unshift(row);
    },
    latestForTenant: async (tenantId: string, limit: number) =>
      take(
        rows.filter((r) => r.tenantId === tenantId),
        limit,
      ),
  });
}

export function createInMemoryToolUseRepo(): ToolUseViolationRepository {
  const rows: ToolUseViolation[] = [];
  return Object.freeze({
    insert: async (row: ToolUseViolation) => {
      rows.unshift(row);
    },
    latestForTenant: async (tenantId: string, limit: number) =>
      take(
        rows.filter((r) => r.tenantId === tenantId),
        limit,
      ),
  });
}

export function createInMemoryOutputFilterRepo(): OutputFilterBlockRepository {
  const rows: OutputFilterBlock[] = [];
  return Object.freeze({
    insertMany: async (newRows: ReadonlyArray<OutputFilterBlock>) => {
      for (const r of newRows) rows.unshift(r);
    },
    latestForTenant: async (tenantId: string, limit: number) =>
      take(
        rows.filter((r) => r.tenantId === tenantId),
        limit,
      ),
  });
}

export function createInMemorySignalRepo(): AgentSecuritySignalRepository {
  const rows: AgentSecuritySignal[] = [];
  return Object.freeze({
    insert: async (row: AgentSecuritySignal) => {
      rows.unshift(row);
    },
    latestForTenant: async (tenantId: string, limit: number) =>
      take(
        rows.filter((r) => r.tenantId === tenantId),
        limit,
      ),
  });
}

export function createInMemoryRedTeamRepo(): RedTeamRunRepository {
  const rows: RedTeamRun[] = [];
  return Object.freeze({
    insert: async (row: RedTeamRun) => {
      rows.unshift(row);
    },
    latestForTenant: async (tenantId: string, limit: number) =>
      take(
        rows.filter((r) => r.tenantId === tenantId),
        limit,
      ),
    latestHashForTenant: async (tenantId: string) => {
      const latest = rows.find((r) => r.tenantId === tenantId);
      return latest === undefined ? null : latest.auditHash;
    },
  });
}
