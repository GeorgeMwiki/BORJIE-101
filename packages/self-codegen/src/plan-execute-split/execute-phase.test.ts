import { describe, expect, it, vi } from 'vitest';

import {
  createWriteContext,
  globToRegex,
  pathMatchesAllowedGlobs,
  runExecutePhase,
} from './execute-phase.js';
import { type EditableSpec, type ExecutionResult } from './types.js';

describe('execute-phase — globToRegex', () => {
  it('matches **/file.ts patterns', () => {
    expect(globToRegex('packages/**/m-pesa/**').test('packages/x/m-pesa/y/z.ts')).toBe(
      true,
    );
    expect(globToRegex('packages/**/m-pesa/**').test('packages/m-pesa.ts')).toBe(false);
  });

  it('matches single segment *', () => {
    expect(globToRegex('src/*.ts').test('src/foo.ts')).toBe(true);
    expect(globToRegex('src/*.ts').test('src/sub/foo.ts')).toBe(false);
  });
});

describe('execute-phase — pathMatchesAllowedGlobs', () => {
  it('returns false when allowedGlobs is empty', () => {
    expect(pathMatchesAllowedGlobs('a.ts', [])).toBe(false);
  });

  it('matches any of the allowed globs', () => {
    expect(
      pathMatchesAllowedGlobs('packages/connectors/m-pesa/retry.ts', [
        'packages/connectors/m-pesa/**',
      ]),
    ).toBe(true);
    expect(
      pathMatchesAllowedGlobs('packages/connectors/airtel/retry.ts', [
        'packages/connectors/m-pesa/**',
      ]),
    ).toBe(false);
  });
});

describe('execute-phase — createWriteContext', () => {
  const exec = {
    read: vi.fn(async (_p: string) => 'src'),
    write: vi.fn(async (_p: string, _c: string) => {}),
    edit: vi.fn(async (_p: string, _o: string, _n: string) => {}),
    bash: vi.fn(async (cmd: string) => `ran: ${cmd}`),
  };

  it('frozen and execute mode', () => {
    const ctx = createWriteContext({
      cwd: '/tmp/worktree',
      allowedGlobs: ['x/**'],
      executor: exec,
    });
    expect(ctx.mode).toBe('execute');
    expect(ctx.model).toBe('claude-sonnet-4-7');
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it('rejects writes outside allowedGlobs', async () => {
    const ctx = createWriteContext({
      cwd: '/tmp/worktree',
      allowedGlobs: ['x/**'],
      executor: exec,
    });
    await expect(ctx.write('y/foo.ts', 'hello')).rejects.toThrow(/outside allowedGlobs/);
    await expect(ctx.edit('y/foo.ts', 'a', 'b')).rejects.toThrow(/outside allowedGlobs/);
  });

  it('rejects path traversal', async () => {
    const ctx = createWriteContext({
      cwd: '/tmp/worktree',
      allowedGlobs: ['x/**'],
      executor: exec,
    });
    await expect(ctx.write('x/../etc/passwd', 'hello')).rejects.toThrow(/traversal/);
  });

  it('accepts writes inside allowedGlobs', async () => {
    const ctx = createWriteContext({
      cwd: '/tmp/worktree',
      allowedGlobs: ['x/**'],
      executor: exec,
    });
    await ctx.write('x/a.ts', 'hello');
    expect(exec.write).toHaveBeenCalledWith('x/a.ts', 'hello');
  });
});

describe('execute-phase — runExecutePhase', () => {
  const exec = {
    read: vi.fn(async (_p: string) => 'src'),
    write: vi.fn(async (_p: string, _c: string) => {}),
    edit: vi.fn(async (_p: string, _o: string, _n: string) => {}),
    bash: vi.fn(async (_c: string) => 'ok'),
  };

  const spec: EditableSpec = {
    summary: 'x',
    riskTier: 'low',
    steps: [],
    affectedPaths: [],
    estimatedDiffLoc: 0,
    estimatedTokens: 0,
    requiredCodeOwners: [],
  };

  const goodResult: ExecutionResult = {
    status: 'success',
    modifiedFiles: ['x/a.ts'],
    tokensUsed: 10_000,
    diffSummary: 'one-liner',
  };

  it('runs the executor with the WriteContext and freezes the result', async () => {
    const ctx = createWriteContext({
      cwd: '/cwd',
      allowedGlobs: ['x/**'],
      executor: exec,
    });
    const out = await runExecutePhase(
      { spec, cwd: '/cwd', allowedGlobs: ['x/**'] },
      ctx,
      async () => goodResult,
    );
    expect(out.status).toBe('success');
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('throws on mismatched cwd', async () => {
    const ctx = createWriteContext({
      cwd: '/cwd-A',
      allowedGlobs: ['x/**'],
      executor: exec,
    });
    await expect(
      runExecutePhase(
        { spec, cwd: '/cwd-B', allowedGlobs: ['x/**'] },
        ctx,
        async () => goodResult,
      ),
    ).rejects.toThrow(/cwd mismatch/);
  });

  it('throws if executor returns invalid result', async () => {
    const ctx = createWriteContext({
      cwd: '/cwd',
      allowedGlobs: ['x/**'],
      executor: exec,
    });
    await expect(
      runExecutePhase(
        { spec, cwd: '/cwd', allowedGlobs: ['x/**'] },
        ctx,
        async () => undefined as unknown as ExecutionResult,
      ),
    ).rejects.toThrow(/invalid result/);
  });
});
