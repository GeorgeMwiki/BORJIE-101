import { describe, expect, it, vi } from 'vitest';

import {
  assertPlanPhaseToolAllowed,
  createReadOnlyContext,
  isReadOnlyBashCommand,
  runPlanPhase,
} from './plan-phase.js';
import { PlanPhaseReadOnlyViolation, type EditableSpec } from './types.js';

const stubExecutor = {
  read: vi.fn(async (_p: string) => 'file contents'),
  grep: vi.fn(async (_p: string, _s?: string) => ['hit1', 'hit2'] as const),
  glob: vi.fn(async (_p: string) => ['file-a.ts', 'file-b.ts'] as const),
  bash: vi.fn(async (cmd: string) => `ran: ${cmd}`),
};

describe('plan-phase — createReadOnlyContext', () => {
  it('exposes read/grep/glob/bashReadOnly and freezes the object', () => {
    const ctx = createReadOnlyContext(stubExecutor);
    expect(ctx.mode).toBe('plan');
    expect(ctx.model).toBe('claude-opus-4-7');
    expect(typeof ctx.read).toBe('function');
    expect(typeof ctx.grep).toBe('function');
    expect(typeof ctx.glob).toBe('function');
    expect(typeof ctx.bashReadOnly).toBe('function');
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it('does NOT expose write/edit/delete (type-level guarantee)', () => {
    const ctx = createReadOnlyContext(stubExecutor) as unknown as Record<
      string,
      unknown
    >;
    expect(ctx.write).toBeUndefined();
    expect(ctx.edit).toBeUndefined();
    expect(ctx.delete).toBeUndefined();
  });

  it('routes read/grep/glob to the backing executor', async () => {
    const ctx = createReadOnlyContext(stubExecutor);
    await ctx.read('a/b.ts');
    await ctx.grep('foo', 'src/');
    await ctx.glob('**/*.ts');
    expect(stubExecutor.read).toHaveBeenCalledWith('a/b.ts');
    expect(stubExecutor.grep).toHaveBeenCalledWith('foo', 'src/');
    expect(stubExecutor.glob).toHaveBeenCalledWith('**/*.ts');
  });

  it('allows safe read-only bash commands', async () => {
    const ctx = createReadOnlyContext(stubExecutor);
    await expect(ctx.bashReadOnly('ls -la')).resolves.toContain('ran:');
    await expect(ctx.bashReadOnly('git status')).resolves.toContain('ran:');
    await expect(ctx.bashReadOnly('cat package.json')).resolves.toContain('ran:');
  });

  it('rejects mutating bash commands with PlanPhaseReadOnlyViolation', async () => {
    const ctx = createReadOnlyContext(stubExecutor);
    const tries = [
      'rm -rf node_modules',
      'mv a b',
      'cp -r a b',
      'git commit -m "x"',
      'git push origin main',
      'git reset --hard',
      'npm install foo',
      'pnpm add foo',
      'echo "x" > file',
      'echo "x" >> file',
      'sed -i s/x/y/ file',
      'chmod +x script.sh',
    ];
    for (const cmd of tries) {
      await expect(ctx.bashReadOnly(cmd)).rejects.toThrow(
        PlanPhaseReadOnlyViolation,
      );
    }
  });
});

describe('plan-phase — isReadOnlyBashCommand', () => {
  it('returns true for clearly read-only commands', () => {
    expect(isReadOnlyBashCommand('ls')).toBe(true);
    expect(isReadOnlyBashCommand('cat foo')).toBe(true);
    expect(isReadOnlyBashCommand('grep -r foo .')).toBe(true);
    expect(isReadOnlyBashCommand('git diff HEAD')).toBe(true);
    expect(isReadOnlyBashCommand('find . -name foo')).toBe(true);
  });

  it('returns false for mutating commands', () => {
    expect(isReadOnlyBashCommand('rm file')).toBe(false);
    expect(isReadOnlyBashCommand('git push')).toBe(false);
    expect(isReadOnlyBashCommand('npm install')).toBe(false);
  });
});

describe('plan-phase — assertPlanPhaseToolAllowed', () => {
  it('throws on Write/Edit/Delete and other mutating tools', () => {
    for (const tool of ['Write', 'Edit', 'Delete', 'Bash', 'NotebookEdit', 'MultiEdit']) {
      expect(() => assertPlanPhaseToolAllowed(tool, '/a.ts')).toThrow(
        PlanPhaseReadOnlyViolation,
      );
    }
  });

  it('is a noop for read-only tools', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'BashReadOnly']) {
      expect(() => assertPlanPhaseToolAllowed(tool, '/a.ts')).not.toThrow();
    }
  });
});

describe('plan-phase — runPlanPhase', () => {
  const validSpec: EditableSpec = {
    summary: 'fix(m-pesa): raise backoff cap to 30s',
    riskTier: 'medium',
    steps: ['read retry.ts', 'patch cap'],
    affectedPaths: ['packages/connectors/m-pesa/retry.ts'],
    estimatedDiffLoc: 120,
    estimatedTokens: 80_000,
    requiredCodeOwners: ['@finance-lead'],
  };

  it('returns a frozen spec from a well-behaved planner', async () => {
    const ctx = createReadOnlyContext(stubExecutor);
    const planner = vi.fn(async () => validSpec);
    const result = await runPlanPhase(
      {
        task: 't',
        allowedGlobs: ['packages/connectors/m-pesa/**'],
        repo: { url: 'r', baseBranch: 'main' },
      },
      ctx,
      planner,
    );
    expect(result.summary).toBe(validSpec.summary);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('throws if the context is widened to a non-plan mode', async () => {
    const fakeCtx = { ...createReadOnlyContext(stubExecutor), mode: 'execute' } as unknown as Parameters<
      typeof runPlanPhase
    >[1];
    await expect(
      runPlanPhase(
        { task: 't', allowedGlobs: [], repo: { url: 'r', baseBranch: 'main' } },
        fakeCtx,
        async () => validSpec,
      ),
    ).rejects.toThrow(PlanPhaseReadOnlyViolation);
  });

  it('throws if the planner returns an invalid spec', async () => {
    const ctx = createReadOnlyContext(stubExecutor);
    await expect(
      runPlanPhase(
        { task: 't', allowedGlobs: [], repo: { url: 'r', baseBranch: 'main' } },
        ctx,
        async () => undefined as unknown as EditableSpec,
      ),
    ).rejects.toThrow(/invalid spec/);
  });

  it('propagates a write attempt as PlanPhaseReadOnlyViolation', async () => {
    const ctx = createReadOnlyContext(stubExecutor);
    const evilPlanner = async (): Promise<EditableSpec> => {
      // Simulate a planner that tries to mutate via raw bash.
      await ctx.bashReadOnly('rm -rf /');
      return validSpec;
    };
    await expect(
      runPlanPhase(
        {
          task: 't',
          allowedGlobs: ['x/**'],
          repo: { url: 'r', baseBranch: 'main' },
        },
        ctx,
        evilPlanner,
      ),
    ).rejects.toThrow(PlanPhaseReadOnlyViolation);
  });
});
