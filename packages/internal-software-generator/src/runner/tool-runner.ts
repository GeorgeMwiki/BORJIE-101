/**
 * Tool runner — execute a live tool against inputs, persist run.
 *
 * ON_DEMAND_INTERNAL_SOFTWARE_SPEC §5: tools only run when they are
 * in the `live` lifecycle state. The runner enforces that gate,
 * dispatches the handler via the injected port, and persists the
 * resulting run row with an audit hash for forensic replay.
 *
 * Inputs are validated against the tool's form schema before
 * dispatch — a tool that takes (scope, window_days) cannot be
 * called without those keys.
 */

import type {
  InternalTool,
  InternalToolRepository,
  RunToolRequest,
  ToolHandlerPort,
  ToolRun,
  ToolRunRepository,
} from '../types.js';
import { isRunnable } from '../lifecycle/tool-lifecycle.js';

export interface ToolRunnerDeps {
  readonly tools: InternalToolRepository;
  readonly runs: ToolRunRepository;
  readonly handler: ToolHandlerPort;
}

export class ToolRunnerError extends Error {
  public readonly code: ToolRunnerErrorCode;
  constructor(code: ToolRunnerErrorCode, message: string) {
    super(message);
    this.name = 'ToolRunnerError';
    this.code = code;
  }
}

export type ToolRunnerErrorCode =
  | 'tool_not_found'
  | 'tool_not_runnable'
  | 'missing_required_field'
  | 'unknown_input_field';

export function createToolRunner(deps: ToolRunnerDeps) {
  return {
    /**
     * Run a tool. Returns the persisted ToolRun row. Throws a
     * `ToolRunnerError` for any of the four guard conditions.
     */
    async run(request: RunToolRequest): Promise<ToolRun> {
      const tool = await deps.tools.findById(request.tenantId, request.toolId);
      if (tool === null) {
        throw new ToolRunnerError(
          'tool_not_found',
          `tool ${request.toolId} not found for tenant ${request.tenantId}`,
        );
      }
      if (!isRunnable(tool)) {
        throw new ToolRunnerError(
          'tool_not_runnable',
          `tool ${tool.id} is in lifecycle "${tool.lifecycleState}"; only "live" tools may run`,
        );
      }
      validateInputs(tool, request.inputs);

      const outputs = await deps.handler({
        tool,
        inputs: request.inputs,
      });

      const run = await deps.runs.insert({
        toolId: tool.id,
        tenantId: tool.tenantId,
        inputs: request.inputs,
        outputs,
        ranBy: request.ranBy,
      });
      return run;
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateInputs(
  tool: InternalTool,
  inputs: Readonly<Record<string, unknown>>,
): void {
  const fieldByName = new Map(
    tool.spec.form.fields.map((f) => [f.name, f] as const),
  );

  // Required fields must be present + non-empty.
  for (const field of tool.spec.form.fields) {
    if (field.required) {
      const value = inputs[field.name];
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.length === 0)
      ) {
        throw new ToolRunnerError(
          'missing_required_field',
          `required input field "${field.name}" is missing`,
        );
      }
    }
  }

  // Unknown input fields are rejected — keeps tools sealed.
  for (const name of Object.keys(inputs)) {
    if (!fieldByName.has(name)) {
      throw new ToolRunnerError(
        'unknown_input_field',
        `input "${name}" is not declared on this tool's form schema`,
      );
    }
  }
}
