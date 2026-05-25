/**
 * AI Chart Author — natural-language → Vega-Lite v6 chart spec.
 *
 * Two paths:
 *   1. LLM path (when `brain` is supplied): build a templated prompt
 *      with the question + schema + (optional) cube name, call the
 *      brain expecting JSON, validate the response with zod + the
 *      Vega-Lite spec validator. If it lints, return it.
 *   2. Deterministic path: pick a template chart from heuristics over
 *      the question + schema (see `templates.ts`). This is the
 *      "no-brain" fallback used in tests and offline environments.
 *
 * The LLM path always *falls back* to the deterministic path if:
 *   - the brain call throws
 *   - the JSON does not parse
 *   - the spec fails Vega-Lite schema validation
 *
 * This matches the SOTA pattern from Hex Magic / Tableau Pulse: never
 * surface a non-renderable spec to the user. If the LLM is gone, you
 * get a chart that draws, just maybe not the optimal one.
 */

import { z } from 'zod';
import type { NLQueryRequest, NLQueryResponse } from '../types.js';
import { validateChartSpec } from '../types.js';
import { deterministicResponse, pickTemplate } from './templates.js';
import type { ChartAuthorBrain } from './brain.js';

const LLM_RESPONSE_SCHEMA = z.object({
  spec: z.record(z.unknown()),
  sql: z.string().optional(),
  explanation: z.string(),
});

export interface AuthorChartInput {
  readonly request: NLQueryRequest;
  readonly brain?: ChartAuthorBrain;
  /** Sample data — used by the deterministic path when the spec needs values. */
  readonly sampleData?: readonly Record<string, unknown>[];
}

export async function authorChartFromQuestion(input: AuthorChartInput): Promise<NLQueryResponse> {
  const { request, brain, sampleData } = input;

  // 1. Pick a template — always used as fallback + as a hint for the LLM.
  const pick = pickTemplate(request.question, request.schema, request.preferredChart);

  if (!brain) {
    return deterministicResponse(request, pick, sampleData ?? []);
  }

  // 2. Build the prompt.
  const prompt = buildPrompt(request, pick);

  try {
    const result = await brain.completeJson(prompt);
    const json = JSON.parse(result.content);
    const parsed = LLM_RESPONSE_SCHEMA.safeParse(json);
    if (!parsed.success) {
      return deterministicResponse(request, pick, sampleData ?? []);
    }

    // Inject the sample data when the LLM left `data.values` empty.
    const llmSpec = parsed.data.spec as Record<string, unknown>;
    if (!llmSpec['data'] || typeof llmSpec['data'] !== 'object') {
      llmSpec['data'] = { values: sampleData ?? [] };
    }

    const validated = validateChartSpec(llmSpec);
    if (!validated.ok) {
      return deterministicResponse(request, pick, sampleData ?? []);
    }

    return Object.freeze({
      spec: validated.spec,
      ...(parsed.data.sql ? { sql: parsed.data.sql } : {}),
      explanation: parsed.data.explanation,
      deterministic: false,
    });
  } catch {
    return deterministicResponse(request, pick, sampleData ?? []);
  }
}

function buildPrompt(req: NLQueryRequest, pick: ReturnType<typeof pickTemplate>): string {
  const schemaSummary = req.schema.columns
    .map((c) => `  - ${c.name}: ${c.inferredType}${c.distinctCount ? ` (distinct: ${c.distinctCount})` : ''}`)
    .join('\n');
  return [
    'You are a SOTA analytics chart author. Given a user question and a data schema, propose a Vega-Lite v6 chart spec.',
    '',
    'Return JSON with the shape: { spec: <Vega-Lite v6 spec>, sql: <optional SQL>, explanation: <one paragraph> }',
    '',
    'Rules:',
    '  - The spec must be valid Vega-Lite v6 — it MUST contain `data` and `mark` keys.',
    '  - Use only columns that exist in the schema below.',
    '  - Prefer the chart kind that best answers the question. As a hint, a template-based picker',
    `    suggested kind '${pick.kind}'. You may override.`,
    '  - The explanation is one paragraph explaining the choice in plain English.',
    '',
    'Question:',
    `  ${req.question}`,
    '',
    'Schema:',
    schemaSummary,
    '',
    req.cubeName ? `Target cube: ${req.cubeName}` : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}
