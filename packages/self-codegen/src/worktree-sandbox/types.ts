/**
 * Worktree sandbox types.
 *
 * Pattern #2 + #9 from R-CODEGEN: `git worktree` file isolation, layered with
 * optional Daytona container for process isolation in the TZ region.
 *
 * Cleanup is mandatory and always runs in a `finally` block. The sandbox
 * tracks its lifecycle state so callers can detect double-cleanup.
 */

export type SandboxState = 'pending' | 'ready' | 'cleaning' | 'cleaned' | 'errored';

export interface SandboxRequest {
  readonly taskId: string;
  readonly baseBranch: string;
  readonly allowedGlobs: readonly string[];
  /** Opt-in process isolation via Daytona container. */
  readonly useDaytona?: boolean;
  /** Override the default `.claude/worktrees` parent dir. */
  readonly worktreeRoot?: string;
}

export interface Sandbox {
  readonly taskId: string;
  readonly cwd: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly daytonaContainerId?: string;
  readonly state: SandboxState;
  cleanup(): Promise<void>;
}

export interface GitWorktreeAdapter {
  add(args: { path: string; branch: string; baseBranch: string }): Promise<void>;
  remove(args: { path: string; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface DaytonaAdapter {
  createContainer(args: {
    taskId: string;
    region: string;
    image: string;
  }): Promise<{ containerId: string }>;
  destroyContainer(containerId: string): Promise<void>;
}

export class SandboxAlreadyCleanedError extends Error {
  public constructor(taskId: string) {
    super(`Sandbox "${taskId}" already cleaned — double cleanup not allowed.`);
    this.name = 'SandboxAlreadyCleanedError';
  }
}
