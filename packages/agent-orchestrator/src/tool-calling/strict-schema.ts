/**
 * Strict-schema tool wrapper. Validates incoming tool inputs against
 * a Zod schema BEFORE invocation, and re-validates outputs (optional)
 * for added safety.
 *
 * 2026 BFCL v4 + Anthropic tool-use best practice: every tool MUST
 * have a strict schema; the model is told to fix its input if
 * validation fails (the validation error becomes the observation).
 */

import type { ZodTypeAny } from 'zod';
import type { ToolPort } from '../types.js';

export interface WrapStrictInput<TInput, TOutput> {
  readonly tool: ToolPort<TInput, TOutput>;
  /** Zod schema validating the input shape. */
  readonly inputSchema: ZodTypeAny;
  /** Optional output schema. */
  readonly outputSchema?: ZodTypeAny;
}

export class StrictToolValidationError extends Error {
  public readonly issues: ReadonlyArray<{ path: string; message: string }>;
  constructor(toolName: string, side: 'input' | 'output', issues: ReadonlyArray<{ path: string; message: string }>) {
    super(`tool '${toolName}' ${side} failed validation: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'StrictToolValidationError';
    this.issues = issues;
  }
}

export function wrapToolForStrictSchema<TInput, TOutput>(
  input: WrapStrictInput<TInput, TOutput>,
): ToolPort<TInput, TOutput> {
  return {
    name: input.tool.name,
    description: input.tool.description,
    inputSchema: input.tool.inputSchema,
    async execute(rawInput: TInput): Promise<TOutput> {
      const inResult = input.inputSchema.safeParse(rawInput);
      if (!inResult.success) {
        const issues = inResult.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        throw new StrictToolValidationError(input.tool.name, 'input', issues);
      }
      const out = await input.tool.execute(inResult.data as TInput);
      if (input.outputSchema) {
        const outResult = input.outputSchema.safeParse(out);
        if (!outResult.success) {
          const issues = outResult.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          }));
          throw new StrictToolValidationError(input.tool.name, 'output', issues);
        }
      }
      return out;
    },
  };
}
