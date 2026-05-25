import { describe, expect, it, vi } from 'vitest';

import {
  AggregateCleanupError,
  createSandbox,
} from './create-sandbox.js';
import {
  SandboxAlreadyCleanedError,
  type DaytonaAdapter,
  type GitWorktreeAdapter,
} from './types.js';
import { withSandbox } from './with-sandbox.js';

function mkGit(): GitWorktreeAdapter {
  return {
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
  };
}

function mkDaytona(): DaytonaAdapter {
  return {
    createContainer: vi.fn(async () => ({ containerId: 'container-1' })),
    destroyContainer: vi.fn(async () => {}),
  };
}

describe('worktree-sandbox — createSandbox', () => {
  it('creates a worktree-only sandbox by default', async () => {
    const git = mkGit();
    const sb = await createSandbox(
      { taskId: 'abc', baseBranch: 'main', allowedGlobs: ['x/**'] },
      { git },
    );
    expect(sb.taskId).toBe('abc');
    expect(sb.branch).toBe('claude/abc');
    expect(sb.cwd).toContain('abc');
    expect(sb.daytonaContainerId).toBeUndefined();
    expect(sb.state).toBe('ready');
    expect(git.add).toHaveBeenCalledOnce();
    await sb.cleanup();
    expect(git.remove).toHaveBeenCalledOnce();
    expect(sb.state).toBe('cleaned');
  });

  it('creates a Daytona-layered sandbox when useDaytona=true', async () => {
    const git = mkGit();
    const daytona = mkDaytona();
    const sb = await createSandbox(
      { taskId: 'd1', baseBranch: 'main', allowedGlobs: ['x/**'], useDaytona: true },
      { git, daytona },
    );
    expect(sb.daytonaContainerId).toBe('container-1');
    expect(daytona.createContainer).toHaveBeenCalledOnce();
    await sb.cleanup();
    expect(daytona.destroyContainer).toHaveBeenCalledWith('container-1');
  });

  it('throws if useDaytona=true but no adapter provided', async () => {
    const git = mkGit();
    await expect(
      createSandbox(
        { taskId: 'd1', baseBranch: 'main', allowedGlobs: [], useDaytona: true },
        { git },
      ),
    ).rejects.toThrow(/no Daytona adapter/);
  });

  it('refuses to cleanup twice', async () => {
    const git = mkGit();
    const sb = await createSandbox(
      { taskId: 'x', baseBranch: 'main', allowedGlobs: [] },
      { git },
    );
    await sb.cleanup();
    await expect(sb.cleanup()).rejects.toThrow(SandboxAlreadyCleanedError);
  });

  it('rolls back the worktree if Daytona container fails to come up', async () => {
    const git = mkGit();
    const daytona: DaytonaAdapter = {
      createContainer: vi.fn(async () => {
        throw new Error('daytona-down');
      }),
      destroyContainer: vi.fn(async () => {}),
    };
    await expect(
      createSandbox(
        { taskId: 'rb', baseBranch: 'main', allowedGlobs: [], useDaytona: true },
        { git, daytona },
      ),
    ).rejects.toThrow(/daytona-down/);
    expect(git.remove).toHaveBeenCalledOnce();
  });

  it('cleanup aggregates errors from both layers and rethrows', async () => {
    const git: GitWorktreeAdapter = {
      add: vi.fn(async () => {}),
      remove: vi.fn(async () => {
        throw new Error('git-failed');
      }),
      exists: vi.fn(async () => true),
    };
    const daytona: DaytonaAdapter = {
      createContainer: vi.fn(async () => ({ containerId: 'c2' })),
      destroyContainer: vi.fn(async () => {
        throw new Error('daytona-failed');
      }),
    };
    const sb = await createSandbox(
      { taskId: 't', baseBranch: 'main', allowedGlobs: [], useDaytona: true },
      { git, daytona },
    );
    await expect(sb.cleanup()).rejects.toBeInstanceOf(AggregateCleanupError);
    expect(sb.state).toBe('errored');
  });
});

describe('worktree-sandbox — withSandbox always cleans up', () => {
  it('runs cleanup on body success', async () => {
    const git = mkGit();
    let cleaned = false;
    const captured = await withSandbox(
      { taskId: 's', baseBranch: 'main', allowedGlobs: [] },
      async (sb) => {
        // simulate work
        expect(sb.state).toBe('ready');
        return 42;
      },
      { git },
    );
    expect(captured).toBe(42);
    cleaned = true;
    expect(cleaned).toBe(true); // tautology: this proves the await unblocked
    expect(git.remove).toHaveBeenCalledOnce();
  });

  it('runs cleanup even when body throws', async () => {
    const git = mkGit();
    await expect(
      withSandbox(
        { taskId: 's2', baseBranch: 'main', allowedGlobs: [] },
        async () => {
          throw new Error('body-failure');
        },
        { git },
      ),
    ).rejects.toThrow(/body-failure/);
    expect(git.remove).toHaveBeenCalledOnce();
  });
});
