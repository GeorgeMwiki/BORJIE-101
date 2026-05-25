/**
 * Agency — plan decomposer.
 *
 * Single Haiku call: read the objective + the registry's available
 * tools, return an array of small concrete steps. Schema-validates the
 * output; any parse failure or schema mismatch collapses to an empty
 * plan (the caller handles that gracefully).
 */
import type { Sensor } from '../../kernel-types.js';

export interface DecomposedStep {
  readonly description: string;
  readonly toolName: string | null;
  readonly toolPayload: Record<string, unknown> | null;
}

export interface PlanDecomposerToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface PlanDecomposerArgs {
  readonly objective: string;
  readonly context?: string;
  readonly availableTools: ReadonlyArray<PlanDecomposerToolDescriptor>;
}

export interface PlanDecomposerDeps {
  /** Same Sensor shape the kernel uses; the decomposer makes ONE call. */
  readonly sensor: Sensor;
}

const SYSTEM_PROMPT =
  'You are a property-management action planner. Read the objective and the list of available tools. Return a JSON array of {description, toolName?, toolPayload?} steps. Each step is small and concrete. If a step does not need a tool (just analysis or waiting), set toolName=null. Keep the plan <=10 steps. Tools you do not need do not have to be used. Return ONLY the JSON array.';

const MAX_STEPS = 10;

export async function decomposePlan(
  args: PlanDecomposerArgs,
  deps: PlanDecomposerDeps,
): Promise<ReadonlyArray<DecomposedStep>> {
  const userMessage = renderUserMessage(args);
  let raw = '';
  try {
    const result = await deps.sensor.call({
      system: SYSTEM_PROMPT,
      userMessage,
      priorTurns: [],
      extendedThinking: false,
      stakes: 'low',
    });
    raw = result.text ?? '';
  } catch {
    return [];
  }
  return parsePlan(raw);
}

function renderUserMessage(args: PlanDecomposerArgs): string {
  const tools = args.availableTools
    .map((t) => {
      let schemaText = '';
      try {
        schemaText = JSON.stringify(t.inputSchema);
      } catch {
        schemaText = '{}';
      }
      return `  - ${t.name}: ${t.description} (input schema: ${schemaText})`;
    })
    .join('\n');
  const ctx = args.context ? `\n\nContext:\n${args.context}` : '';
  return [
    `Objective: ${args.objective}`,
    '',
    'Available tools:',
    tools.length > 0 ? tools : '  (none — every step must be informational)',
    ctx,
  ].join('\n');
}

function parsePlan(raw: string): ReadonlyArray<DecomposedStep> {
  if (!raw) return [];
  const trimmed = stripCodeFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: DecomposedStep[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const description = obj.description;
    if (typeof description !== 'string' || !description) return [];

    const rawToolName = obj.toolName;
    let toolName: string | null = null;
    if (rawToolName === null || rawToolName === undefined) {
      toolName = null;
    } else if (typeof rawToolName === 'string') {
      toolName = rawToolName || null;
    } else {
      return [];
    }

    const rawPayload = obj.toolPayload;
    let toolPayload: Record<string, unknown> | null = null;
    if (rawPayload === null || rawPayload === undefined) {
      toolPayload = null;
    } else if (
      typeof rawPayload === 'object' &&
      !Array.isArray(rawPayload)
    ) {
      toolPayload = rawPayload as Record<string, unknown>;
    } else {
      return [];
    }

    out.push({ description, toolName, toolPayload });
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

function stripCodeFence(s: string): string {
  if (!s.startsWith('```')) return s;
  const firstNewline = s.indexOf('\n');
  if (firstNewline === -1) return s;
  const body = s.slice(firstNewline + 1);
  const closing = body.lastIndexOf('```');
  if (closing === -1) return body;
  return body.slice(0, closing).trim();
}
