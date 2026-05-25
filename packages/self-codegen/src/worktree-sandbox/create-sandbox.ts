/**
 * createSandbox — Layer 1 (worktree) + optional Layer 2 (Daytona).
 *
 * Both layers register cleanup with `try/finally`. Cleanup MUST always
 * complete — like K-C's pattern, we run cleanup even when an error is in
 * flight, and we never leak worktrees.
 */

import path from 'node:path';

import {
  SandboxAlreadyCleanedError,
  type DaytonaAdapter,
  type GitWorktreeAdapter,
  type Sandbox,
  type SandboxRequest,
  type SandboxState,
} from './types.js';

const TZ_REGION = 'af-east-1-tz';
const DEFAULT_DAYTONA_IMAGE = 'borjie/self-codegen:latest';

export interface CreateSandboxDeps {
  git: GitWorktreeAdapter;
  daytona?: DaytonaAdapter;
}

export async function createSandbox(
  request: SandboxRequest,
  deps?: CreateSandboxDeps,
): Promise<Sandbox> {
  const git = deps?.git ?? defaultGitAdapter();
  const daytona = deps?.daytona;
  const worktreeRoot = request.worktreeRoot ?? '.claude/worktrees';
  const worktreePath = path.join(worktreeRoot, request.taskId);
  const branch = `claude/${request.taskId}`;

  let state: SandboxState = 'pending';
  let containerId: string | undefined;

  try {
    await git.add({ path: worktreePath, branch, baseBranch: request.baseBranch });
    if (request.useDaytona === true) {
      if (!daytona) {
        throw new Error(
          'Sandbox requested useDaytona=true but no Daytona adapter was provided.',
        );
      }
      const c = await daytona.createContainer({
        taskId: request.taskId,
        region: TZ_REGION,
        image: DEFAULT_DAYTONA_IMAGE,
      });
      containerId = c.containerId;
    }
    state = 'ready';
  } catch (e) {
    state = 'errored';
    // Best-effort cleanup of partial state.
    await safeRemove(git, worktreePath);
    if (containerId !== undefined && daytona) {
      await safeDestroy(daytona, containerId);
    }
    throw e;
  }

  let cleanedOnce = false;

  const sandbox: Sandbox = {
    taskId: request.taskId,
    cwd: worktreePath,
    branch,
    worktreePath,
    ...(containerId !== undefined ? { daytonaContainerId: containerId } : {}),
    get state(): SandboxState {
      return state;
    },
    cleanup: async (): Promise<void> => {
      if (cleanedOnce) {
        throw new SandboxAlreadyCleanedError(request.taskId);
      }
      cleanedOnce = true;
      state = 'cleaning';
      // Cleanup must NEVER throw silently — but it should also do both
      // tries even if one fails. So gather errors and rethrow the last.
      const errors: Error[] = [];
      try {
        await git.remove({ path: worktreePath, force: true });
      } catch (e) {
        errors.push(e as Error);
      }
      if (containerId !== undefined && daytona) {
        try {
          await daytona.destroyContainer(containerId);
        } catch (e) {
          errors.push(e as Error);
        }
      }
      state = errors.length > 0 ? 'errored' : 'cleaned';
      if (errors.length > 0) {
        throw new AggregateCleanupError(errors);
      }
    },
  };

  return sandbox;
}

async function safeRemove(git: GitWorktreeAdapter, p: string): Promise<void> {
  try {
    if (await git.exists(p)) await git.remove({ path: p, force: true });
  } catch {
    // swallow — best-effort only
  }
}

async function safeDestroy(d: DaytonaAdapter, id: string): Promise<void> {
  try {
    await d.destroyContainer(id);
  } catch {
    // swallow
  }
}

export class AggregateCleanupError extends Error {
  public readonly errors: readonly Error[];
  public constructor(errors: readonly Error[]) {
    super(
      `Sandbox cleanup encountered ${errors.length} error(s): ` +
        errors.map((e) => e.message).join(' | '),
    );
    this.name = 'AggregateCleanupError';
    this.errors = errors;
  }
}

/**
 * Default Node git adapter — uses child_process. In tests we always inject
 * a mock so this never runs. Kept simple on purpose.
 */
export function defaultGitAdapter(): GitWorktreeAdapter {
  return {
    add: async () => {
      throw new Error(
        'defaultGitAdapter.add — pass a real adapter; this default is a placeholder.',
      );
    },
    remove: async () => {
      throw new Error(
        'defaultGitAdapter.remove — pass a real adapter; this default is a placeholder.',
      );
    },
    exists: async () => false,
  };
}
