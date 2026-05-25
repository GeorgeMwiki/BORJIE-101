/**
 * Reflexion recorder — LITFIN-style verbal RL ingestion path.
 *
 * After a task completes (success or failure) the agent writes a
 * self-critique that's prepended to its next iteration's prompt.
 * This file is the WRITE side of that loop, complementing the existing
 * session-scoped `reflexion-writer.ts`.
 *
 * Key differences from `reflexion-writer.ts`:
 *   - Keyed on `taskId` (cron / agent pipelines) rather than
 *     `(userId, sessionId)`.
 *   - Accepts the literal `critique` text from the caller (the agent has
 *     already composed the self-review); we don't synthesise it from
 *     bullets.
 *   - Carries an explicit `importance` in 0..1 so pass-4 (prune-stale)
 *     can keep high-importance lessons past their normal age-out window.
 *
 * The two writers share the same `reflexion_buffer` table — the
 * session-end writer fills (session_id, outcome, reflection) and the
 * task-end recorder additionally fills (task_id, importance). Either
 * path produces rows the 4-pass nightly sleep consolidation can ingest.
 */

import type { ReflexionOutcome } from './reflexion-writer.js';

/**
 * Port shape — independent of `ReflexionWriterPort` because the recorder
 * needs to write `taskId` + `importance` which the session writer
 * doesn't expose. Implemented by the database adapter at composition
 * time (`packages/database/src/adapters/reflexion-buffer-adapter.ts` or
 * equivalent).
 */
export interface ReflexionRecorderPort {
  record(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly taskId: string;
    readonly reflection: string;
    readonly outcome: ReflexionOutcome;
    readonly importance: number;
  }): Promise<{ id: string }>;
}

export interface RecordReflexionArgs {
  readonly tenantId: string;
  /**
   * The task handle the agent assigns when it kicks off the work.
   * Stable across retries — multiple attempts on the same task write
   * multiple rows, joined by `task_id`.
   */
  readonly taskId: string;
  /** True = task succeeded, false = task failed. */
  readonly success: boolean;
  /** The agent's self-critique. Capped at 4 000 chars by the recorder. */
  readonly critique: string;
  /**
   * 0..1 importance. Clamped on the way in. Defaults to 0.5 — a
   * mid-tier lesson that gets normal age-out treatment from pass-4.
   */
  readonly importance?: number;
  /**
   * Optional. When the task is bound to a known user (e.g. tenant
   * agent running a request on their behalf), pass it through so the
   * loader can scope recall by user. Defaults to `system`.
   */
  readonly userId?: string;
  /**
   * Optional. Defaults to `taskId` when the task isn't running inside a
   * user session.
   */
  readonly sessionId?: string;
}

const MAX_CRITIQUE_CHARS = 4_000;

/**
 * Persist one task-end reflexion. Returns the new row id, or `null` on
 * validation failure / port error. The recorder is best-effort: a
 * write failure must never break the parent agent loop.
 */
export async function recordReflexion(
  port: ReflexionRecorderPort,
  args: RecordReflexionArgs,
): Promise<string | null> {
  if (!args.tenantId || !args.taskId) return null;
  const critique = (args.critique ?? '').trim();
  if (!critique) return null;

  const outcome: ReflexionOutcome = args.success ? 'success' : 'failure';
  const importance = clamp01(args.importance ?? 0.5);
  const userId = (args.userId ?? '').trim() || 'system';
  const sessionId = (args.sessionId ?? '').trim() || args.taskId;
  const body = truncate(critique, MAX_CRITIQUE_CHARS);

  try {
    const out = await port.record({
      tenantId: args.tenantId,
      userId,
      sessionId,
      taskId: args.taskId,
      reflection: body,
      outcome,
      importance,
    });
    return out?.id ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (small + exported so the consolidator can reuse them).
// ─────────────────────────────────────────────────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
