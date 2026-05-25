/**
 * spawnSubAgent — the per-query subagent factory.
 *
 * Enforces the four pillars of the isolation contract:
 *   1. Fresh context — subagent receives only its own system prompt + the
 *      caller-supplied prompt + structured input. No parent history leaks.
 *   2. Tool allowlist enforced — the runner is invoked with the spec's
 *      `allowed_tools` only; any attempt to call an unlisted tool errors.
 *   3. No nested subagents — `Agent` / `Task` tools rejected at spec
 *      validation; cannot appear in `allowed_tools`.
 *   4. Only the typed result returns — parent never sees the transcript.
 *
 * The runner is injected (`SubAgentRunner`) so production wires this to the
 * Claude Agent SDK while tests use a deterministic in-memory stub. This
 * keeps the package free of SDK runtime dependencies.
 */

import type {
  SubAgentSpec,
  SubAgentInput,
  SubAgentResult,
  WorktreeIsolation,
} from './types.js';

/**
 * Pluggable runner. Production wires this to `query()` from the Claude
 * Agent SDK; tests use a deterministic stub.
 *
 * IMPORTANT: implementations MUST treat `prompt` and `structured_input` as
 * the SOLE inputs to the subagent. They MUST NOT inject any other context
 * (no parent CLAUDE.md content, no parent history). The isolation contract
 * lives in the runner just as much as in the spec.
 */
export interface SubAgentRunner {
  run<TOutput = unknown, TStructured = unknown>(args: {
    spec: SubAgentSpec;
    input: SubAgentInput<TStructured>;
  }): Promise<SubAgentResult<TOutput>>;
}

/**
 * Optional worktree manager — abstracted so tests don't have to fork git.
 * Production wires this to a real git-worktree helper.
 */
export interface WorktreeManager {
  create(iso: WorktreeIsolation): Promise<{ readonly path: string }>;
  remove(iso: WorktreeIsolation): Promise<void>;
}

const FORBIDDEN_TOOL_NAMES: ReadonlyArray<string> = ['Agent', 'Task'];

/**
 * Validate a spec at construction time. Throws on contract violations.
 * Pure function (no side effects).
 */
export function validateSubAgentSpec(spec: SubAgentSpec): void {
  if (spec.isolated_context !== true) {
    throw new Error(
      `[subagent-spawn] spec "${spec.name}" must have isolated_context: true (isolation is non-optional)`
    );
  }
  if (spec.max_turns <= 0 || !Number.isFinite(spec.max_turns)) {
    throw new Error(
      `[subagent-spawn] spec "${spec.name}" max_turns must be a positive finite number`
    );
  }
  if (!spec.system_prompt.trim()) {
    throw new Error(`[subagent-spawn] spec "${spec.name}" system_prompt cannot be empty`);
  }
  if (spec.allowed_tools.length === 0) {
    throw new Error(
      `[subagent-spawn] spec "${spec.name}" allowed_tools cannot be empty (use ['Read'] for read-only)`
    );
  }
  for (const tool of spec.allowed_tools) {
    if (FORBIDDEN_TOOL_NAMES.includes(tool)) {
      throw new Error(
        `[subagent-spawn] spec "${spec.name}" cannot include "${tool}" — nested subagents are forbidden`
      );
    }
  }
  // Names must be unique slugs so they can be referenced from a SpecMap.
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(spec.name)) {
    throw new Error(
      `[subagent-spawn] spec name "${spec.name}" must match /^[a-z][a-z0-9_-]{0,63}$/i`
    );
  }
}

/**
 * Spawn a subagent. Returns ONLY the typed result; parent context is
 * untouched. If worktree isolation is requested, create+cleanup is handled
 * around the runner invocation.
 */
export async function spawnSubAgent<TOutput = unknown, TStructured = unknown>(args: {
  readonly spec: SubAgentSpec;
  readonly input: SubAgentInput<TStructured>;
  readonly runner: SubAgentRunner;
  readonly worktreeManager?: WorktreeManager;
}): Promise<SubAgentResult<TOutput>> {
  validateSubAgentSpec(args.spec);

  const needsWorktree = args.spec.worktree_isolation !== undefined;
  if (needsWorktree && !args.worktreeManager) {
    throw new Error(
      `[subagent-spawn] spec "${args.spec.name}" requires worktree_isolation but no worktreeManager was provided`
    );
  }

  let worktreePath: string | undefined;
  if (needsWorktree && args.worktreeManager && args.spec.worktree_isolation) {
    const created = await args.worktreeManager.create(args.spec.worktree_isolation);
    worktreePath = created.path;
  }

  try {
    const result = await args.runner.run<TOutput, TStructured>({
      spec: args.spec,
      input: args.input,
    });
    return result;
  } finally {
    if (
      needsWorktree &&
      args.worktreeManager &&
      args.spec.worktree_isolation &&
      args.spec.worktree_isolation.cleanup_on_exit
    ) {
      // Best-effort cleanup; do not mask the underlying error.
      try {
        await args.worktreeManager.remove(args.spec.worktree_isolation);
      } catch (cleanupError) {
        // eslint-disable-next-line no-console
        console.error('[subagent-spawn] worktree cleanup failed', cleanupError);
      }
      void worktreePath; // referenced for diagnostics; suppress unused
    }
  }
}

/**
 * Resolve a spec from a SubAgentSpecMap by name. Returns null if absent so
 * the caller can decide between fallback or hard fail.
 */
export function resolveSpec(
  specs: Readonly<Record<string, SubAgentSpec>>,
  name: string
): SubAgentSpec | null {
  const spec = specs[name];
  return spec ?? null;
}
