/**
 * The top-level `runSelfCodegenTask` orchestrator.
 *
 * Wire-up:
 *   1. PLAN (Opus, read-only)             → editable spec
 *   2. EXECUTE (Sonnet, inside worktree)  → modified files
 *   3. REFLECT (3 critics in parallel)    → verdict
 *   4. OPEN PR (or block)                 → PR url
 *
 * This file is intentionally thin — the heavy lifting lives in each module.
 */

import {
  DEFAULT_CRITICS,
  runReflexionRound,
} from '../multi-agent-reflexion/run-reflexion.js';
import { type CriticName } from '../multi-agent-reflexion/types.js';
import {
  createSandbox,
  type CreateSandboxDeps,
} from '../worktree-sandbox/create-sandbox.js';
import { runExecutePhase, createWriteContext } from './execute-phase.js';
import { createReadOnlyContext, runPlanPhase } from './plan-phase.js';
import {
  type EditableSpec,
  type ExecutionResult,
  type ReflectionFinding,
  type ReflectionResult,
  type SelfCodegenResult,
  type SelfCodegenTaskRequest,
} from './types.js';

const DEFAULT_BUDGET_USD_CENTS = 100_000; // = $1000 hard ceiling

export interface SelfCodegenAdapters {
  planner: (
    req: { task: string; allowedGlobs: readonly string[] },
    ctx: import('./types.js').ReadOnlyContext,
  ) => Promise<EditableSpec>;
  executor: (
    spec: EditableSpec,
    ctx: import('./types.js').WriteContext,
  ) => Promise<ExecutionResult>;
  reviewer: (input: {
    diffSummary: string;
    modifiedFiles: readonly string[];
    critic?: CriticName;
  }) => Promise<{
    verdict: 'pass' | 'comments' | 'block';
    findings: readonly {
      severity: 'info' | 'warning' | 'error' | 'critical';
      file?: string;
      line?: number;
      message: string;
    }[];
  }>;
  prOpener: (input: {
    branch: string;
    title: string;
    body: string;
  }) => Promise<{ prUrl: string }>;
  planExecutor: {
    read: (p: string) => Promise<string>;
    grep: (p: string, scope?: string) => Promise<readonly string[]>;
    glob: (p: string) => Promise<readonly string[]>;
    bash: (c: string) => Promise<string>;
  };
  execExecutor: {
    read: (p: string) => Promise<string>;
    write: (p: string, c: string) => Promise<void>;
    edit: (p: string, o: string, n: string) => Promise<void>;
    bash: (c: string) => Promise<string>;
  };
}

export async function runSelfCodegenTask(
  request: SelfCodegenTaskRequest,
  adapters: SelfCodegenAdapters,
  sandboxDeps?: CreateSandboxDeps,
): Promise<SelfCodegenResult> {
  const budgetCents = request.budgetUsdCents ?? DEFAULT_BUDGET_USD_CENTS;
  const taskId = `task-${Date.now().toString(36)}`;

  let plan: EditableSpec | undefined;
  let execution: ExecutionResult | undefined;
  let reflection: ReflectionResult | undefined;

  // PHASE 1 — PLAN (Opus, read-only)
  const planCtx = createReadOnlyContext(adapters.planExecutor);
  try {
    plan = await runPlanPhase(
      {
        task: request.task,
        allowedGlobs: request.allowedGlobs,
        repo: request.repo,
      },
      planCtx,
      adapters.planner,
    );
  } catch (e) {
    return {
      status: 'failed',
      totalTokens: 0,
      totalCostCents: 0,
      blockedReason: `plan-phase-failed: ${(e as Error).message}`,
    };
  }

  // PHASE 2 — EXECUTE inside sandbox (worktree + optional Daytona)
  const sandbox = await createSandbox(
    {
      taskId,
      baseBranch: request.repo.baseBranch,
      allowedGlobs: request.allowedGlobs,
      useDaytona: request.useDaytona ?? false,
    },
    sandboxDeps,
  );

  try {
    const execCtx = createWriteContext({
      cwd: sandbox.cwd,
      allowedGlobs: request.allowedGlobs,
      executor: adapters.execExecutor,
    });
    execution = await runExecutePhase(
      { spec: plan, cwd: sandbox.cwd, allowedGlobs: request.allowedGlobs },
      execCtx,
      adapters.executor,
    );

    if (execution.status === 'failed') {
      return {
        status: 'failed',
        plan,
        execution,
        totalTokens: execution.tokensUsed,
        totalCostCents: 0,
        blockedReason: execution.failureReason ?? 'execution failed',
      };
    }

    // PHASE 3 — REFLECT (3 critics, parallel)
    const round = await runReflexionRound({
      draft: {
        diffSummary: execution.diffSummary,
        modifiedFiles: execution.modifiedFiles,
      },
      critics: DEFAULT_CRITICS,
      reviewer: adapters.reviewer,
    });
    const reflectionFindings: ReflectionFinding[] = round.findings.map((f) => ({
      critic: f.critic,
      severity: f.severity,
      ...(f.file !== undefined ? { file: f.file } : {}),
      ...(f.line !== undefined ? { line: f.line } : {}),
      message: f.message,
    }));
    reflection = {
      verdict: round.verdict,
      findings: reflectionFindings,
    };

    if (reflection.verdict === 'block') {
      return {
        status: 'blocked',
        plan,
        execution,
        reflection,
        totalTokens: execution.tokensUsed,
        totalCostCents: 0,
        blockedReason: 'reflection-blocked',
      };
    }

    // PHASE 4 — OPEN PR
    const branch = `claude/${taskId}`;
    const body = renderPrBody(plan, execution, reflection);
    const opened = await adapters.prOpener({
      branch,
      title: plan.summary,
      body,
    });

    return {
      status: 'pr-opened',
      prUrl: opened.prUrl,
      plan,
      execution,
      reflection,
      totalTokens: execution.tokensUsed,
      totalCostCents: estimateCostCents(execution.tokensUsed, budgetCents),
    };
  } finally {
    await sandbox.cleanup();
  }
}

function renderPrBody(
  plan: EditableSpec,
  exec: ExecutionResult,
  refl: ReflectionResult,
): string {
  const findings = refl.findings
    .map((f) => `- [${f.critic}/${f.severity}] ${f.message}`)
    .join('\n');
  return [
    '## Plan',
    plan.summary,
    '',
    '### Steps',
    ...plan.steps.map((s) => `- ${s}`),
    '',
    `### Risk: ${plan.riskTier}`,
    `### Modified files (${exec.modifiedFiles.length})`,
    ...exec.modifiedFiles.map((f) => `- ${f}`),
    '',
    '### Reflexion verdict: ' + refl.verdict,
    findings || '_no findings_',
  ].join('\n');
}

function estimateCostCents(tokens: number, capCents: number): number {
  // Sonnet 4.7 ~$3/Mtok in + $15/Mtok out, assume 50/50 split.
  const cents = Math.round((tokens / 1_000_000) * 1800 * 100); // 18$ per Mtok blended
  return Math.min(cents, capCents);
}
