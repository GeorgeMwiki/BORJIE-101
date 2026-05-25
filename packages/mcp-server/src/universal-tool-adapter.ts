/**
 * Universal Tool Adapter
 *
 * Generic wrapper that turns any BORJIE service handler into an MCP
 * tool handler. Every invocation:
 *   1. Validates input against the declared schema (shape/type/required).
 *   2. Verifies the caller's scopes.
 *   3. Enforces tier gating.
 *   4. Measures duration.
 *   5. Records a cost entry.
 *
 * The adapter lets the same set of "skills" be called via three routes:
 *   - direct TypeScript (the api-gateway's composition root)
 *   - Claude tool_use format (through ai-copilot)
 *   - MCP (this package, wrapped by `borjie-mcp-server.ts`)
 */

import type {
  McpAuthContext,
  McpCostEntry,
  McpToolDefinition,
  McpToolHandler,
  McpToolResult,
  RunSkillInput,
  RunSkillResult,
} from './types.js';
import { assertScopes, McpAuthError } from './mcp-auth.js';
import type { TierRouter } from './tier-router.js';

const MAX_INPUT_BYTES = 1_000_000;

// ============================================================================
// Input validation
// ============================================================================

function validateInput(
  tool: McpToolDefinition,
  input: Record<string, unknown>,
): McpToolResult | null {
  const size = JSON.stringify(input).length;
  if (size > MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: `Input payload too large (${size} bytes, max ${MAX_INPUT_BYTES}).`,
      errorCode: 'TOOL_INVALID_INPUT',
    };
  }

  for (const required of tool.requiredInputs) {
    if (!(required in input) || input[required] === undefined) {
      return {
        ok: false,
        error: `Missing required field: ${required}`,
        errorCode: 'TOOL_INVALID_INPUT',
      };
    }
  }

  for (const [key, prop] of Object.entries(tool.inputSchema)) {
    if (!(key in input) || input[key] === undefined) continue;
    const actual = typeof input[key];
    switch (prop.type) {
      case 'string':
        if (actual !== 'string') {
          return {
            ok: false,
            error: `Field ${key} must be a string.`,
            errorCode: 'TOOL_INVALID_INPUT',
          };
        }
        if (prop.enum && !prop.enum.includes(input[key] as string)) {
          return {
            ok: false,
            error: `Field ${key} must be one of: ${prop.enum.join(', ')}.`,
            errorCode: 'TOOL_INVALID_INPUT',
          };
        }
        break;
      case 'number':
        if (actual !== 'number' || !Number.isFinite(input[key])) {
          return {
            ok: false,
            error: `Field ${key} must be a finite number.`,
            errorCode: 'TOOL_INVALID_INPUT',
          };
        }
        break;
      case 'boolean':
        if (actual !== 'boolean') {
          return {
            ok: false,
            error: `Field ${key} must be a boolean.`,
            errorCode: 'TOOL_INVALID_INPUT',
          };
        }
        break;
      case 'array':
        if (!Array.isArray(input[key])) {
          return {
            ok: false,
            error: `Field ${key} must be an array.`,
            errorCode: 'TOOL_INVALID_INPUT',
          };
        }
        break;
      case 'object':
        if (
          actual !== 'object' ||
          input[key] === null ||
          Array.isArray(input[key])
        ) {
          return {
            ok: false,
            error: `Field ${key} must be an object.`,
            errorCode: 'TOOL_INVALID_INPUT',
          };
        }
        break;
      default:
        break;
    }
  }

  return null;
}

// ============================================================================
// Adapter
// ============================================================================

export interface AdapterDeps {
  readonly tierRouter: TierRouter;
  readonly recordCost: (entry: McpCostEntry) => void;
  readonly getMonthlySpend: (tenantId: string) => Promise<number>;
}

export interface WrappedToolInvocation<T = unknown> {
  readonly toolName: string;
  readonly result: McpToolResult<T>;
  readonly durationMs: number;
  readonly cost: McpCostEntry;
}

/**
 * Wrap one handler so every call runs through validation / gating / cost.
 */
export function wrapToolHandler(
  tool: McpToolDefinition,
  handler: McpToolHandler,
  deps: AdapterDeps,
): (
  input: Record<string, unknown>,
  context: McpAuthContext,
) => Promise<WrappedToolInvocation> {
  return async (input, context) => {
    const started = Date.now();

    // 1. scopes
    try {
      assertScopes(context, tool.requiredScopes);
    } catch (err) {
      if (err instanceof McpAuthError) {
        const cost = buildCost(tool, context, 0);
        deps.recordCost(cost);
        return {
          toolName: tool.name,
          result: {
            ok: false,
            error: err.message,
            errorCode: err.errorCode,
          },
          durationMs: Date.now() - started,
          cost,
        };
      }
      throw err;
    }

    // 2. tier gating
    const tierDecision = deps.tierRouter.canInvoke(tool, context.tier);
    if (!tierDecision.allowed) {
      const cost = buildCost(tool, context, 0);
      deps.recordCost(cost);
      return {
        toolName: tool.name,
        result: {
          ok: false,
          error: tierDecision.reason ?? 'Tier does not permit this tool.',
          errorCode: tierDecision.errorCode ?? 'TIER_FORBIDDEN',
        },
        durationMs: Date.now() - started,
        cost,
      };
    }

    // 3. budget gating
    const monthlySpent = await deps.getMonthlySpend(context.tenantId);
    const affordDecision = deps.tierRouter.canAfford(
      tool.estimatedCostUsdMicro,
      context.tier,
      monthlySpent,
    );
    if (!affordDecision.allowed) {
      const cost = buildCost(tool, context, 0);
      deps.recordCost(cost);
      return {
        toolName: tool.name,
        result: {
          ok: false,
          error: affordDecision.reason ?? 'Budget exceeded.',
          errorCode: affordDecision.errorCode ?? 'TIER_BUDGET_EXCEEDED',
        },
        durationMs: Date.now() - started,
        cost,
      };
    }

    // 4. validate
    const inputError = validateInput(tool, input);
    if (inputError) {
      const cost = buildCost(tool, context, 0);
      deps.recordCost(cost);
      return {
        toolName: tool.name,
        result: inputError,
        durationMs: Date.now() - started,
        cost,
      };
    }

    // 5. execute
    let result: McpToolResult;
    try {
      result = await handler(input, context);
    } catch (err) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : 'Tool execution failed.',
        errorCode: 'TOOL_EXECUTION_FAILED',
      };
    }

    const durationMs = Date.now() - started;
    const cost = buildCost(
      tool,
      context,
      result.ok ? tool.estimatedCostUsdMicro : 0,
      durationMs,
    );
    deps.recordCost(cost);
    return { toolName: tool.name, result, durationMs, cost };
  };
}

function buildCost(
  tool: McpToolDefinition,
  context: McpAuthContext,
  costUsdMicro: number,
  durationMs = 0,
): McpCostEntry {
  return Object.freeze({
    tenantId: context.tenantId,
    principalId: context.principalId,
    toolName: tool.name,
    tier: context.tier,
    estimatedCostUsdMicro: costUsdMicro,
    durationMs,
    wasFree: costUsdMicro === 0,
    correlationId: context.correlationId,
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// run_skill (generic dispatch)
// ============================================================================

/**
 * Build a `run_skill` handler that dispatches by skillName to any of the
 * registered tools. Used for callers that want a single universal entrypoint.
 */
export function createRunSkillHandler(
  handlers: ReadonlyMap<
    string,
    (
      input: Record<string, unknown>,
      context: McpAuthContext,
    ) => Promise<WrappedToolInvocation>
  >,
): McpToolHandler {
  return async (input, context) => {
    const skillInput = input as unknown as RunSkillInput;
    if (!skillInput.skillName || typeof skillInput.skillName !== 'string') {
      return {
        ok: false,
        error: 'skillName is required',
        errorCode: 'TOOL_INVALID_INPUT',
      };
    }
    const inner = handlers.get(skillInput.skillName);
    if (!inner) {
      return {
        ok: false,
        error: `Unknown skill: ${skillInput.skillName}`,
        errorCode: 'TOOL_NOT_FOUND',
      };
    }
    const invocation = await inner(
      (skillInput.input ?? {}) as Record<string, unknown>,
      context,
    );
    const payload: RunSkillResult = {
      skillName: skillInput.skillName,
      result: invocation.result,
      durationMs: invocation.durationMs,
    };
    return { ok: true, data: payload };
  };
}
