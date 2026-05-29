/**
 * `borjie agent run <task>` — autonomous agent loop.
 *
 * Loop:
 *   1. Send {task, recentTraceSteps} to /api/v1/agent/plan
 *   2. Server returns a plan + a `next_step` describing a tool call:
 *        { tool: "drafts.new", args: {...}, risk: "low"|"medium"|"high", rationale }
 *   3. Low-risk tools auto-execute (when --auto-approve), medium / high
 *      tools prompt the user for y/N.
 *   4. We invoke the corresponding `borjie ...` verb (in-process — see
 *      `runToolLocally`) and send the result back as the next plan input.
 *   5. Loop until the server returns {done: true} or `--max-steps N`
 *      is reached.
 *
 * Every step is streamed to stdout + appended to
 * `~/.config/borjie/agent-runs/<runId>.jsonl`.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ensureBorjieDir, agentRunFilePath } from '../paths.js';
import { requireSession } from './_session.js';
import { HttpError } from '../http.js';
import type { BorjieLogger } from '../logger.js';

export interface AgentStep {
  readonly step: number;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly risk: 'low' | 'medium' | 'high';
  readonly rationale: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly latencyMs?: number;
}

interface PlanResponse {
  readonly run_id?: string;
  readonly done?: boolean;
  readonly summary?: string;
  readonly next_step?: {
    readonly tool: string;
    readonly args?: Record<string, unknown>;
    readonly risk?: 'low' | 'medium' | 'high';
    readonly rationale?: string;
  };
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

const LOW_RISK_TOOLS = new Set<string>([
  'drafts.ls',
  'reminders.ls',
  'estate.sites',
  'estate.workers',
  'opportunities.ls',
  'risks.ls',
  'decisions.ls',
  'compliance.check',
  'scope.get',
  'tabs.ls',
]);

export async function agentRunCommand(opts: {
  readonly logger: BorjieLogger;
  readonly task: string;
  readonly maxSteps?: number;
  readonly autoApprove?: boolean;
  readonly runId?: string;
  readonly toolRunner?: ToolRunner;
}): Promise<void> {
  const session = requireSession(opts.logger);
  const maxSteps = Math.max(1, opts.maxSteps ?? 12);
  const runId = opts.runId ?? randomUUID();
  ensureBorjieDir('agent-runs');
  const traceFile = agentRunFilePath(runId);

  const rl =
    opts.autoApprove !== true && process.stdin.isTTY
      ? readline.createInterface({ input, output })
      : null;
  const requestApproval = async (step: Omit<AgentStep, 'step'>): Promise<boolean> => {
    if (opts.autoApprove === true) return true;
    if (step.risk === 'low' && LOW_RISK_TOOLS.has(step.tool)) return true;
    if (!rl) {
      opts.logger.warn(`No TTY for approval — auto-rejecting ${step.tool}.`);
      return false;
    }
    const answer = await rl.question(
      `Approve ${step.risk.toUpperCase()} step: ${step.tool} ${JSON.stringify(step.args)} ? [y/N] `,
    );
    return answer.trim().toLowerCase() === 'y';
  };

  if (!opts.logger.opts.json) {
    opts.logger.info(`Agent run ${runId} starting. Task: ${opts.task}`);
    opts.logger.info(`Trace: ${traceFile}`);
  }

  let stepNo = 0;
  let lastResult: unknown = null;
  const runner = opts.toolRunner ?? defaultToolRunner();
  while (stepNo < maxSteps) {
    stepNo += 1;
    let plan: PlanResponse;
    try {
      plan = await session.http.request<PlanResponse>('/api/v1/agent/plan', {
        method: 'POST',
        body: {
          run_id: runId,
          task: opts.task,
          step: stepNo,
          last_result: lastResult,
        },
        idempotencyKey: `${runId}:${stepNo}`,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        opts.logger.warn('Agent endpoint not available on this server; agent loop disabled.');
        return;
      }
      throw err;
    }
    if (plan.done) {
      const summaryLine = plan.summary ?? '(no summary)';
      appendTrace(traceFile, { type: 'done', step: stepNo, summary: summaryLine, ts: new Date().toISOString() });
      if (opts.logger.opts.json) opts.logger.envelope({ ok: true, data: { runId, done: true, summary: summaryLine, steps: stepNo } });
      else opts.logger.success(`Done in ${stepNo} steps: ${summaryLine}`);
      break;
    }
    const next = plan.next_step;
    if (!next) {
      opts.logger.warn('Server returned no next_step; halting.');
      break;
    }
    const tokensIn = plan.usage?.input_tokens;
    const tokensOut = plan.usage?.output_tokens;
    const step: AgentStep = {
      step: stepNo,
      tool: next.tool,
      args: next.args ?? {},
      risk: next.risk ?? 'medium',
      rationale: next.rationale ?? '',
      ...(typeof tokensIn === 'number' ? { tokensIn } : {}),
      ...(typeof tokensOut === 'number' ? { tokensOut } : {}),
    };
    const approved = await requestApproval(step);
    if (!approved) {
      appendTrace(traceFile, { type: 'rejected', ...step, ts: new Date().toISOString() });
      if (opts.logger.opts.json) opts.logger.envelope({ ok: false, error: { kind: 'rejected', tool: step.tool } });
      else opts.logger.warn(`Step ${stepNo} rejected (${step.tool}). Stopping.`);
      break;
    }
    if (!opts.logger.opts.json) {
      opts.logger.info(`[${stepNo}] ${step.tool} (risk=${step.risk}) — ${step.rationale}`);
    }
    const t0 = Date.now();
    try {
      const result = await runner(step.tool, step.args);
      const finished: AgentStep = { ...step, result, latencyMs: Date.now() - t0 };
      appendTrace(traceFile, { type: 'step', ...finished, ts: new Date().toISOString() });
      lastResult = result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendTrace(traceFile, {
        type: 'step_error',
        ...step,
        error: message,
        ts: new Date().toISOString(),
      });
      lastResult = { error: message };
      if (!opts.logger.opts.json) opts.logger.warn(`Step ${stepNo} failed: ${message}`);
    }
  }
  rl?.close();
  if (stepNo >= maxSteps) {
    if (opts.logger.opts.json) opts.logger.envelope({ ok: false, error: { kind: 'max_steps', maxSteps } });
    else opts.logger.warn(`Hit max-steps (${maxSteps}). Stopping.`);
  }
}

function appendTrace(path: string, record: unknown): void {
  try {
    appendFileSync(path, JSON.stringify(record) + '\n', { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

export type ToolRunner = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

function defaultToolRunner(): ToolRunner {
  return async (tool, args) => {
    // We never spawn subprocesses for tools — every brain-callable
    // verb has an in-process implementation under ./commands. The
    // mapping below is intentionally minimal; new tools should be
    // registered alongside their command file.
    const { requireSession: getSession } = await import('./_session.js');
    const { createLogger } = await import('../logger.js');
    const silent = createLogger({ json: true });
    const session = getSession(silent);
    switch (tool) {
      case 'drafts.ls':
        return await session.http.request<unknown>('/api/v1/owner/drafts');
      case 'drafts.show':
        return await session.http.request<unknown>(
          `/api/v1/owner/drafts/${encodeURIComponent(String(args['id']))}`,
        );
      case 'reminders.ls':
        return await session.http.request<unknown>('/api/v1/owner/reminders');
      case 'estate.sites':
        return await session.http.request<unknown>('/api/v1/mining/sites');
      case 'estate.workers':
        return await session.http.request<unknown>('/api/v1/workforce');
      case 'opportunities.ls':
        return await session.http.request<unknown>('/api/v1/opportunities');
      case 'risks.ls':
        return await session.http.request<unknown>('/api/v1/owner/risks');
      case 'decisions.ls':
        return await session.http.request<unknown>('/api/v1/decisions');
      case 'compliance.check':
        return await session.http.request<unknown>('/api/v1/compliance/status');
      case 'scope.get':
        return await session.http.request<unknown>('/api/v1/scope');
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  };
}
