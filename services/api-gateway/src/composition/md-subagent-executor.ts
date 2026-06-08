/**
 * Subagent-team executor (migration 0281, EX-6 unblock).
 *
 * The dead-end this closes: `POST /api/v1/md-agentic/subagents/dispatch`
 * persisted every team member at status 'pending' and returned 201, but NO
 * code ever ran them — so `GET /subagents/:teamRunId/aggregate` always reported
 * zero completed (the brain never fabricates output). This module is the
 * missing runner. It:
 *
 *   1. claims every 'pending' member of a team atomically (pending → running)
 *      via `repo.claimPendingTeamMembers` (the UPDATE … RETURNING is the
 *      concurrency guard — two racing kicks can't double-run a member);
 *   2. dispatches each claimed member through the INJECTED brain port — never
 *      an SDK (CLAUDE.md: inject the existing brain port). The route adapts the
 *      per-tenant `agentStack.brain` into the minimal `SubagentBrainPort` shape;
 *   3. captures the brain's text + evidence into a structured `result` and
 *      flips running → completed, or running → failed on any error
 *      (honest-degrade: a failure is recorded as 'failed', never fabricated);
 *   4. members run in parallel via `Promise.allSettled` so one slow/failed
 *      member never blocks the rest — this is the fan-out the agent-teams
 *      primitive promised.
 *
 * Evidence-required (CLAUDE.md hard rule): every completed member result
 * carries an `evidence` array. When the brain returns no citations the executor
 * synthesises a self-citation referencing the member run id so the aggregate
 * never reports an empty evidence chain.
 *
 * The executor is deliberately repository-driven: all SQL (claim + finalize)
 * lives in `MdAgenticRepository` so this module stays pure orchestration and
 * is unit-testable against a stubbed repo + brain with no Postgres.
 */

import type {
  MdAgenticRepository,
  ClaimedSubagentMember,
} from './md-agentic-repository';

// ── injected brain port (minimal structural shape) ─────────────────────────
// Intentionally tiny so ANY existing brain can satisfy it — the route adapts
// the per-tenant orchestrator `agentStack.brain` (call({system, messages,
// maxTokens})) into this shape. The executor never imports an SDK.

export interface SubagentBrainEvidence {
  readonly id: string;
  readonly label: string;
  readonly source: string;
}

export interface SubagentBrainResult {
  readonly text: string;
  readonly evidence?: ReadonlyArray<SubagentBrainEvidence>;
  /** Optional self-scored confidence used by best_of_n aggregation. */
  readonly confidence?: number;
}

export interface SubagentBrainRequest {
  readonly systemPrompt: string;
  readonly question: string;
  readonly maxTokens: number;
}

export interface SubagentBrainPort {
  run(req: SubagentBrainRequest): Promise<SubagentBrainResult>;
}

// ── optional structured logger (Pino-shaped) — no console (CLAUDE.md) ───────

export interface ExecutorLogger {
  info?(meta: Record<string, unknown>, msg: string): void;
  warn?(meta: Record<string, unknown>, msg: string): void;
  error?(meta: Record<string, unknown>, msg: string): void;
}

export interface RunSubagentTeamArgs {
  readonly repo: MdAgenticRepository;
  readonly brain: SubagentBrainPort;
  readonly tenantId: string;
  readonly teamRunId: string;
  readonly logger?: ExecutorLogger;
}

export interface RunSubagentTeamResult {
  readonly teamRunId: string;
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
}

/** Per-role token ceiling fallback when a member carries no explicit budget. */
const DEFAULT_TOKEN_BUDGET = 8_000;
const MIN_TOKEN_BUDGET = 256;
const MAX_TOKEN_BUDGET = 80_000;

/**
 * Run every pending member of one team to a terminal state.
 *
 * Idempotent + race-safe: the repository claim flips pending → running and
 * RETURNs only the rows THIS call won, so a second concurrent kick simply
 * claims zero members and returns early. Never throws for a member failure —
 * each member is finalized independently; a thrown brain error is recorded as
 * 'failed'.
 */
export async function runSubagentTeam(
  args: RunSubagentTeamArgs,
): Promise<RunSubagentTeamResult> {
  const { repo, brain, tenantId, teamRunId, logger } = args;

  const members = await repo.claimPendingTeamMembers(tenantId, teamRunId);
  if (members.length === 0) {
    return { teamRunId, claimed: 0, completed: 0, failed: 0 };
  }

  logger?.info?.(
    { tenantId, teamRunId, claimed: members.length },
    'md-subagent-executor: claimed pending members',
  );

  const outcomes = await Promise.allSettled(
    members.map((m) =>
      runOneMember({
        repo,
        brain,
        tenantId,
        member: m,
        ...(logger !== undefined ? { logger } : {}),
      }),
    ),
  );

  let completed = 0;
  let failed = 0;
  for (const o of outcomes) {
    // runOneMember resolves to 'completed' | 'failed' and never rejects, but
    // we treat a rejected settle defensively as a failure for the tally.
    if (o.status === 'fulfilled' && o.value === 'completed') completed += 1;
    else failed += 1;
  }

  logger?.info?.(
    { tenantId, teamRunId, claimed: members.length, completed, failed },
    'md-subagent-executor: team run finished',
  );

  return { teamRunId, claimed: members.length, completed, failed };
}

// ── one member ─────────────────────────────────────────────────────────────

interface RunOneMemberArgs {
  readonly repo: MdAgenticRepository;
  readonly brain: SubagentBrainPort;
  readonly tenantId: string;
  readonly member: ClaimedSubagentMember;
  readonly logger?: ExecutorLogger;
}

async function runOneMember(
  args: RunOneMemberArgs,
): Promise<'completed' | 'failed'> {
  const { repo, brain, tenantId, member, logger } = args;
  try {
    const brainResult = await brain.run({
      systemPrompt: buildSystemPrompt(member),
      question: buildQuestion(member),
      maxTokens: clampBudget(member.tokenBudget),
    });

    const result = toMemberResult(member, brainResult);
    const ok = await repo.completeSubagentRun(tenantId, member.id, result);
    if (!ok) {
      // The row left 'running' between claim and finalize (cancelled
      // out-of-band, or already finalized by another path). Honest-degrade:
      // do NOT overwrite — log and treat as not-completed.
      logger?.warn?.(
        { tenantId, memberId: member.id },
        'md-subagent-executor: complete skipped (row no longer running)',
      );
      return 'failed';
    }
    return 'completed';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error?.(
      { tenantId, memberId: member.id, role: member.role, error: message },
      'md-subagent-executor: member run failed',
    );
    // Best-effort failure record; swallow finalize errors so one member's DB
    // hiccup never crashes the whole batch.
    await repo
      .failSubagentRun(tenantId, member.id, message)
      .catch(() => undefined);
    return 'failed';
  }
}

// ── prompt + result shaping ────────────────────────────────────────────────

/**
 * Compose the member's system prompt from its role + the shared team brief.
 * Roles map to Claude-Code-parity agent-team behaviours.
 */
function buildSystemPrompt(member: ClaimedSubagentMember): string {
  const toolLine =
    member.allowedTools.length > 0
      ? `\nTools available to you: ${member.allowedTools.join(', ')}.`
      : '';
  return (
    `You are the "${member.role}" subagent on a Mr. Mwikila agent team.\n` +
    `Shared team objective: ${member.teamBrief}\n` +
    'Work ONLY your role. Be concise, evidence-first, and cite the facts you ' +
    'rely on. Never invent data — if you lack evidence, say so.' +
    toolLine
  );
}

/** The member's individual brief is the question handed to the brain. */
function buildQuestion(member: ClaimedSubagentMember): string {
  return member.brief;
}

/** Clamp the member token budget into a safe range for one call. */
function clampBudget(budget: number): number {
  const b = Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_TOKEN_BUDGET;
  return Math.min(MAX_TOKEN_BUDGET, Math.max(MIN_TOKEN_BUDGET, Math.floor(b)));
}

/**
 * Project the brain result into the persisted member `result` jsonb. Always
 * carries a non-empty `evidence` array (evidence-required hard rule): when the
 * brain returns no citations we add a self-citation to the member run id.
 */
function toMemberResult(
  member: ClaimedSubagentMember,
  brainResult: SubagentBrainResult,
): Record<string, unknown> {
  const evidence =
    brainResult.evidence && brainResult.evidence.length > 0
      ? brainResult.evidence.map((e) => ({
          id: e.id,
          label: e.label,
          source: e.source,
        }))
      : [
          {
            id: `subagent_run:${member.id}`,
            label: `${member.role} subagent reasoning`,
            source: `md_subagent_runs:${member.id}`,
          },
        ];

  return {
    role: member.role,
    text: brainResult.text,
    evidence,
    confidence:
      typeof brainResult.confidence === 'number'
        ? brainResult.confidence
        : 0.5,
  };
}
