/**
 * InMemorySubAgentRunner — deterministic test stub.
 *
 * Production wires to the Claude Agent SDK. Tests use this to:
 *   • verify spec validation
 *   • verify the isolation contract (no parent history leaks in)
 *   • verify allowlist enforcement (tool calls outside `allowed_tools` error)
 *   • verify worktree lifecycle hooks fire in the expected order
 */

import type { SubAgentSpec, SubAgentInput, SubAgentResult } from './types.js';
import type { SubAgentRunner } from './spawn.js';

/**
 * Recorded invocation of the in-memory runner. Tests can introspect this
 * to confirm what the runner actually saw — used to enforce the isolation
 * contract.
 */
export interface RunnerInvocation {
  readonly spec_name: string;
  readonly system_prompt: string;
  readonly allowed_tools: ReadonlyArray<string>;
  readonly prompt: string;
  readonly structured_input: unknown;
  readonly correlation_id: string;
  /**
   * Snapshot of the surrounding "world" at invocation time — empty by
   * construction (the runner has NO access to it). Tests can assert this
   * stays empty.
   */
  readonly parent_history_seen: ReadonlyArray<unknown>;
}

export interface InMemorySubAgentRunnerOptions {
  /**
   * Per-spec output function. Given the input, returns the typed output
   * the subagent would have produced. If absent for a spec, returns
   * `{ stub: true }` as the typed output.
   */
  readonly outputs?: Record<string, (input: SubAgentInput) => unknown>;
  /**
   * Optional simulated turns used per spec (defaults to 1). Tests use
   * higher values to verify budget reporting.
   */
  readonly turns?: Record<string, number>;
  /**
   * Optional simulated cost per spec (defaults to 0).
   */
  readonly cost?: Record<string, number>;
  /**
   * Tools the subagent claims to call during the run. The runner checks
   * that EVERY claim is in the spec's `allowed_tools`. Used to validate
   * allowlist enforcement.
   */
  readonly tools_called?: Record<string, ReadonlyArray<string>>;
}

export class InMemorySubAgentRunner implements SubAgentRunner {
  private readonly options: InMemorySubAgentRunnerOptions;
  private readonly _invocations: Array<RunnerInvocation> = [];

  constructor(options: InMemorySubAgentRunnerOptions = {}) {
    this.options = options;
  }

  get invocations(): ReadonlyArray<RunnerInvocation> {
    return this._invocations;
  }

  async run<TOutput = unknown, TStructured = unknown>(args: {
    spec: SubAgentSpec;
    input: SubAgentInput<TStructured>;
  }): Promise<SubAgentResult<TOutput>> {
    const { spec, input } = args;

    // Record what we saw — the isolation contract guarantees this view is
    // the COMPLETE input set.
    this._invocations.push({
      spec_name: spec.name,
      system_prompt: spec.system_prompt,
      allowed_tools: spec.allowed_tools,
      prompt: input.prompt,
      structured_input: input.structured_input,
      correlation_id: input.correlation_id,
      parent_history_seen: [], // empty by construction — isolation contract
    });

    // Allowlist enforcement: every claimed tool call must be in the spec.
    const claimedTools = this.options.tools_called?.[spec.name] ?? [];
    for (const tool of claimedTools) {
      if (!spec.allowed_tools.includes(tool)) {
        return {
          name: spec.name,
          status: 'error',
          output: { error: `tool ${tool} not in allowed_tools` } as unknown as TOutput,
          turns_used: 0,
          cost_usd: 0,
          correlation_id: input.correlation_id,
          error: {
            code: 'tool_not_allowed',
            message: `Subagent "${spec.name}" attempted to call "${tool}" which is not in allowed_tools`,
          },
        };
      }
    }

    const turns = this.options.turns?.[spec.name] ?? 1;
    const cost = this.options.cost?.[spec.name] ?? 0;

    if (turns > spec.max_turns) {
      return {
        name: spec.name,
        status: 'turn_limit',
        output: { error: 'turn limit' } as unknown as TOutput,
        turns_used: spec.max_turns,
        cost_usd: cost,
        correlation_id: input.correlation_id,
        error: { code: 'turn_limit', message: `Exceeded max_turns=${spec.max_turns}` },
      };
    }

    const producer = this.options.outputs?.[spec.name];
    const output = (producer ? producer(input) : { stub: true }) as TOutput;

    return {
      name: spec.name,
      status: 'ok',
      output,
      turns_used: turns,
      cost_usd: cost,
      correlation_id: input.correlation_id,
    };
  }
}
