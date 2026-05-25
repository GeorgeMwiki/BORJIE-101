/**
 * Planner — calls the multi-LLM synthesizer with a planner-shaped
 * prompt and parses the response into a `Plan`. Pure orchestration;
 * the actual model query lives in the MultiLlmSynthesizer port.
 *
 * The planner asks the synthesizer for a JSON object with the schema
 * { goal, steps: Step[], deps: [from, to][], planCitations: Citation[] }
 * and validates it before returning. Validation failures surface as
 * structured errors so the orchestrator can either retry, escalate,
 * or abandon.
 */

import type {
  EvidenceCitation,
  MultiLlmRequest,
  MultiLlmSynthesizer,
  Plan,
  Step,
} from './types.js';

export type PlannerError =
  | { readonly kind: 'no-consensus'; readonly modelsAgreed: number; readonly modelsQueried: number }
  | { readonly kind: 'invalid-json'; readonly text: string }
  | { readonly kind: 'invalid-shape'; readonly detail: string };

export type PlannerResult =
  | { readonly ok: true; readonly plan: Plan }
  | { readonly ok: false; readonly error: PlannerError };

export interface PlannerInput {
  readonly goal: string;
  readonly toolDirectory: ReadonlyArray<{ readonly name: string; readonly description: string }>;
  readonly knownCitations?: ReadonlyArray<EvidenceCitation>;
  readonly generation: number;
}

const PLANNER_SYSTEM = `You are the PLANNER for a property-management AI agent.
Given a goal + a directory of available tools, output a JSON object
matching this exact schema (no prose, no markdown fence):

{
  "steps": [
    {
      "id": "string (kebab, unique)",
      "description": "string (one short sentence)",
      "toolName": "string (must match a tool in the directory)",
      "input": <JSON object — the tool's input contract>,
      "estimatedCost": <number or null>,
      "citations": [<EvidenceCitation>]
    }
  ],
  "deps": [["fromStepId", "toStepId"], ...],
  "planCitations": [<EvidenceCitation>]
}

Rules:
- NEVER invent tool names. Use the directory exactly.
- NEVER introduce side-effecting steps without prior read steps.
- The DAG must be acyclic; the validator will reject cycles.
- Every Step.citations entry MUST point at a source you can name.`;

export async function buildPlan(
  input: PlannerInput,
  synthesizer: MultiLlmSynthesizer,
): Promise<PlannerResult> {
  const toolDirText = input.toolDirectory
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');
  const userMessage = `Goal: ${input.goal}\n\nAvailable tools:\n${toolDirText}\n\nKnown citations: ${JSON.stringify(input.knownCitations ?? [])}`;

  const req: MultiLlmRequest = {
    purpose: 'planner',
    system: PLANNER_SYSTEM,
    userMessage,
    minAgreement: 2,
  };
  const resp = await synthesizer.synthesize(req);

  if (!resp.converged) {
    return {
      ok: false,
      error: {
        kind: 'no-consensus',
        modelsAgreed: resp.modelsAgreed,
        modelsQueried: resp.modelsQueried,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(resp.text);
  } catch {
    return { ok: false, error: { kind: 'invalid-json', text: resp.text } };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: { kind: 'invalid-shape', detail: 'root not an object' } };
  }
  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.steps)) {
    return { ok: false, error: { kind: 'invalid-shape', detail: 'steps not an array' } };
  }
  if (!Array.isArray(root.deps)) {
    return { ok: false, error: { kind: 'invalid-shape', detail: 'deps not an array' } };
  }

  const knownToolNames = new Set(input.toolDirectory.map((t) => t.name));
  const steps: Step[] = [];
  for (const raw of root.steps as unknown[]) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: { kind: 'invalid-shape', detail: 'step not an object' } };
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.description !== 'string' || typeof s.toolName !== 'string') {
      return { ok: false, error: { kind: 'invalid-shape', detail: 'step missing required fields' } };
    }
    if (!knownToolNames.has(s.toolName)) {
      return { ok: false, error: { kind: 'invalid-shape', detail: `unknown tool "${s.toolName}"` } };
    }
    steps.push({
      id: s.id,
      description: s.description,
      toolName: s.toolName,
      input: s.input ?? null,
      estimatedCost: typeof s.estimatedCost === 'number' ? s.estimatedCost : null,
      citations: Array.isArray(s.citations) ? (s.citations as EvidenceCitation[]) : [],
    });
  }

  const deps: ReadonlyArray<readonly [string, string]> = (root.deps as unknown[])
    .map((d) => {
      if (!Array.isArray(d) || d.length !== 2 || typeof d[0] !== 'string' || typeof d[1] !== 'string') {
        throw new Error('bad-dep');
      }
      return [d[0], d[1]] as const;
    });

  const plan: Plan = {
    id: `plan-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    goal: input.goal,
    steps: Object.freeze(steps),
    deps: Object.freeze(deps),
    planCitations: Array.isArray(root.planCitations) ? (root.planCitations as EvidenceCitation[]) : [],
    createdAt: new Date().toISOString(),
    generation: input.generation,
  };

  return { ok: true, plan };
}
