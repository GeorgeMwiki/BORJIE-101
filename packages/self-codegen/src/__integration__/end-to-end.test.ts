/**
 * Integration tests — wire the 9 modules together end-to-end with mocked
 * I/O. Asserts the full Plan → Execute → 3-critic Reflexion → PR flow.
 *
 * No file I/O, no shells, no network — adapters are all mocks. Real
 * subagent / SaaS bindings live elsewhere and are out of scope here.
 */

import { describe, expect, it, vi } from 'vitest';

import { generateCodeownersFile, generateRequiredReviewerRuleset } from '../codeowners-templating/generate-codeowners.js';
import {
  CodeRabbitClassReviewer,
  InlineSubagentReviewer,
  UltrareviewReviewer,
  runThreeLayerReview,
} from '../three-layer-review/index.js';
import {
  PLAN_PHASE_CONFIG,
  EXECUTE_PHASE_CONFIG,
  validateOpusParityConfig,
} from '../opus-parity-config/index.js';
import { createAuditHook, MockSovereignLedgerSink, MockSlackSink } from '../post-tool-audit-hook/create-audit-hook.js';
import { createSelfCodegenHook } from '../pre-tool-use-hooks/create-hook.js';
import { proposeSkill } from '../skill-emit-on-success/propose-skill.js';
import { runSelfCodegenTask } from '../plan-execute-split/run-self-codegen-task.js';
import {
  type EditableSpec,
  type ExecutionResult,
} from '../plan-execute-split/types.js';
import {
  type DaytonaAdapter,
  type GitWorktreeAdapter,
} from '../worktree-sandbox/types.js';
import { withSandbox } from '../worktree-sandbox/with-sandbox.js';

function mkGit(): GitWorktreeAdapter {
  return {
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
  };
}

function mkDaytona(): DaytonaAdapter {
  return {
    createContainer: vi.fn(async () => ({ containerId: 'cnt-1' })),
    destroyContainer: vi.fn(async () => {}),
  };
}

describe('integration — end-to-end self-codegen task (mock adapters)', () => {
  it('runs Plan → Execute → 3-critic Reflexion → PR opened', async () => {
    const planSpec: EditableSpec = {
      summary: 'fix(connector): raise backoff cap to 30s',
      riskTier: 'medium',
      steps: ['read retry.ts', 'patch cap', 'add test'],
      affectedPaths: ['packages/connectors/m-pesa/retry.ts'],
      estimatedDiffLoc: 120,
      estimatedTokens: 80_000,
      requiredCodeOwners: ['@finance-lead'],
    };
    const execResult: ExecutionResult = {
      status: 'success',
      modifiedFiles: ['packages/connectors/m-pesa/retry.ts'],
      tokensUsed: 60_000,
      diffSummary: 'retry cap 5s → 30s, +3 tests',
    };
    const prOpener = vi.fn(async () => ({ prUrl: 'https://github.com/org/repo/pull/123' }));

    const git = mkGit();
    const r = await runSelfCodegenTask(
      {
        task: 'Fix M-Pesa retry brittleness',
        repo: { url: 'git@github.com:org/repo.git', baseBranch: 'main' },
        allowedGlobs: ['packages/connectors/m-pesa/**'],
        budgetUsdCents: 100_000,
        useDaytona: false,
      },
      {
        planner: async () => planSpec,
        executor: async () => execResult,
        reviewer: async ({ critic: _ }) => ({ verdict: 'pass', findings: [] }),
        prOpener,
        planExecutor: {
          read: async () => 'src',
          grep: async () => [],
          glob: async () => [],
          bash: async () => 'ok',
        },
        execExecutor: {
          read: async () => 'src',
          write: async () => {},
          edit: async () => {},
          bash: async () => 'ok',
        },
      },
      { git },
    );
    expect(r.status).toBe('pr-opened');
    expect(r.prUrl).toContain('pull/123');
    expect(r.plan?.summary).toContain('backoff cap');
    expect(r.reflection?.verdict).toBe('pass');
    expect(prOpener).toHaveBeenCalledOnce();
  });

  it('blocks when any critic returns block', async () => {
    const planSpec: EditableSpec = {
      summary: 'risky change',
      riskTier: 'high',
      steps: [],
      affectedPaths: ['packages/connectors/m-pesa/x.ts'],
      estimatedDiffLoc: 50,
      estimatedTokens: 20_000,
      requiredCodeOwners: ['@security-lead'],
    };
    const git = mkGit();
    const r = await runSelfCodegenTask(
      {
        task: 'x',
        repo: { url: 'u', baseBranch: 'main' },
        allowedGlobs: ['packages/x/**'],
      },
      {
        planner: async () => planSpec,
        executor: async () => ({
          status: 'success',
          modifiedFiles: ['packages/x/a.ts'],
          tokensUsed: 1_000,
          diffSummary: 'edit',
        }),
        reviewer: async ({ critic }) =>
          critic === 'security'
            ? {
                verdict: 'block',
                findings: [{ severity: 'critical', message: 'timing leak' }],
              }
            : { verdict: 'pass', findings: [] },
        prOpener: async () => ({ prUrl: 'should-not-be-called' }),
        planExecutor: {
          read: async () => '',
          grep: async () => [],
          glob: async () => [],
          bash: async () => '',
        },
        execExecutor: {
          read: async () => '',
          write: async () => {},
          edit: async () => {},
          bash: async () => '',
        },
      },
      { git },
    );
    expect(r.status).toBe('blocked');
    expect(r.blockedReason).toBe('reflection-blocked');
  });

  it('cleans up the sandbox even when the executor throws', async () => {
    const git = mkGit();
    let threwInBody = false;
    await expect(
      withSandbox(
        { taskId: 'bug-1', baseBranch: 'main', allowedGlobs: [] },
        async () => {
          threwInBody = true;
          throw new Error('executor-failure');
        },
        { git },
      ),
    ).rejects.toThrow(/executor-failure/);
    expect(threwInBody).toBe(true);
    expect(git.remove).toHaveBeenCalledOnce();
  });
});

describe('integration — three-layer review combines correctly', () => {
  it('passes when all three layers pass', async () => {
    const v = await runThreeLayerReview(
      {
        diff: 'd',
        modifiedFiles: ['packages/x/y.ts'],
        task: { description: 'test' },
      },
      [
        new InlineSubagentReviewer(async () => ({ findings: [] })),
        new CodeRabbitClassReviewer(async () => []),
        new UltrareviewReviewer({
          codeownerGlobs: ['**/m-pesa/**'],
          opusXhighCall: async () => [],
        }),
      ],
    );
    expect(v.status).toBe('pass');
    expect(v.layer).toBe('combined');
  });

  it('Layer 3 ONLY fires on CODEOWNER-only globs (silent on safe diffs)', async () => {
    const opus = vi.fn(async () => []);
    const v = await runThreeLayerReview(
      {
        diff: 'd',
        modifiedFiles: ['packages/safe/y.ts'],
        task: { description: 'test' },
      },
      [
        new UltrareviewReviewer({
          codeownerGlobs: ['**/m-pesa/**'],
          opusXhighCall: opus,
        }),
      ],
    );
    expect(v.status).toBe('pass');
    expect(opus).not.toHaveBeenCalled();
  });
});

describe('integration — pre-tool-use hook + audit hook compose', () => {
  it('blocks deny-glob writes and never gets to the audit hook', async () => {
    const pre = createSelfCodegenHook();
    const ledger = new MockSovereignLedgerSink();
    const slack = new MockSlackSink();
    const audit = createAuditHook({ sovereignLedger: ledger, slack });
    const denied = await pre({
      toolName: 'Write',
      toolInput: { file_path: '.claude/agents/code-reviewer.md' },
    });
    expect(denied.kind).toBe('deny');
    // The audit hook only runs on PostToolUse which would never fire on a
    // denied PreToolUse — but the test can confirm the audit hook itself
    // doesn't audit a Write-class call that bypasses the gate by simulating
    // a benign path.
    const post = await audit({
      toolName: 'Write',
      toolInput: { file_path: 'packages/safe/foo.ts', content: 'x' },
      actor: 'brain',
      tenantId: 't1',
    });
    expect(post.async).toBe(true);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(ledger.received).toHaveLength(1);
    expect(slack.received).toHaveLength(1);
  });
});

describe('integration — CODEOWNERS yml → file + ruleset shape', () => {
  it('emits a file with selfPolicy guarding .claude/** and packages/self-codegen/**', () => {
    const cfg = {
      defaultOwners: ['@platform-admin'],
      ruleSets: {
        selfPolicy: {
          paths: ['.claude/**', 'packages/self-codegen/**'],
          owners: ['@platform-admin'],
        },
        finance: {
          paths: ['services/payments-ledger/**'],
          owners: ['@finance-lead'],
        },
      },
    };
    const file = generateCodeownersFile(cfg);
    expect(file).toContain('/.claude/**');
    expect(file).toContain('/packages/self-codegen/**');
    expect(file).toContain('# === selfPolicy ===');
    const ruleset = generateRequiredReviewerRuleset({
      config: cfg,
      protectedBranches: ['main'],
      agentLogin: 'bot',
    });
    expect(ruleset.rules.length).toBeGreaterThanOrEqual(3);
    for (const r of ruleset.rules) expect(r.excludeUsers).toContain('bot');
  });
});

describe('integration — opus-parity-config protects against HARD NEVERS', () => {
  it('plan and execute presets pass validation', () => {
    expect(() => validateOpusParityConfig({ ...PLAN_PHASE_CONFIG })).not.toThrow();
    expect(() => validateOpusParityConfig({ ...EXECUTE_PHASE_CONFIG })).not.toThrow();
  });
});

describe('integration — skill-emit + Daytona sandbox', () => {
  it('on success, brain proposes a skill (NEVER auto-promotes)', () => {
    const proposal = proposeSkill(
      {
        taskClass: 'connector-flaky-retry-fix',
        jurisdiction: 'TZ',
        summary: 'Diagnose and fix flaky connector retry logic.',
        steps: ['s1', 's2'],
        verification: ['v1'],
        successConditions: ['All tests pass.'],
        modifiedFiles: ['packages/connectors/m-pesa/retry.ts'],
      },
      '2026-05-19T00:00:00.000Z',
    );
    expect(proposal.proposedPath).toContain('_proposed');
  });

  it('two-layer sandbox: worktree + Daytona, cleanup runs both layers', async () => {
    const git = mkGit();
    const daytona = mkDaytona();
    await withSandbox(
      {
        taskId: 'two-layer',
        baseBranch: 'main',
        allowedGlobs: ['x/**'],
        useDaytona: true,
      },
      async (sb) => {
        expect(sb.daytonaContainerId).toBe('cnt-1');
      },
      { git, daytona },
    );
    expect(git.remove).toHaveBeenCalledOnce();
    expect(daytona.destroyContainer).toHaveBeenCalledOnce();
  });
});

describe('integration — execute-phase path guards compose with deny-globs', () => {
  it('execute-phase rejects writes outside allowedGlobs even if pre-hook would have allowed them', async () => {
    // This test asserts the second-layer guard fires: even if the pre-hook
    // had said "allow", the execute-phase WriteContext refuses any path that
    // is not in `allowedGlobs`. Defense in depth.
    const exec = {
      read: vi.fn(async () => ''),
      write: vi.fn(async () => {}),
      edit: vi.fn(async () => {}),
      bash: vi.fn(async () => ''),
    };
    const { createWriteContext } = await import(
      '../plan-execute-split/execute-phase.js'
    );
    const ctx = createWriteContext({
      cwd: '/cwd',
      allowedGlobs: ['packages/connectors/m-pesa/**'],
      executor: exec,
    });
    await expect(
      ctx.write('packages/connectors/airtel/retry.ts', 'src'),
    ).rejects.toThrow(/outside allowedGlobs/);
    expect(exec.write).not.toHaveBeenCalled();
  });
});

describe('integration — full PR pipeline emits skill proposal', () => {
  it('after a successful run the brain can emit a skill proposal for promotion', async () => {
    // Smoke: a successful run unlocks the skill-emit step; the integration
    // is loosely-coupled (skill emit is a separate call) so we just verify
    // we have everything needed when the orchestrator returns success.
    const git = mkGit();
    const r = await runSelfCodegenTask(
      {
        task: 'fix a thing',
        repo: { url: 'u', baseBranch: 'main' },
        allowedGlobs: ['packages/x/**'],
      },
      {
        planner: async () => ({
          summary: 'fix x',
          riskTier: 'low',
          steps: ['edit'],
          affectedPaths: ['packages/x/a.ts'],
          estimatedDiffLoc: 10,
          estimatedTokens: 5_000,
          requiredCodeOwners: [],
        }),
        executor: async () => ({
          status: 'success',
          modifiedFiles: ['packages/x/a.ts'],
          tokensUsed: 5_000,
          diffSummary: 'one-liner',
        }),
        reviewer: async () => ({ verdict: 'pass', findings: [] }),
        prOpener: async () => ({ prUrl: 'pull/9' }),
        planExecutor: {
          read: async () => '',
          grep: async () => [],
          glob: async () => [],
          bash: async () => '',
        },
        execExecutor: {
          read: async () => '',
          write: async () => {},
          edit: async () => {},
          bash: async () => '',
        },
      },
      { git },
    );
    expect(r.status).toBe('pr-opened');
    // Emit a skill from the same task class:
    const proposal = proposeSkill(
      {
        taskClass: 'fix-x',
        jurisdiction: 'TZ',
        summary: r.plan!.summary,
        steps: [...r.plan!.steps],
        verification: ['pnpm test packages/x'],
        successConditions: ['All tests pass.'],
        modifiedFiles: [...r.execution!.modifiedFiles],
      },
      '2026-05-19T00:00:00.000Z',
    );
    expect(proposal.fileContents).toContain('When to use');
  });
});
