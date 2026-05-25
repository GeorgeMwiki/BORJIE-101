/**
 * @borjie/skill-library/subagent-spawn — public API.
 *
 * R1 #7 closure: per-query programmatic subagents with full isolation
 * contract (fresh context, tool allowlist, no nested spawning, typed result).
 */

export type {
  SubAgentSpec,
  SubAgentSpecMap,
  SubAgentInput,
  SubAgentResult,
  WorktreeIsolation,
} from './types.js';

export {
  spawnSubAgent,
  validateSubAgentSpec,
  resolveSpec,
  type SubAgentRunner,
  type WorktreeManager,
} from './spawn.js';

export {
  InMemorySubAgentRunner,
  type RunnerInvocation,
  type InMemorySubAgentRunnerOptions,
} from './in-memory-runner.js';

export { InMemoryWorktreeManager, type WorktreeEvent } from './in-memory-worktree.js';
