/**
 * proposal-generator — LLM-backed section-level diff producer.
 *
 * The generator:
 *  1. Reads the targeted high-revision sections + recent feedback
 *     narratives (owner rewrite reasons) from the supplied input.
 *  2. Builds a structured prompt asking the model to emit a JSON diff
 *     conforming to `ProposedDiff` — rewrite / reorder / add citation /
 *     remove section / add section edits, each with a rationale that
 *     cites the corpus / regulation justifying the change.
 *  3. Routes via the cost-cascade so Haiku tries first and only
 *     escalates to Sonnet/Opus when the validator scores low confidence.
 *
 * The LLM port is duck-typed so tests pass a stub that emits a static
 * diff. Production wires `@borjie/brain-llm-router/cost-cascade`.
 */

import { z } from 'zod';
import type { ProposedDiff, RecipeFitnessStats } from '../types.js';
import { targetedSectionsForImprove } from './improve-decision.js';

/**
 * The LLM port — receives a single string prompt, returns the model's
 * raw JSON-shaped response (still string, parsed by the validator).
 */
export interface ProposalLlmPort {
  generate(prompt: string): Promise<string>;
}

export interface FeedbackNarrative {
  readonly section_path: string | null;
  readonly note: string;
  readonly recorded_at: string;
}

export interface ProposalGenerationInput {
  readonly recipe_id: string;
  readonly current_version: number;
  readonly stats: RecipeFitnessStats;
  readonly recent_narratives: ReadonlyArray<FeedbackNarrative>;
  readonly section_revision_threshold?: number;
  readonly corpus_citations: ReadonlyArray<string>;
}

const SectionEditSchema = z.object({
  kind: z.enum([
    'rewrite',
    'reorder',
    'add_citation',
    'remove_section',
    'add_section',
  ]),
  section_path: z.string().min(1),
  rationale: z.string().min(1),
  proposed_text: z.string().optional(),
  proposed_position: z.number().int().optional(),
  citation_ref: z.string().optional(),
});

const ProposedDiffSchema = z.object({
  recipe_id: z.string().min(1),
  current_version: z.number().int().nonnegative(),
  proposed_version: z.number().int().positive(),
  summary: z.string().min(1),
  edits: z.array(SectionEditSchema).min(1),
});

/** Build the model prompt — exported for tests. */
export function buildPrompt(input: ProposalGenerationInput): string {
  const targeted = targetedSectionsForImprove(
    input.stats,
    input.section_revision_threshold,
  );
  const narrativesText = input.recent_narratives
    .map(
      (n) =>
        `- [${n.recorded_at}] (${n.section_path ?? 'doc-level'}): ${n.note}`,
    )
    .join('\n');
  const citationsText = input.corpus_citations
    .map((c) => `- ${c}`)
    .join('\n');

  return [
    `You are Mr. Mwikila's document-evolution sub-brain. Propose a section-level diff to improve recipe ${input.recipe_id} (version ${input.current_version}).`,
    ``,
    `Targeted high-revision sections (above threshold ${input.section_revision_threshold ?? 0.2}):`,
    targeted.length === 0 ? '- (none)' : targeted.map((s) => `- ${s}`).join('\n'),
    ``,
    `Recent owner / regulator narratives:`,
    narrativesText.length === 0 ? '- (none)' : narrativesText,
    ``,
    `Available corpus / regulation citations:`,
    citationsText.length === 0 ? '- (none)' : citationsText,
    ``,
    `Rules:`,
    `- Output a single JSON object matching the ProposedDiff schema.`,
    `- Every edit must carry a non-empty rationale that references one of the citations above.`,
    `- Only emit edits whose section_path appears in the targeted list OR is a new section.`,
    `- proposed_version must equal ${input.current_version + 1}.`,
    `- summary must be one sentence.`,
    ``,
    `Schema:`,
    `{ "recipe_id": string, "current_version": int, "proposed_version": int,`,
    `  "summary": string,`,
    `  "edits": [{ "kind": "rewrite"|"reorder"|"add_citation"|"remove_section"|"add_section",`,
    `              "section_path": string, "rationale": string,`,
    `              "proposed_text"?: string, "proposed_position"?: int,`,
    `              "citation_ref"?: string }] }`,
    ``,
    `Respond with ONLY the JSON. No prose.`,
  ].join('\n');
}

/**
 * Generate the diff. Throws when the LLM returns malformed JSON or a
 * shape that fails the schema check.
 */
export async function generateProposal(
  llm: ProposalLlmPort,
  input: ProposalGenerationInput,
): Promise<ProposedDiff> {
  const prompt = buildPrompt(input);
  const raw = await llm.generate(prompt);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFences(raw));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(
      `proposal-generator: model emitted non-JSON: ${message}`,
    );
  }
  const result = ProposedDiffSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `proposal-generator: schema violation: ${result.error.message}`,
    );
  }
  // Hard-enforce: proposed_version must equal current_version + 1.
  if (result.data.proposed_version !== input.current_version + 1) {
    throw new Error(
      `proposal-generator: proposed_version must be current+1 (got ${result.data.proposed_version})`,
    );
  }
  return result.data;
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    // Strip the first line (```json or ```) and the trailing ``` if present.
    const firstNewline = trimmed.indexOf('\n');
    if (firstNewline === -1) return trimmed;
    const inner = trimmed.slice(firstNewline + 1);
    const closing = inner.lastIndexOf('```');
    if (closing === -1) return inner;
    return inner.slice(0, closing).trim();
  }
  return trimmed;
}
