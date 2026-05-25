/**
 * PostToolUse: audit-emission hook — emits a structured audit row for
 * every dispatched tool call (success OR failure). The audit sink port
 * is injectable so production wires the sovereign-action-ledger and
 * tests use an in-memory sink.
 *
 * Always returns `allow` — the hook is observation-only. Errors raised
 * by the sink are caught so an audit-pipeline outage cannot block the
 * orchestrator's progress.
 */

import type { Decision, DispatchResult } from '../../decision.js';
import type {
  HookContext,
  HookResult,
  PostToolUseHook,
} from '../../hook-chain.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface AuditEmissionRow {
  readonly threadId: string;
  readonly toolName: string;
  readonly callId: string;
  readonly outcome: 'ok' | 'error';
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usdCost: number;
  readonly errorMessage: string | null;
  readonly capturedAt: string;
}

export interface AuditEmissionSink {
  record(row: AuditEmissionRow): Promise<void>;
}

export interface AuditEmissionHookDeps {
  readonly sink: AuditEmissionSink;
  readonly clock?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createAuditEmissionHook(
  deps: AuditEmissionHookDeps,
): PostToolUseHook {
  const clock = deps.clock ?? (() => new Date());
  return {
    name: 'audit-emission',
    stage: 'post-tool-use',
    async fn(
      ctx: HookContext,
      decision: Decision,
      result: DispatchResult,
    ): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      if (result.kind !== 'tool_ok' && result.kind !== 'tool_error') {
        return { kind: 'allow' };
      }
      const row: AuditEmissionRow = {
        threadId: ctx.threadId,
        toolName: decision.call.toolName,
        callId: decision.call.callId,
        outcome: result.kind === 'tool_ok' ? 'ok' : 'error',
        latencyMs: result.latencyMs,
        tokensIn: result.kind === 'tool_ok' ? result.tokensIn : 0,
        tokensOut: result.kind === 'tool_ok' ? result.tokensOut : 0,
        usdCost: result.kind === 'tool_ok' ? result.usdCost : 0,
        errorMessage: result.kind === 'tool_error' ? result.message : null,
        capturedAt: clock().toISOString(),
      };
      try {
        await deps.sink.record(row);
      } catch {
        // Audit sink outages must NEVER block the loop. Composition
        // root binds an OTel counter for sink-failure visibility.
      }
      return { kind: 'allow' };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory sink fixture
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryAuditEmissionSink extends AuditEmissionSink {
  readonly rows: ReadonlyArray<AuditEmissionRow>;
}

export function createInMemoryAuditEmissionSink(): InMemoryAuditEmissionSink {
  const rows: AuditEmissionRow[] = [];
  return {
    async record(row: AuditEmissionRow): Promise<void> {
      rows.push(row);
    },
    get rows(): ReadonlyArray<AuditEmissionRow> {
      return rows;
    },
  };
}
